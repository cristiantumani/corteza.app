const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { isAdmin } = require('../services/permissions');
const onboarding = require('../core/onboarding/onboarding-service');
const { track } = require('../integrations/posthog/client');

/**
 * First-run onboarding on Home (logic in core/onboarding; UI in partials/onboarding.html).
 *
 *   GET  /api/onboarding        { seen, is_admin }   (Home also gets `onboarding_seen` in its preload)
 *   POST /api/onboarding/seen   { how?: 'finished'|'skipped'|'link', step?, steps? }: don't show it again
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/onboarding', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const [seen, admin] = await Promise.all([
      onboarding.hasSeenOnboarding(workspace_id, user_id),
      isAdmin(null, workspace_id, user_id)
    ]);
    res.json({ success: true, seen, is_admin: admin });
  } catch (error) {
    console.error('❌ Failed to load onboarding state:', error);
    res.status(500).json({ success: false, error: 'Failed to load onboarding state' });
  }
});

router.post('/api/onboarding/seen', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    await onboarding.markOnboardingSeen(req.session.user.workspace_id, req.session.user.user_id);
    const { how, step, steps } = req.body || {};
    track('onboarding_closed', {
      how: ['finished', 'skipped', 'link'].includes(how) ? how : 'unknown',
      step: Number.isInteger(step) ? step : null,
      steps: Number.isInteger(steps) ? steps : null
    });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to save onboarding state:', error);
    res.status(500).json({ success: false, error: 'Failed to save onboarding state' });
  }
});

module.exports = router;
