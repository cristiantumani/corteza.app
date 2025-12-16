/**
 * Authentication Middleware for Express routes
 * Protects API endpoints by requiring Slack OAuth authentication
 */

/**
 * Middleware to require authentication for API endpoints
 * Checks if user has valid session from Slack OAuth
 */
function requireAuth(req, res, next) {
  // Check if user is authenticated (session exists)
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Please log in at /auth/login'
    });
  }

  // User is authenticated, continue to next middleware
  next();
}

/**
 * Middleware to verify workspace access
 * Ensures authenticated user can only access their own workspace data
 */
function requireWorkspaceAccess(req, res, next) {
  // First check authentication
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  // Get workspace_id from query params
  const requestedWorkspaceId = req.query.workspace_id;

  // If no workspace_id requested, inject authenticated user's workspace
  if (!requestedWorkspaceId) {
    req.query.workspace_id = req.session.user.workspace_id;
    req.authenticatedWorkspaceId = req.session.user.workspace_id;
    next();
    return;
  }

  // Verify requested workspace matches authenticated user's workspace
  if (requestedWorkspaceId !== req.session.user.workspace_id) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You do not have access to this workspace'
    });
  }

  // Workspace access verified
  req.authenticatedWorkspaceId = req.session.user.workspace_id;
  next();
}

/**
 * Middleware to add security headers to all responses
 */
function addSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Only add HSTS in production (requires HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

module.exports = {
  requireAuth,
  requireWorkspaceAccess,
  addSecurityHeaders
};
