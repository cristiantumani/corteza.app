const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { isAdmin } = require('../services/permissions');
const { getVoiceSetting, setVoice, setWorkspaceVoicesEnabled } = require('../core/digest/voice-settings');
const { track } = require('../integrations/posthog/client');

/**
 * The morning partner of the signed-in person's daily summary (core/digest).
 *
 *   GET /api/me/digest-voice           { voice, chosen, default_voice, workspace_enabled, voices, samples, is_admin }
 *   PUT /api/me/digest-voice           { voice: 'classic'|'sergeant'|'sarcastic' }
 *   PUT /api/workspace/digest-voices   { enabled: boolean }  admins only: personalities on or off for everyone
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/me/digest-voice', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const [setting, admin] = await Promise.all([getVoiceSetting(workspace_id, user_id), isAdmin(null, workspace_id, user_id)]);
    res.json({ success: true, ...setting, is_admin: admin });
  } catch (error) {
    console.error('❌ Failed to load the morning partner setting:', error);
    res.status(500).json({ success: false, error: 'Failed to load your morning partner' });
  }
});

router.put('/api/me/digest-voice', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const voice = (req.body || {}).voice;
    if (!await setVoice(workspace_id, user_id, voice)) return res.status(400).json({ success: false, error: 'Unknown morning partner' });
    track('digest_voice_set', { voice }, user_id);
    res.json({ success: true, ...(await getVoiceSetting(workspace_id, user_id)) });
  } catch (error) {
    console.error('❌ Failed to save the morning partner:', error);
    res.status(500).json({ success: false, error: 'Failed to save your morning partner' });
  }
});

router.put('/api/workspace/digest-voices', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    if (!await isAdmin(null, workspace_id, user_id)) return res.status(403).json({ success: false, error: 'Only workspace admins can change this' });
    const enabled = (req.body || {}).enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, error: 'enabled must be true or false' });
    await setWorkspaceVoicesEnabled(workspace_id, enabled);
    track('digest_voices_workspace_set', { enabled }, user_id);
    res.json({ success: true, workspace_enabled: enabled });
  } catch (error) {
    console.error('❌ Failed to change the workspace morning partner switch:', error);
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

module.exports = router;
