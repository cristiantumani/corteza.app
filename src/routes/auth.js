/**
 * Simplified authentication using bot installation OAuth
 * No separate user OAuth needed - reuses existing bot OAuth flow
 */

/**
 * Initiates Slack OAuth flow for dashboard authentication
 * Redirects to bot installation which creates session on success
 * GET /auth/login
 */
function handleLogin(req, res) {
  // Simply redirect to bot installation OAuth
  // The success callback in src/index.js will create the session
  res.redirect('/slack/install');
}

/**
 * Returns current authenticated user info
 * GET /auth/me
 */
function handleMe(req, res) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      authenticated: false,
      error: 'Not authenticated'
    });
  }

  res.json({
    authenticated: true,
    user: req.session.user
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
  handleLogin,
  handleMe,
  handleLogout
};
