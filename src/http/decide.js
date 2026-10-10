const express = require('express');
const { apiRateLimiter, aiRateLimiter } = require('../middleware/auth');
const { requireAiBudget } = require('../core/usage/ai-usage');
const { getUserAccessibleSpaces, isAdmin } = require('../services/permissions');
const decide = require('../core/agent/decide');
const { translate, requestLanguage } = require('../core/i18n/i18n');
const { track } = require('../integrations/posthog/client');

/**
 * Decide and close (core/agent/decide, docs/specs/2026-10-decide-and-close.md)
 *
 *   POST /api/decide/preview   { text } → { is_decision, decision, items, related } (one Claude call; writes nothing)
 *   POST /api/decide           { text, rationale?, close: [{ kind, id, relation }] } → { decision, closed }
 *   POST /api/decide/:id/undo  reopens what it closed and deletes the decision
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

async function contextOf(req) {
  const { workspace_id, user_id, user_name } = req.session.user;
  const [spaceIds, admin] = await Promise.all([
    getUserAccessibleSpaces(null, workspace_id, user_id),
    isAdmin(null, workspace_id, user_id)
  ]);
  return { workspaceId: workspace_id, userId: user_id, user: { user_id, name: user_name || null }, spaceIds, admin: !!admin };
}

router.post('/api/decide/preview', aiRateLimiter, express.json(), requireSession, requireAiBudget, async (req, res) => {
  try {
    const text = req.body && req.body.text;
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ success: false, error: 'Write the decision' });
    const ctx = await contextOf(req);
    const preview = await decide.previewDecision({ workspaceId: ctx.workspaceId, userId: ctx.userId, spaceIds: ctx.spaceIds, admin: ctx.admin, text });
    track('decide_previewed', { is_decision: preview.is_decision, items_count: preview.items.length, related_count: preview.related.length });
    res.json({ success: true, ...preview });
  } catch (error) {
    console.error('❌ Decide preview failed:', error.message);
    res.status(500).json({ success: false, error: 'Couldn’t look for related items' });
  }
});

router.post('/api/decide', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const ctx = await contextOf(req);
    const lang = requestLanguage(req);
    const result = await decide.recordDecision({
      workspaceId: ctx.workspaceId, user: ctx.user, spaceIds: ctx.spaceIds, admin: ctx.admin,
      text: req.body && req.body.text, rationale: req.body && req.body.rationale, close: req.body && req.body.close,
      t: (key, vars) => translate(lang, key, vars)
    });
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    track('decide_recorded', { closed_count: result.closed.length });
    res.status(201).json({ success: true, decision: result.decision, closed: result.closed });
  } catch (error) {
    console.error('❌ Recording a decision failed:', error.message);
    res.status(500).json({ success: false, error: 'Couldn’t record the decision' });
  }
});

router.post('/api/decide/:id/undo', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
    const ctx = await contextOf(req);
    const result = await decide.undoDecision({ workspaceId: ctx.workspaceId, user: ctx.user, spaceIds: ctx.spaceIds, id });
    if (result.notFound) return res.status(404).json({ success: false, error: 'Decision not found' });
    track('decide_undone', { reopened_count: result.reopened });
    res.json({ success: true, reopened: result.reopened });
  } catch (error) {
    console.error('❌ Undoing a decision failed:', error.message);
    res.status(500).json({ success: false, error: 'Couldn’t undo it' });
  }
});

module.exports = router;
