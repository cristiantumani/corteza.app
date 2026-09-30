const express = require('express');
const { renderView } = require('./page-partials');
const { apiRateLimiter, requireAuthBrowser } = require('../middleware/auth');
const { getUserAccessibleSpaces, isAdmin, canCreateInSpace } = require('../services/permissions');
const { getDecisionsCollection, getWorkspaceMembersCollection } = require('../config/database');
const actions = require('../core/actions/action-service');
const { getTimeZone, localTime } = require('../core/users/timezone');
const { track } = require('../integrations/posthog/client');

/**
 * Action items ("pendientes"): page and API (logic in core/actions).
 *
 *   GET   /actions                          page (filters: mine/everyone, status, due)
 *   GET   /api/action-items?owner=me|all&status=open|done|cancelled|all&due=overdue|today|none|week&decision_id=12
 *   POST  /api/action-items                 { decision_id, text, owner_user_ids?, due_date? } add one to a decision by hand
 *   PATCH /api/action-items/:itemId         { status?, due_date? }
 *   GET   /api/people                       workspace members to pick owners from: [{ user_id, name, email }]
 *
 * Visibility follows spaces: people see items in spaces they can access, plus the items they own
 * in any space (so an item from a colleague's personal space still reaches its owner).
 * Owners, whoever the item is attributed to, and admins can update it.
 * Anyone who can add decisions to a decision's space can add action items to it.
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

const actionsHTML = renderView('actions.html', { active: 'actions' });

router.get('/actions', requireAuthBrowser, (req, res) => {
  res.type('html').send(actionsHTML);
});

router.get('/api/action-items', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const [spaceIds, { timezone }] = await Promise.all([
      getUserAccessibleSpaces(null, workspace_id, user_id),
      getTimeZone(workspace_id, user_id)
    ]);
    const decisionId = req.query.decision_id !== undefined ? parseInt(req.query.decision_id, 10) : undefined;

    const items = await actions.listActionItems(workspace_id, {
      spaceIds,
      viewerId: user_id,
      ownerId: req.query.owner === 'me' ? user_id : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : 'open',
      due: typeof req.query.due === 'string' ? req.query.due : undefined,
      decisionId: Number.isInteger(decisionId) ? decisionId : undefined,
      today: localTime(new Date(), timezone || 'UTC').date
    });
    res.json({ success: true, items, user_id });
  } catch (error) {
    console.error('❌ Failed to list action items:', error);
    res.status(500).json({ success: false, error: 'Failed to load action items' });
  }
});

router.post('/api/action-items', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id, user_name } = req.session.user;
    const { decision_id, text, owner_user_ids, due_date } = req.body || {};

    const decisionId = typeof decision_id === 'number' ? decision_id : parseInt(decision_id, 10);
    const decision = Number.isInteger(decisionId)
      ? await getDecisionsCollection().findOne({ workspace_id, id: decisionId }, { projection: { id: 1, space_id: 1, space_name: 1 } })
      : null;
    if (!decision) return res.status(404).json({ success: false, error: 'Decision not found' });
    if (!await canCreateInSpace(null, workspace_id, decision.space_id, user_id)) {
      return res.status(403).json({ success: false, error: 'You cannot add action items in this space' });
    }

    const cleanText = typeof text === 'string' ? text.trim().slice(0, 500) : '';
    if (!cleanText) return res.status(400).json({ success: false, error: 'Write what needs to be done' });
    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
      return res.status(400).json({ success: false, error: 'Due date must be YYYY-MM-DD' });
    }

    const item = await actions.createActionItem({
      workspaceId: workspace_id,
      spaceId: decision.space_id,
      spaceName: decision.space_name || null,
      text: cleanText,
      ownerUserIds: Array.isArray(owner_user_ids) ? owner_user_ids : [],
      dueDate: due_date || null,
      decisionId: decision.id,
      capture: 'manual',
      author: { user_id, name: user_name || null }
    });
    console.log(`✅ Action item ${item.item_id} added to decision #${decision.id} by ${user_id}`);
    track('action_item_added', { has_due_date: !!item.due_date, owner_count: item.owner_ids.length });
    res.status(201).json({ success: true, item });
  } catch (error) {
    console.error('❌ Failed to add action item:', error);
    res.status(500).json({ success: false, error: 'Failed to add action item' });
  }
});

router.get('/api/people', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const members = await getWorkspaceMembersCollection()
      .find({ workspace_id: req.session.user.workspace_id, removed_at: null })
      .project({ user_id: 1, user_name: 1, email: 1, _id: 0 })
      .sort({ user_name: 1 })
      .toArray();
    res.json({
      success: true,
      people: members.map(member => ({ user_id: member.user_id, name: member.user_name || member.email, email: member.email || null }))
    });
  } catch (error) {
    console.error('❌ Failed to list people:', error);
    res.status(500).json({ success: false, error: 'Failed to load people' });
  }
});

router.patch('/api/action-items/:itemId', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const item = await actions.getActionItem(workspace_id, req.params.itemId);
    const isOwner = !!item && item.owner_ids.includes(user_id);
    const spaceIds = item && !isOwner ? await getUserAccessibleSpaces(null, workspace_id, user_id) : [];
    if (!item || (!isOwner && !spaceIds.includes(item.space_id))) {
      return res.status(404).json({ success: false, error: 'Action item not found' });
    }

    const canUpdate = item.owner_ids.includes(user_id)
      || item.created_by?.user_id === user_id
      || await isAdmin(null, workspace_id, user_id);
    if (!canUpdate) return res.status(403).json({ success: false, error: 'Only the owners or an admin can update this' });

    const { status, due_date } = req.body || {};
    const updated = await actions.updateActionItem(workspace_id, item.item_id, { status, due_date });
    if (updated?.error) return res.status(400).json({ success: false, error: updated.error });
    track('action_item_updated', {
      status_changed_to: status && status !== item.status ? status : null,
      due_date_changed: due_date !== undefined && due_date !== item.due_date,
      is_owner: isOwner,
      overdue: !!item.due_date && item.due_date < new Date().toISOString().slice(0, 10)
    });
    res.json({ success: true, item: updated });
  } catch (error) {
    console.error('❌ Failed to update action item:', error);
    res.status(500).json({ success: false, error: 'Failed to update action item' });
  }
});

module.exports = router;
