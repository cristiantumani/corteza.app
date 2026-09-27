const express = require('express');
const { getDatabase } = require('../../config/database');
const { apiRateLimiter } = require('../../middleware/auth');
const { canCreateInSpace } = require('../../services/permissions');
const google = require('./oauth');
const connections = require('./connections');

/**
 * "Connect Google Meet" routes
 *
 *   GET  /integrations/google/connect       start consent (Meet + Drive-Meet scopes, offline access)
 *   GET  /integrations/google/callback      Google redirects back here
 *   GET  /api/integrations/google           connection status for the signed-in user
 *   PUT  /api/integrations/google/settings  { space_id, skip_one_on_one, exclude_keywords }
 *   POST /api/integrations/google/sync      check for new meetings now
 *   POST /api/integrations/google/disconnect
 */
const router = express.Router();

function settingsRedirect(res, params) {
  return res.redirect(`/settings?${new URLSearchParams(params)}#integrations`);
}

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.get('/integrations/google/connect', (req, res) => {
  if (!req.session?.user) return res.redirect('/auth/login?return=%2Fsettings');
  if (!google.isGoogleConfigured()) return settingsRedirect(res, { google_error: 'Google is not configured on this server.' });

  const state = google.randomToken();
  const nonce = google.randomToken();
  req.session.googleConnect = { state, nonce, started_at: Date.now() };
  req.session.save(err => {
    if (err) return settingsRedirect(res, { google_error: 'Could not start. Please try again.' });
    res.redirect(connections.buildConnectUrl({ state, nonce, loginHint: req.session.user.email }));
  });
});

router.get('/integrations/google/callback', async (req, res) => {
  const pending = req.session?.googleConnect;
  if (req.session) delete req.session.googleConnect;

  if (!req.session?.user) return res.redirect('/auth/login?return=%2Fsettings');
  if (req.query.error) {
    return settingsRedirect(res, { google_error: req.query.error === 'access_denied' ? 'Connection was cancelled.' : 'Google connection failed.' });
  }
  if (!pending || req.query.state !== pending.state || Date.now() - pending.started_at > 10 * 60 * 1000) {
    return settingsRedirect(res, { google_error: 'The connection request expired. Please try again.' });
  }

  try {
    const { refreshToken, email, grantedScopes } = await connections.exchangeConnectCode({ code: req.query.code, nonce: pending.nonce });
    const user = req.session.user;

    if (user.email && email !== user.email.toLowerCase()) {
      return settingsRedirect(res, { google_error: `Connect the same Google account you signed in with (${user.email}).` });
    }
    const missing = connections.missingScopes(grantedScopes);
    if (missing.length > 0) {
      return settingsRedirect(res, { google_error: 'Corteza needs access to your Meet transcripts and notes. Please allow all requested permissions.' });
    }
    if (!refreshToken) {
      return settingsRedirect(res, { google_error: 'Google did not grant offline access. Please try again.' });
    }

    await connections.saveConnection({
      workspaceId: user.workspace_id,
      userId: user.user_id,
      userName: user.user_name,
      email,
      refreshToken,
      grantedScopes
    });
    settingsRedirect(res, { google: 'connected' });
  } catch (error) {
    console.error('❌ Google Meet connect failed:', error.message);
    settingsRedirect(res, { google_error: 'Google connection failed. Please try again.' });
  }
});

router.get('/api/integrations/google', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const connection = await connections.getConnection(workspace_id, user_id);
    if (!connection) {
      return res.json({ success: true, configured: google.isGoogleConfigured(), connected: false });
    }

    const recent = await getDatabase().collection('ingestions')
      .find({ workspace_id, source: 'google_meet' })
      .sort({ updated_at: -1 })
      .limit(10)
      .project({ title: 1, status: 1, skip_reason: 1, decisions_created: 1, updated_at: 1, _id: 0 })
      .toArray();

    res.json({
      success: true,
      configured: google.isGoogleConfigured(),
      connected: true,
      status: connection.status,
      google_email: connection.google_email,
      connected_at: connection.connected_at,
      last_polled_at: connection.last_polled_at,
      last_error: connection.last_error,
      meetings_processed: connection.meetings_processed || 0,
      decisions_captured: connection.decisions_captured || 0,
      settings: connection.settings,
      recent_meetings: recent
    });
  } catch (error) {
    console.error('❌ Failed to load Google connection:', error);
    res.status(500).json({ success: false, error: 'Failed to load Google connection' });
  }
});

router.put('/api/integrations/google/settings', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    if (!await connections.getConnection(workspace_id, user_id)) {
      return res.status(404).json({ success: false, error: 'Google Meet is not connected' });
    }

    const { space_id, skip_one_on_one, exclude_keywords } = req.body || {};
    if (space_id && !await canCreateInSpace(null, workspace_id, space_id, user_id)) {
      return res.status(403).json({ success: false, error: 'You cannot add decisions to that space' });
    }
    const keywords = (Array.isArray(exclude_keywords) ? exclude_keywords : String(exclude_keywords || '').split(','))
      .map(k => String(k).trim())
      .filter(Boolean)
      .slice(0, 20)
      .map(k => k.slice(0, 50));

    await connections.updateSettings(workspace_id, user_id, {
      space_id: space_id || null,
      skip_one_on_one: skip_one_on_one !== false,
      exclude_keywords: keywords
    });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to save Google Meet settings:', error);
    res.status(500).json({ success: false, error: 'Failed to save settings' });
  }
});

router.post('/api/integrations/google/sync', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const connection = await connections.getConnection(workspace_id, user_id);
    if (!connection || connection.status !== 'active') {
      return res.status(404).json({ success: false, error: 'Google Meet is not connected' });
    }

    const { runForConnection } = require('../../jobs/meet-poller');
    const summary = await runForConnection(connection);
    if (!summary) return res.status(409).json({ success: false, error: 'A check is already running. Try again in a minute.' });
    if (summary.error) return res.status(502).json({ success: false, error: summary.error === 'revoked' ? 'Google access was revoked. Reconnect Google Meet.' : 'Checking Google Meet failed.' });

    res.json({
      success: true,
      meetings_processed: summary.meetingsProcessed,
      decisions_captured: summary.decisionsCaptured,
      results: summary.results.map(r => ({ title: r.title, status: r.status, reason: r.reason || null, decisions: r.decisions ? r.decisions.length : 0 }))
    });
  } catch (error) {
    console.error('❌ Google Meet sync failed:', error);
    res.status(500).json({ success: false, error: 'Checking Google Meet failed' });
  }
});

router.post('/api/integrations/google/disconnect', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    await connections.disconnect(workspace_id, user_id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Google Meet disconnect failed:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

module.exports = router;
