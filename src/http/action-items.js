const express = require('express');
const path = require('path');
const { apiRateLimiter, requireAuthBrowser } = require('../middleware/auth');
const { getUserAccessibleSpaces, isAdmin } = require('../services/permissions');
const actions = require('../core/actions/action-service');

/**
 * Action items ("pendientes"): page and API (logic in core/actions).
 *
 *   GET   /actions                          page (filters: mine/everyone, status, due)
 *   GET   /api/action-items?owner=me|all&status=open|done|cancelled|all&due=overdue|none|week&decision_id=12
 *   PATCH /api/action-items/:itemId         { status?, due_date? }
 *
 * Visibility follows spaces: people see items in spaces they can access.
 * Owners, whoever the item is attributed to, and admins can update it.
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/actions', requireAuthBrowser, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'actions.html'));
});

router.get('/api/action-items', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const spaceIds = await getUserAccessibleSpaces(null, workspace_id, user_id);
    const decisionId = req.query.decision_id !== undefined ? parseInt(req.query.decision_id, 10) : undefined;

    const items = await actions.listActionItems(workspace_id, {
      spaceIds,
      ownerId: req.query.owner === 'me' ? user_id : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : 'open',
      due: typeof req.query.due === 'string' ? req.query.due : undefined,
      decisionId: Number.isInteger(decisionId) ? decisionId : undefined
    });
    res.json({ success: true, items, user_id });
  } catch (error) {
    console.error('❌ Failed to list action items:', error);
    res.status(500).json({ success: false, error: 'Failed to load action items' });
  }
});

router.patch('/api/action-items/:itemId', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const item = await actions.getActionItem(workspace_id, req.params.itemId);
    const spaceIds = item ? await getUserAccessibleSpaces(null, workspace_id, user_id) : [];
    if (!item || !spaceIds.includes(item.space_id)) {
      return res.status(404).json({ success: false, error: 'Action item not found' });
    }

    const canUpdate = item.owner_ids.includes(user_id)
      || item.created_by?.user_id === user_id
      || await isAdmin(null, workspace_id, user_id);
    if (!canUpdate) return res.status(403).json({ success: false, error: 'Only the owners or an admin can update this' });

    const { status, due_date } = req.body || {};
    const updated = await actions.updateActionItem(workspace_id, item.item_id, { status, due_date });
    if (updated?.error) return res.status(400).json({ success: false, error: updated.error });
    res.json({ success: true, item: updated });
  } catch (error) {
    console.error('❌ Failed to update action item:', error);
    res.status(500).json({ success: false, error: 'Failed to update action item' });
  }
});

module.exports = router;
