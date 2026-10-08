const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { getUserAccessibleSpaces } = require('../services/permissions');
const { getDatabase, getDecisionsCollection } = require('../config/database');
const { setSensitive } = require('../core/privacy/sensitive');
const { track } = require('../integrations/posthog/client');

/**
 * Sensitive topics (docs/specs/2026-10-sensitive-topics.md, logic in core/privacy/sensitive).
 *
 *   PUT /api/sensitive   { kind: 'decision'|'action_item', id, sensitive: boolean }
 *        marks the outcome or action item and its thread: visible only to the person marking it.
 *        Only that person can take the mark off.
 *        → { success, decisions, action_items } (how many items changed)
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.put('/api/sensitive', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id, user_name } = req.session.user;
    const { kind, id, sensitive } = req.body || {};
    if (!['decision', 'action_item'].includes(kind) || typeof sensitive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Invalid request' });
    }
    const itemId = kind === 'decision' ? (typeof id === 'number' ? id : parseInt(id, 10)) : id;
    if (kind === 'decision' ? !Number.isInteger(itemId) : typeof itemId !== 'string' || !itemId) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const spaceIds = await getUserAccessibleSpaces(null, workspace_id, user_id);

    // Taking the mark off: only whoever it's private to
    if (!sensitive) {
      const current = kind === 'decision'
        ? await getDecisionsCollection().findOne({ workspace_id, id: itemId, space_id: { $in: spaceIds } }, { projection: { _id: 0, private_to: 1, sensitive: 1 } })
        : await getDatabase().collection('action_items').findOne({ workspace_id, item_id: itemId, space_id: { $in: spaceIds } }, { projection: { _id: 0, private_to: 1, sensitive: 1 } });
      if (!current) return res.status(404).json({ success: false, error: 'Not found' });
      if (current.sensitive && current.private_to && current.private_to !== user_id) {
        return res.status(403).json({ success: false, error: 'Only the person it is private to can change this' });
      }
    }

    const result = await setSensitive({ workspaceId: workspace_id, kind, id: itemId, value: sensitive, actor: { user_id, name: user_name || null }, spaceIds });
    if (result.notFound) return res.status(404).json({ success: false, error: 'Not found' });
    console.log(`🔒 ${sensitive ? 'Marked' : 'Unmarked'} sensitive in ${workspace_id} by ${user_id}: ${result.decisions} outcome(s), ${result.action_items} action item(s)`);
    track('sensitive_marked', { sensitive, kind, outcomes: result.decisions, action_items: result.action_items }, user_id);
    res.json({ success: true, decisions: result.decisions, action_items: result.action_items });
  } catch (error) {
    console.error('❌ Failed to mark as sensitive:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

module.exports = router;
