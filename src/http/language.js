const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { getLanguage, setLanguage } = require('../core/users/language');
const { requestLanguage } = require('../core/i18n/i18n');
const { track } = require('../integrations/posthog/client');

/**
 * The signed-in person's app language (core/users/language, core/i18n).
 *
 *   GET /api/me/language   { language: 'en'|'es' (what the app uses now), chosen: 'en'|'es'|null (null: the browser's) }
 *   PUT /api/me/language   { language: 'en'|'es'|null }
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/me/language', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    res.json({ success: true, language: requestLanguage(req), chosen: await getLanguage(workspace_id, user_id) });
  } catch (error) {
    console.error('❌ Failed to load language:', error);
    res.status(500).json({ success: false, error: 'Failed to load your language' });
  }
});

router.put('/api/me/language', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const language = (req.body || {}).language;
    if (!await setLanguage(workspace_id, user_id, language === undefined ? 'invalid' : language)) {
      return res.status(400).json({ success: false, error: 'Unknown language' });
    }
    // The next page load uses it
    if (language === null) delete req.session.user.language;
    else req.session.user.language = language;
    track('language_set', { language: language || 'browser' }, user_id);
    res.json({ success: true, language: requestLanguage(req), chosen: language });
  } catch (error) {
    console.error('❌ Failed to save language:', error);
    res.status(500).json({ success: false, error: 'Failed to save your language' });
  }
});

module.exports = router;
