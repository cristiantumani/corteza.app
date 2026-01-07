/**
 * Authentication Middleware for Express routes
 * Protects API endpoints by requiring Slack OAuth authentication
 */

const rateLimit = require('express-rate-limit');

/**
 * Middleware to require authentication for API endpoints
 * Returns JSON 401 error if not authenticated
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
 * Middleware to require authentication for browser pages (HTML)
 * Redirects to login page if not authenticated
 */
function requireAuthBrowser(req, res, next) {
  // Check if user is authenticated (session exists)
  if (!req.session || !req.session.user) {
    // Redirect to login with return URL
    const returnUrl = encodeURIComponent(req.originalUrl);
    return res.redirect(`/auth/login?return=${returnUrl}`);
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

  // Content-Security-Policy to prevent XSS and injection attacks
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net", // unsafe-inline needed for inline scripts in dashboard
    "style-src 'self' 'unsafe-inline'", // unsafe-inline needed for inline styles
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests"
  ];
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // Only add HSTS in production (requires HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

/**
 * Rate limiting for API endpoints
 * Prevents abuse and DOS attacks
 */
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'You have exceeded the rate limit. Please try again later.'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Skip rate limiting for localhost in development
  skip: (req) => process.env.NODE_ENV !== 'production' && req.ip === '::1'
});

/**
 * Stricter rate limiting for authentication endpoints
 * Prevents brute force attacks
 */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: {
    error: 'Too many login attempts',
    message: 'You have exceeded the login rate limit. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful logins
});

/**
 * Rate limiting for AI extraction endpoints
 * More restrictive due to API costs
 */
const aiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 AI requests per hour
  message: {
    error: 'Too many AI requests',
    message: 'You have exceeded the AI extraction rate limit. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  requireAuth,
  requireAuthBrowser,
  requireWorkspaceAccess,
  addSecurityHeaders,
  apiRateLimiter,
  authRateLimiter,
  aiRateLimiter
};
