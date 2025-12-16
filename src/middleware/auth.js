/**
 * Authentication Middleware
 * Protects API endpoints by requiring Slack OAuth authentication
 */

/**
 * Middleware to require authentication for API endpoints
 * Checks if user has valid session from Slack OAuth
 *
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @param {Function} next - Next middleware function
 */
function requireAuth(req, res, next) {
  // Check if user is authenticated (session exists)
  if (!req.session || !req.session.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Unauthorized',
      message: 'Authentication required. Please log in via /auth/login'
    }));
    return;
  }

  // User is authenticated, continue to next middleware
  next();
}

/**
 * Middleware to verify workspace access
 * Ensures authenticated user can only access their own workspace data
 *
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @param {Function} next - Next middleware function
 */
function requireWorkspaceAccess(req, res, next) {
  // First check authentication
  if (!req.session || !req.session.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Unauthorized',
      message: 'Authentication required'
    }));
    return;
  }

  // Get workspace_id from query params or request body
  const queryParams = parseQueryParams(req.url);
  const requestedWorkspaceId = queryParams.workspace_id;

  // If no workspace_id requested, use authenticated user's workspace
  if (!requestedWorkspaceId) {
    // Inject authenticated workspace_id into request
    req.authenticatedWorkspaceId = req.session.user.workspace_id;
    next();
    return;
  }

  // Verify requested workspace matches authenticated user's workspace
  if (requestedWorkspaceId !== req.session.user.workspace_id) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Forbidden',
      message: 'You do not have access to this workspace'
    }));
    return;
  }

  // Workspace access verified
  req.authenticatedWorkspaceId = req.session.user.workspace_id;
  next();
}

/**
 * Parse query parameters from URL
 * @param {string} url - Request URL
 * @returns {Object} Parsed query parameters
 */
function parseQueryParams(url) {
  const params = {};
  const urlParts = url.split('?');
  if (urlParts.length > 1) {
    urlParts[1].split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }
  return params;
}

/**
 * Middleware to add CORS headers (if needed for API)
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @param {Function} next - Next middleware function
 */
function addSecurityHeaders(req, res, next) {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  next();
}

module.exports = {
  requireAuth,
  requireWorkspaceAccess,
  addSecurityHeaders
};
