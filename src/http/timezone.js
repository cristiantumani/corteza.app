const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { saveTimeZone, getTimeZone, isValidTimeZone } = require('../core/users/timezone');
const { track } = require('../integrations/posthog/client');

/**
 * The signed-in person's time zone (logic in core/users/timezone).
 *
 *   GET  /api/me/timezone   { timezone, source: 'auto'|'manual'|null }
 *   POST /api/me/timezone   { timezone, manual? }: the browser reports it (auto), or Settings sets it (manual)
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/me/timezone', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    res.json({ success: true, ...(await getTimeZone(workspace_id, user_id)) });
  } catch (error) {
    console.error('❌ Failed to load time zone:', error);
    res.status(500).json({ success: false, error: 'Failed to load your time zone' });
  }
});

router.post('/api/me/timezone', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const { timezone, manual } = req.body || {};
    if (!isValidTimeZone(timezone)) return res.status(400).json({ success: false, error: 'Unknown time zone' });
    const saved = await saveTimeZone(workspace_id, user_id, timezone, { manual: manual === true });
    if (saved && manual === true) track('timezone_set', { source: 'manual' });
    res.json({ success: true, saved });
  } catch (error) {
    console.error('❌ Failed to save time zone:', error);
    res.status(500).json({ success: false, error: 'Failed to save your time zone' });
  }
});

module.exports = router;
