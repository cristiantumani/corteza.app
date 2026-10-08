const express = require('express');
const { renderView } = require('./page-partials');
const { apiRateLimiter, requireAuthBrowser } = require('../middleware/auth');
const { getUserAccessibleSpaces, isAdmin, canCreateInSpace } = require('../services/permissions');
const { getDecisionsCollection, getWorkspaceMembersCollection, getWorkspaceSpacesCollection } = require('../config/database');
const actions = require('../core/actions/action-service');
const { reviewColleagueAssignments, unseenFromColleagues, markColleagueAssignmentsSeen } = require('../core/actions/colleague-assignments');
const { getTimeZone, localTime } = require('../core/users/timezone');
const { withThreadSummaries } = require('../core/topics/thread-service');
const closeLoop = require('../core/actions/close-loop');
const { track } = require('../integrations/posthog/client');

/**
 * Action items ("pendientes"): page and API (logic in core/actions).
 *
 *   GET   /actions                          page (filters: mine/everyone, status, due)
 *   GET   /api/action-items?owner=me|all&status=open|done|cancelled|resolved|all&due=overdue|today|none|week&decision_id=12
 *   POST  /api/action-items                 { decision_id | space_id, text, owner_user_ids?, due_date? } add one by hand,
 *                                           to a decision or on its own (Log manually → Action item); it joins the decision's thread
 *                                           each item has `thread` ("Part of: <topic> · N questions, M risks") or null
 *   PATCH /api/action-items/:itemId         { status?, due_date?, text?, rationale?, owner_ids?, keep_owner_names? }; marked done: `may_resolve`,
 *                                           its open questions and risks, to offer closing them; cancelled: `orphaned`, the ones it
 *                                           leaves with no open action item (core/actions/close-loop, docs/specs/2026-10-close-loop-actions.md)
 *   GET   /api/action-items/from-colleagues  { count, from: [{ name, count }] } new items colleagues assigned to me
 *   POST  /api/action-items/from-colleagues/seen   I opened Action items: they're no longer new
 *   GET   /api/people                       workspace members to pick owners from: [{ user_id, name, email }]
 *
 * Visibility follows spaces: people see items in spaces they can access, plus the items they own
 * in any space (so an item from a colleague's personal space still reaches its owner).
 * Owners, whoever the item is attributed to, and admins can update it.
 * Anyone who can add decisions to a decision's space can add action items to it.
 */
const router = express.Router();

/**
 * A query value when it's one of the allowed ones
 * @template {string} T
 * @param {unknown} value
 * @param {readonly T[]} allowed
 * @param {T} [fallback]
 * @returns {T|undefined}
 */
function oneOf(value, allowed, fallback) {
  return allowed.find(option => option === value) ?? fallback;
}

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

const { localizedPage } = require('../core/i18n/i18n');
const actionsHTML = localizedPage(renderView('actions.html', { active: 'actions' }));

router.get('/actions', requireAuthBrowser, (req, res) => {
  res.type('html').send(actionsHTML(req));
});

router.get('/api/action-items', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const [spaceIds, { timezone }] = await Promise.all([
      getUserAccessibleSpaces(null, workspace_id, user_id),
      getTimeZone(workspace_id, user_id)
    ]);
    const decisionId = typeof req.query.decision_id === 'string' ? parseInt(req.query.decision_id, 10) : undefined;

    const items = await actions.listActionItems(workspace_id, {
      spaceIds,
      viewerId: user_id,
      ownerId: req.query.owner === 'me' ? user_id : undefined,
      status: oneOf(req.query.status, /** @type {const} */ (['open', 'done', 'cancelled', 'resolved', 'all']), 'open'),
      due: oneOf(req.query.due, /** @type {const} */ (['overdue', 'today', 'none', 'week'])),
      decisionId: Number.isInteger(decisionId) ? decisionId : undefined,
      today: localTime(new Date(), timezone || 'UTC').date
    });
    res.json({ success: true, items: await withThreadSummaries(workspace_id, items, { spaceIds, viewerId: user_id }), user_id });
  } catch (error) {
    console.error('❌ Failed to list action items:', error);
    res.status(500).json({ success: false, error: 'Failed to load action items' });
  }
});

router.post('/api/action-items', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id, user_name } = req.session.user;
    const { decision_id, space_id, text, owner_user_ids, due_date } = req.body || {};

    // Where it goes: the decision's space, or (on its own) a space the person picked
    let decision = null;
    let space;
    if (decision_id !== undefined && decision_id !== null) {
      const decisionId = typeof decision_id === 'number' ? decision_id : parseInt(decision_id, 10);
      decision = Number.isInteger(decisionId)
        ? await getDecisionsCollection().findOne({ workspace_id, id: decisionId }, { projection: { id: 1, space_id: 1, space_name: 1, topic_id: 1, topic: 1 } })
        : null;
      if (!decision) return res.status(404).json({ success: false, error: 'Decision not found' });
      space = { space_id: decision.space_id, name: decision.space_name || null };
    } else {
      if (typeof space_id !== 'string' || !space_id) return res.status(400).json({ success: false, error: 'Choose a space' });
      space = await getWorkspaceSpacesCollection().findOne({ workspace_id, space_id, archived: { $ne: true } }, { projection: { space_id: 1, name: 1 } });
      if (!space) return res.status(404).json({ success: false, error: 'Space not found' });
    }
    if (!await canCreateInSpace(null, workspace_id, space.space_id, user_id)) {
      return res.status(403).json({ success: false, error: 'You cannot add action items in this space' });
    }

    const cleanText = typeof text === 'string' ? text.trim().slice(0, 500) : '';
    if (!cleanText) return res.status(400).json({ success: false, error: 'Write what needs to be done' });
    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
      return res.status(400).json({ success: false, error: 'Due date must be YYYY-MM-DD' });
    }

    const item = await actions.createActionItem({
      workspaceId: workspace_id,
      spaceId: space.space_id,
      spaceName: space.name || null,
      text: cleanText,
      ownerUserIds: Array.isArray(owner_user_ids) ? owner_user_ids : [],
      dueDate: due_date || null,
      decisionId: decision ? decision.id : null,
      topicId: decision && decision.topic_id ? decision.topic_id : null,
      topic: decision && decision.topic ? decision.topic : null,
      capture: 'manual',
      author: { user_id, name: user_name || null }
    });
    // Owners other than the person adding it see it as new, assigned by them
    await reviewColleagueAssignments([item], { checkDuplicates: false });
    delete item.unseen_by;
    delete item.owner_duplicates;
    console.log(`✅ Action item ${item.item_id} added ${decision ? `to decision #${decision.id}` : 'on its own'} by ${user_id}`);
    track('action_item_added', { has_due_date: !!item.due_date, owner_count: item.owner_ids.length, linked: !!decision });
    res.status(201).json({ success: true, item });
  } catch (error) {
    console.error('❌ Failed to add action item:', error);
    res.status(500).json({ success: false, error: 'Failed to add action item' });
  }
});

/** Action items colleagues assigned to the signed-in person that they haven't seen: { count, from: [{ name, count }] } */
router.get('/api/action-items/from-colleagues', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    res.json({ success: true, ...(await unseenFromColleagues(workspace_id, user_id)) });
  } catch (error) {
    console.error('❌ Failed to count new action items from colleagues:', error);
    res.status(500).json({ success: false, error: 'Failed to load new action items' });
  }
});

/** The person opened Action items: what colleagues assigned them is no longer new */
router.post('/api/action-items/from-colleagues/seen', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const seen = await markColleagueAssignmentsSeen(workspace_id, user_id);
    res.json({ success: true, seen });
  } catch (error) {
    console.error('❌ Failed to mark action items as seen:', error);
    res.status(500).json({ success: false, error: 'Failed to update' });
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

    const { status, due_date, text, rationale, owner_ids, keep_owner_names } = req.body || {};
    const owners = owner_ids !== undefined ? await actions.ownersForUpdate(item, owner_ids, keep_owner_names) : undefined;
    const updated = await actions.updateActionItem(workspace_id, item.item_id, { status, due_date, text, rationale, owners });
    if (updated?.error) return res.status(400).json({ success: false, error: updated.error });
    // Closing the loop: what this item may have resolved (done), or left without a next step (cancelled)
    const closedNow = item.status === 'open' && (status === 'done' || status === 'cancelled');
    const access = closedNow ? { spaceIds: spaceIds.length ? spaceIds : await getUserAccessibleSpaces(null, workspace_id, user_id), userId: user_id } : null;
    const mayResolve = closedNow && status === 'done' ? (await closeLoop.relatedOutcomes(workspace_id, item, access)).outcomes : [];
    const orphaned = closedNow && status === 'cancelled' ? await closeLoop.orphanedBy(workspace_id, item, access) : [];
    track('action_item_updated', {
      status_changed_to: status && status !== item.status ? status : null,
      due_date_changed: due_date !== undefined && due_date !== item.due_date,
      text_changed: text !== undefined && text !== item.text,
      rationale_changed: rationale !== undefined && rationale !== item.rationale,
      owners_changed: owners !== undefined,
      is_owner: isOwner,
      overdue: !!item.due_date && item.due_date < new Date().toISOString().slice(0, 10)
    });
    // viewer_id: the owner of an action item added for an orphaned question or risk (close-loop.js)
    res.json({ success: true, item: updated, may_resolve: mayResolve, orphaned, viewer_id: user_id });
  } catch (error) {
    console.error('❌ Failed to update action item:', error);
    res.status(500).json({ success: false, error: 'Failed to update action item' });
  }
});

module.exports = router;
