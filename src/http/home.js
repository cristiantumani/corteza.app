const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { getTimeZone, localTime } = require('../core/users/timezone');
const { buildHomeOverview } = require('../core/home/overview');
const { buildToday } = require('../core/home/today');
const { requestLanguage } = require('../core/i18n/i18n');

/**
 * GET /api/home        everything Home's overview shows, in one request (core/home/overview.js)
 * GET /api/home/today  "Prepare your day": today's meetings still ahead, each with its prep (core/home/today.js);
 *                      loaded after the rest of Home (Calendar and Meet are slow)
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/home', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const { timezone } = await getTimeZone(workspace_id, user_id);
    const now = new Date();
    const overview = await buildHomeOverview(workspace_id, user_id, { now, today: localTime(now, timezone || 'UTC').date, lang: requestLanguage(req) });
    res.json({ success: true, ...overview });
  } catch (error) {
    console.error('❌ Failed to load the home overview:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load your overview' });
  }
});

router.get('/api/home/today', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const { timezone } = await getTimeZone(workspace_id, user_id);
    const today = await buildToday(workspace_id, user_id, { now: new Date(), timeZone: timezone || 'UTC' });
    res.json({ success: true, ...today });
  } catch (error) {
    console.error('❌ Failed to load today\'s meetings:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load your meetings' });
  }
});

module.exports = router;
