const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { listMeetings, meetingOutcomes } = require('../core/meetings/meetings');

/**
 * Meetings view on Home (docs/specs/2026-10-meetings-view.md, logic in core/meetings):
 *
 *   GET /api/meetings?before=<iso>&limit=20   { meetings: [row], next_before } — the person's own meetings,
 *                                             newest first, plus a "Logged by hand" row per day
 *   GET /api/meetings/outcomes?id=<meeting>   { outcomes, action_items } of one of them (404 when it isn't theirs)
 *
 * "Capture anyway" / "Try again" use POST /api/integrations/google/imports; confirm / dismiss use
 * POST /api/decisions/:id/review.
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/meetings', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const before = typeof req.query.before === 'string' && !isNaN(new Date(req.query.before).getTime()) ? req.query.before : null;
    const limit = Number.parseInt(String(req.query.limit || ''), 10) || 20;
    const result = await listMeetings(workspace_id, user_id, { before, limit });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Failed to list meetings:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load meetings' });
  }
});

router.get('/api/meetings/outcomes', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const result = await meetingOutcomes(workspace_id, user_id, typeof req.query.id === 'string' ? req.query.id : '');
    // Not found and not theirs look the same
    if (!result) return res.status(404).json({ success: false, error: 'Meeting not found' });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Failed to load a meeting\'s outcomes:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load the meeting' });
  }
});

module.exports = router;
