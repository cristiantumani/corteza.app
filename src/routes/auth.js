/**
 * Authentication using one-time login tokens from /login Slack command
 * Token-based auth is handled in dashboard-auth.js
 * This file only handles /auth/me and /auth/logout
 */

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
  handleMe,
  handleLogout
};
