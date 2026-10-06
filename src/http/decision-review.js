const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { canModifyDecision, canAccessSpace, getUserAccessibleSpaces } = require('../services/permissions');
const { getDecisionsCollection } = require('../config/database');
const review = require('../core/decisions/review-service');
const { track } = require('../integrations/posthog/client');
const links = require('../core/links/close-links');
const { translate, requestLanguage } = require('../core/i18n/i18n');

/**
 * Confirm or dismiss AI-captured outcomes (logic in core/decisions/review-service).
 *
 *   POST /api/decisions/:id/review    { action: 'confirm'|'dismiss', reason? }
 *   POST /api/decisions/:id/dismiss-reason   { reason }: why it was dismissed (after the fact)
 *   POST /api/decisions/:id/restore   undo a dismissal (only whoever dismissed it)
 *   GET  /api/decisions/:id/links            earlier items this outcome may close (cross-meeting links)
 *   POST /api/decisions/:id/links/close      { close: [{ kind, id }] }: close some of them
 *   POST /api/decisions/:id/links/reopen     { items: [{ kind, id }] }: undo
 *   Confirm takes `close` too: confirms and closes the chosen ones (docs/specs/2026-10-cross-meeting-links.md)
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
    const { action, reason, close } = req.body || {};
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
      const closed = Array.isArray(close) && close.length
        ? await links.closeLinks(decision, close, userOf(req), await accessOf(req), keyFor(req))
        : [];
      track('outcome_confirmed', { ...properties, linked_closed_count: closed.length });
      return res.json({ success: true, review_status: fields.review_status, closed });
    }
    await review.dismissDecision(decision, { user_id }, reason || null);
    track('outcome_dismissed', { ...properties, reason: Object.prototype.hasOwnProperty.call(review.DISMISS_REASONS, reason) ? reason : null });
    res.json({ success: true, dismissed: true });
  } catch (error) {
    console.error('❌ Failed to review outcome:', error);
    res.status(500).json({ success: false, error: 'Failed to save your review' });
  }
});

/** The signed-in person as stored on a resolution */
function userOf(req) {
  return { user_id: req.session.user.user_id, name: req.session.user.user_name || null };
}

/** What the signed-in person can see: their spaces, and their own action items */
async function accessOf(req) {
  const { workspace_id, user_id } = req.session.user;
  return { spaceIds: await getUserAccessibleSpaces(null, workspace_id, user_id), userId: user_id };
}

/** t() in the person's language, for notes saved on what gets closed */
function keyFor(req) {
  const lang = requestLanguage(req);
  return (key, vars) => translate(lang, key, vars);
}

/** The outcome, if the signed-in person may change it; null otherwise (not found and not allowed look the same) */
async function changeableDecision(req) {
  const { workspace_id, user_id } = req.session.user;
  const id = decisionIdFrom(req);
  if (!id) return null;
  const decision = await getDecisionsCollection().findOne({ workspace_id, id }, { projection: { embedding: 0 } });
  const allowed = decision
    && await canAccessSpace(null, workspace_id, decision.space_id, user_id)
    && await canModifyDecision(null, workspace_id, user_id, decision.user_id);
  return allowed ? decision : null;
}

router.get('/api/decisions/:id/links', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const id = decisionIdFrom(req);
    const decision = id && await getDecisionsCollection().findOne({ workspace_id, id }, { projection: { embedding: 0 } });
    if (!decision || !await canAccessSpace(null, workspace_id, decision.space_id, user_id)) {
      return res.status(404).json({ success: false, error: 'Outcome not found' });
    }
    const described = await links.describeLinks(workspace_id, [decision], await accessOf(req));
    const canClose = await canModifyDecision(null, workspace_id, user_id, decision.user_id);
    res.json({ success: true, may_close: described.get(decision.id) || [], can_close: canClose });
  } catch (error) {
    console.error('❌ Failed to load links:', error);
    res.status(500).json({ success: false, error: 'Failed to load links' });
  }
});

router.post('/api/decisions/:id/links/close', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const decision = await changeableDecision(req);
    if (!decision) return res.status(404).json({ success: false, error: 'Outcome not found' });
    const closed = await links.closeLinks(decision, req.body && req.body.close, userOf(req), await accessOf(req), keyFor(req));
    track('outcome_links_closed', { outcome_type: decision.type, closed_count: closed.length });
    res.json({ success: true, closed });
  } catch (error) {
    console.error('❌ Failed to close linked items:', error);
    res.status(500).json({ success: false, error: 'Failed to close them' });
  }
});

router.post('/api/decisions/:id/links/reopen', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const decision = await changeableDecision(req);
    if (!decision) return res.status(404).json({ success: false, error: 'Outcome not found' });
    const reopened = await links.reopenLinks(decision, req.body && req.body.items, userOf(req), await accessOf(req));
    track('outcome_links_reopened', { outcome_type: decision.type, reopened_count: reopened.length });
    res.json({ success: true, reopened });
  } catch (error) {
    console.error('❌ Failed to reopen linked items:', error);
    res.status(500).json({ success: false, error: 'Failed to undo' });
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
