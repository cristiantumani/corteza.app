const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { isAdmin } = require('../services/permissions');
const oauth = require('../auth/oauth-server');
const { track } = require('../integrations/posthog/client');

/**
 * Settings → AI assistants (docs/specs/2026-10-mcp-connector.md):
 *
 *   GET    /api/ai-assistants              { enabled, is_admin, mcp_url, assistants: [{ grant_id, client_name, connected_at, last_used_at }] }
 *   DELETE /api/ai-assistants/:grantId     disconnect one of my assistants (revokes its tokens at once)
 *   PUT    /api/ai-assistants/settings     { enabled } admins only; off revokes every assistant in the workspace
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/ai-assistants', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const [enabled, admin, assistants] = await Promise.all([
      oauth.assistantsEnabled(workspace_id),
      isAdmin(null, workspace_id, user_id),
      oauth.listGrants(workspace_id, user_id)
    ]);
    res.json({ success: true, enabled, is_admin: admin, mcp_url: oauth.resourceUrl().href, assistants });
  } catch (error) {
    console.error('❌ Failed to list AI assistants:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load your assistants' });
  }
});

router.delete('/api/ai-assistants/:grantId', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const done = await oauth.revokeUserGrant(workspace_id, user_id, String(req.params.grantId));
    if (!done) return res.status(404).json({ success: false, error: 'Not found' });
    track('mcp_disconnected', {}, user_id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to disconnect an AI assistant:', error.message);
    res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

router.put('/api/ai-assistants/settings', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    if (!(await isAdmin(null, workspace_id, user_id))) return res.status(403).json({ success: false, error: 'Only admins can change this' });
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ success: false, error: 'enabled must be true or false' });
    await oauth.setAssistantsEnabled(workspace_id, req.body.enabled);
    track('mcp_workspace_switch', { enabled: req.body.enabled }, user_id);
    console.log(`🔌 AI assistants ${req.body.enabled ? 'allowed' : 'turned off'} in ${workspace_id}`);
    res.json({ success: true, enabled: req.body.enabled });
  } catch (error) {
    console.error('❌ Failed to change the AI assistants setting:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

module.exports = router;
