const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { isAdmin } = require('../services/permissions');
const oauth = require('../auth/oauth-server');
const changes = require('../integrations/mcp/changes');
const { track } = require('../integrations/posthog/client');

/**
 * Settings → AI assistants (docs/specs/2026-10-mcp-connector.md):
 *
 *   GET    /api/ai-assistants              { enabled, write_enabled, is_admin, mcp_url,
 *                                            assistants: [{ grant_id, client_name, connected_at, last_used_at, can_write }] }
 *   DELETE /api/ai-assistants/:grantId     disconnect one of my assistants (revokes its tokens at once)
 *   PUT    /api/ai-assistants/settings     { enabled?, write_enabled? } admins only; enabled off revokes every assistant in the
 *                                            workspace, write_enabled off leaves them reading only (docs/specs/2026-10-mcp-v2-write.md)
 *   GET    /api/ai-assistants/changes      my last 20 changes through assistants: [{ change_id, kind, client_name, summary, applied_at, status, can_undo }]
 *   POST   /api/ai-assistants/changes/:changeId/undo   undo one (within 24 hours)
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/api/ai-assistants', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const [access, admin, assistants] = await Promise.all([
      oauth.assistantsAccess(workspace_id),
      isAdmin(null, workspace_id, user_id),
      oauth.listGrants(workspace_id, user_id)
    ]);
    res.json({
      success: true, enabled: access.enabled, write_enabled: access.write, is_admin: admin, mcp_url: oauth.resourceUrl().href,
      assistants: assistants.map(assistant => ({ ...assistant, can_write: assistant.can_write && access.write }))
    });
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
    const { enabled, write_enabled: writeEnabled } = req.body || {};
    if ((enabled !== undefined && typeof enabled !== 'boolean') || (writeEnabled !== undefined && typeof writeEnabled !== 'boolean') || (enabled === undefined && writeEnabled === undefined)) {
      return res.status(400).json({ success: false, error: 'enabled and write_enabled must be true or false' });
    }
    if (enabled !== undefined) {
      await oauth.setAssistantsEnabled(workspace_id, enabled);
      track('mcp_workspace_switch', { enabled }, user_id);
      console.log(`🔌 AI assistants ${enabled ? 'allowed' : 'turned off'} in ${workspace_id}`);
    }
    if (writeEnabled !== undefined) {
      await oauth.setAssistantsWriteEnabled(workspace_id, writeEnabled);
      track('mcp_workspace_write_switch', { enabled: writeEnabled }, user_id);
      console.log(`🔌 AI assistants ${writeEnabled ? 'can make changes' : 'read only'} in ${workspace_id}`);
    }
    const access = await oauth.assistantsAccess(workspace_id);
    res.json({ success: true, enabled: access.enabled, write_enabled: access.write });
  } catch (error) {
    console.error('❌ Failed to change the AI assistants setting:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save' });
  }
});

router.get('/api/ai-assistants/changes', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    res.json({ success: true, changes: await changes.recentChanges(workspace_id, user_id) });
  } catch (error) {
    console.error('❌ Failed to list changes through assistants:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load the changes' });
  }
});

router.post('/api/ai-assistants/changes/:changeId/undo', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const result = await changes.undo({ workspaceId: workspace_id, userId: user_id }, String(req.params.changeId));
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    track('mcp_change_undone', { from: 'settings' }, user_id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to undo a change through an assistant:', error.message);
    res.status(500).json({ success: false, error: 'Failed to undo' });
  }
});

module.exports = router;
