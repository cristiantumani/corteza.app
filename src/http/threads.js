const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { getUserAccessibleSpaces } = require('../services/permissions');
const { buildThreadView } = require('../core/topics/thread-view');
const { unlinkFromThread, relinkToThread } = require('../core/topics/thread-edits');
const { track } = require('../integrations/posthog/client');

/**
 * Topic threads as a unit (docs/specs/2026-10-thread-as-unit.md):
 *
 *   GET  /api/threads/:topicId   { topic_id, topic, summary, meetings: [{ title, date, items }] }, what the
 *                                person can see of it (404 when nothing)
 *   POST /api/threads/unlink     { kind: 'decision'|'action_item', id } → { topic_id } ("Not related")
 *   POST /api/threads/relink     { kind, id, topic_id } (its undo)
 */
const router = express.Router();

const TOPIC_ID = /^top_[0-9a-f]{1,32}$/;

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/threads/:topicId', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    if (!TOPIC_ID.test(req.params.topicId)) return res.status(404).json({ success: false, error: 'Not found' });
    const spaceIds = await getUserAccessibleSpaces(null, workspace_id, user_id);
    const thread = await buildThreadView(workspace_id, req.params.topicId, { spaceIds, viewerId: user_id });
    // Nothing visible and not there look the same
    if (!thread) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, ...thread });
  } catch (error) {
    console.error('❌ Failed to load a thread:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load the thread' });
  }
});

router.post('/api/threads/unlink', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const { kind, id } = req.body || {};
    const spaceIds = await getUserAccessibleSpaces(null, workspace_id, user_id);
    const result = await unlinkFromThread({ workspaceId: workspace_id, kind, id, userId: user_id, spaceIds });
    if ('error' in result) return res.status(result.status).json({ success: false, error: result.error });
    console.log(`🧵 ${kind} ${id} taken out of thread ${result.topic_id} by ${user_id}`);
    track('thread_item_unlinked', { kind });
    res.json({ success: true, topic_id: result.topic_id });
  } catch (error) {
    console.error('❌ Failed to take an item out of its thread:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

router.post('/api/threads/relink', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const { kind, id, topic_id } = req.body || {};
    if (typeof topic_id !== 'string' || !TOPIC_ID.test(topic_id)) return res.status(400).json({ success: false, error: 'Invalid thread' });
    const spaceIds = await getUserAccessibleSpaces(null, workspace_id, user_id);
    const result = await relinkToThread({ workspaceId: workspace_id, kind, id, topicId: topic_id, userId: user_id, spaceIds });
    if ('error' in result) return res.status(result.status).json({ success: false, error: result.error });
    track('thread_item_relinked', { kind });
    res.json({ success: true, topic_id: result.topic_id });
  } catch (error) {
    console.error('❌ Failed to put an item back in its thread:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

module.exports = router;
