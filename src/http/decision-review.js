const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { canModifyDecision, canAccessSpace } = require('../services/permissions');
const { getDecisionsCollection } = require('../config/database');
const review = require('../core/decisions/review-service');
const { track } = require('../integrations/posthog/client');

/**
 * Confirm or dismiss AI-captured outcomes (logic in core/decisions/review-service).
 *
 *   POST /api/decisions/:id/review    { action: 'confirm'|'dismiss', reason? }
 *   POST /api/decisions/:id/dismiss-reason   { reason }: why it was dismissed (after the fact)
 *   POST /api/decisions/:id/restore   undo a dismissal (only whoever dismissed it)
 *
 * Same permission as editing: your own outcomes (or an admin), in a space you can access.
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

function decisionIdFrom(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.post('/api/decisions/:id/review', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const id = decisionIdFrom(req);
    const { action, reason } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Invalid outcome' });
    if (!['confirm', 'dismiss'].includes(action)) return res.status(400).json({ success: false, error: 'action must be confirm or dismiss' });

    const decision = await getDecisionsCollection().findOne({ workspace_id, id }, { projection: { embedding: 0 } });
    // Not found and not allowed look the same, so nobody learns what's in a colleague's space
    const allowed = decision
      && await canAccessSpace(null, workspace_id, decision.space_id, user_id)
      && await canModifyDecision(null, workspace_id, user_id, decision.user_id);
    if (!allowed) return res.status(404).json({ success: false, error: 'Outcome not found' });

    const properties = { outcome_type: decision.type, ai_captured: decision.capture === 'ai', source: decision.source || null };
    if (action === 'confirm') {
      const fields = await review.confirmDecision(decision, { user_id });
      track('outcome_confirmed', properties);
      return res.json({ success: true, review_status: fields.review_status });
    }
    await review.dismissDecision(decision, { user_id }, reason || null);
    track('outcome_dismissed', { ...properties, reason: Object.prototype.hasOwnProperty.call(review.DISMISS_REASONS, reason) ? reason : null });
    res.json({ success: true, dismissed: true });
  } catch (error) {
    console.error('❌ Failed to review outcome:', error);
    res.status(500).json({ success: false, error: 'Failed to save your review' });
  }
});

router.post('/api/decisions/:id/dismiss-reason', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const id = decisionIdFrom(req);
    const reason = req.body && req.body.reason;
    if (!id) return res.status(400).json({ success: false, error: 'Invalid outcome' });
    const saved = await review.setDismissReason(workspace_id, user_id, id, reason);
    if (!saved) return res.status(400).json({ success: false, error: 'Unknown reason or nothing dismissed' });
    track('outcome_dismiss_reason', { reason });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to save dismiss reason:', error);
    res.status(500).json({ success: false, error: 'Failed to save the reason' });
  }
});

router.post('/api/decisions/:id/restore', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const id = decisionIdFrom(req);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid outcome' });
    const decision = await review.restoreDecision(workspace_id, user_id, id);
    if (!decision) return res.status(404).json({ success: false, error: 'Nothing to restore' });
    track('outcome_restored', { outcome_type: decision.type });
    res.json({ success: true, decision });
  } catch (error) {
    console.error('❌ Failed to restore outcome:', error);
    res.status(500).json({ success: false, error: 'Failed to restore' });
  }
});

module.exports = router;
