const express = require('express');
const { renderView } = require('./page-partials');
const { apiRateLimiter, requireAuthBrowser } = require('../middleware/auth');
const { getUserAccessibleSpaces, canAccessSpace } = require('../services/permissions');
const { getDecisionsCollection } = require('../config/database');
const { listQuestionsAndRisks, setResolution, TYPES } = require('../core/decisions/questions-risks');
const { withLinkedItems, openInThread } = require('../core/topics/thread-service');
const { track } = require('../integrations/posthog/client');

/**
 * Open questions and risks: page and API (logic in core/decisions/questions-risks).
 *
 *   GET  /questions                                 page (filters: type, status)
 *   GET  /api/questions-risks?type=open_question|risk|all&status=open|resolved|all&topic=top_…
 *                                                   { items, counts: { open_question, risk } } (open counts);
 *                                                   each item has `linked: { outcomes, actions }`, the rest of its thread
 *   POST /api/questions-risks/:id/resolve           { note? } answered (question) / mitigated (risk);
 *                                                   for a question, `linked_risks`: open risks of its thread, to offer closing them
 *   POST /api/questions-risks/:id/reopen
 *
 * Visibility follows spaces: people see the ones in spaces they can access, and anyone
 * who can access the space can resolve or reopen them.
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

/** @template T @param {unknown} value @param {readonly T[]} allowed @param {T} fallback @returns {T} */
function oneOf(value, allowed, fallback) {
  return allowed.includes(/** @type {T} */ (value)) ? /** @type {T} */ (value) : fallback;
}

const pageHTML = renderView('questions.html', { active: 'questions' });

router.get('/questions', requireAuthBrowser, (req, res) => {
  res.type('html').send(pageHTML);
});

router.get('/api/questions-risks', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const spaceIds = await getUserAccessibleSpaces(null, workspace_id, user_id);
    const topicId = typeof req.query.topic === 'string' && /^top_[0-9a-f]{1,32}$/.test(req.query.topic) ? req.query.topic : null;
    const result = await listQuestionsAndRisks(workspace_id, {
      spaceIds,
      type: oneOf(req.query.type, /** @type {const} */ (['open_question', 'risk', 'all']), 'all'),
      status: oneOf(req.query.status, /** @type {const} */ (['open', 'resolved', 'all']), 'open'),
      topicId
    });
    const items = await withLinkedItems(workspace_id, result.items, { spaceIds, viewerId: user_id });
    res.json({ success: true, items, counts: result.counts, topic: topicId ? (items.find(item => item.topic)?.topic || null) : undefined });
  } catch (error) {
    console.error('❌ Failed to list open questions and risks:', error);
    res.status(500).json({ success: false, error: 'Failed to load open questions and risks' });
  }
});

/** The outcome, if it's a question or risk the signed-in person can see; else sends 404 */
async function findAccessible(req, res) {
  const { workspace_id, user_id } = req.session.user;
  const id = Number(req.params.id);
  const decision = Number.isInteger(id) && id > 0
    ? await getDecisionsCollection().findOne({ workspace_id, id, type: { $in: TYPES } }, { projection: { embedding: 0 } })
    : null;
  // Not found and not allowed look the same, so nobody learns what's in a colleague's space
  if (!decision || !await canAccessSpace(null, workspace_id, decision.space_id, user_id)) {
    res.status(404).json({ success: false, error: 'Not found' });
    return null;
  }
  return decision;
}

router.post('/api/questions-risks/:id/resolve', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const decision = await findAccessible(req, res);
    if (!decision) return;
    const { user_id, user_name } = req.session.user;
    const fields = await setResolution(decision, 'resolved', { user_id, name: user_name || null }, (req.body || {}).note);
    if ('error' in fields) return res.status(400).json({ success: false, error: fields.error });
    const linkedRisks = decision.type === 'open_question' && decision.topic_id
      ? await openInThread(decision.workspace_id, decision.topic_id, 'risk', { spaceIds: await getUserAccessibleSpaces(null, decision.workspace_id, user_id) })
      : [];
    track('question_risk_resolved', { outcome_type: decision.type, with_note: Boolean(fields.resolution_note), in_thread: Boolean(decision.topic_id) });
    res.json({ success: true, ...fields, linked_risks: linkedRisks });
  } catch (error) {
    console.error('❌ Failed to resolve question or risk:', error);
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

router.post('/api/questions-risks/:id/reopen', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const decision = await findAccessible(req, res);
    if (!decision) return;
    const { user_id, user_name } = req.session.user;
    const fields = await setResolution(decision, 'open', { user_id, name: user_name || null });
    if ('error' in fields) return res.status(400).json({ success: false, error: fields.error });
    track('question_risk_reopened', { outcome_type: decision.type });
    res.json({ success: true, ...fields });
  } catch (error) {
    console.error('❌ Failed to reopen question or risk:', error);
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

module.exports = router;
