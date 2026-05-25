/**
 * Authentication using one-time login tokens from /login Slack command
 * Token-based auth is handled in dashboard-auth.js
 * This file only handles /auth/me and /auth/logout
 */

const { getSlackClient } = require('../config/slack-client');
const { isWorkspaceAdmin } = require('../middleware/admin-check');

/**
 * Returns current authenticated user info
 * GET /auth/me
 */
async function handleMe(req, res) {
  console.log('🔐 /auth/me called:', {
    hasSession: !!req.session,
    sessionID: req.sessionID,
    hasUser: !!(req.session && req.session.user),
    userId: req.session?.user?.user_id,
    sessionKeys: req.session ? Object.keys(req.session) : []
  });

  if (!req.session || !req.session.user) {
    console.log('❌ /auth/me: Not authenticated');
    return res.status(401).json({
      authenticated: false,
      error: 'Not authenticated'
    });
  }

  // Check if user is workspace admin
  let is_admin = false;
  try {
    const workspaceId = req.session.user.workspace_id;
    const userId = req.session.user.user_id;
    const client = await getSlackClient(workspaceId);
    is_admin = await isWorkspaceAdmin(client, userId, workspaceId);
  } catch (error) {
    console.error('❌ Error checking admin status in /auth/me:', error.message);
    // Continue without admin status on error
  }

  console.log('✅ /auth/me: Authenticated as', req.session.user.user_name, 'is_admin:', is_admin);
  res.json({
    authenticated: true,
    user: {
      ...req.session.user,
      is_admin
    }
  });
}

/**
 * Logs out user by destroying session
 * GET /auth/logout
 */
function handleLogout(req, res) {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('❌ Error destroying session:', err);
      }

      // Clear session cookie and redirect to login
      res.clearCookie('decision_logger_sid');
      res.redirect('/auth/login');
    });
  } else {
    res.redirect('/auth/login');
  }
}

module.exports = {
  handleMe,
  handleLogout
};
