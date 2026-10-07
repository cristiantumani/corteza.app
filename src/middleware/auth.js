/**
 * Authentication Middleware for Express routes
 * Protects API endpoints by requiring Slack OAuth authentication
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Middleware to require authentication for API endpoints
 * Returns JSON 401 error if not authenticated
 */
function requireAuth(req, res, next) {
  console.log(`🔐 [AUTH] requireAuth check for ${req.originalUrl}:`, {
    hasSession: !!req.session,
    hasUser: !!(req.session && req.session.user),
    userId: req.session?.user?.user_id,
    method: req.method
  });

  // Check if user is authenticated (session exists)
  if (!req.session || !req.session.user) {
    console.log(`❌ [AUTH] Unauthorized request to ${req.originalUrl}`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Please log in at /auth/login'
    });
  }

  console.log(`✅ [AUTH] Authorized, passing to next middleware`);
  // User is authenticated, continue to next middleware
  next();
}

/**
 * Middleware to require authentication for browser pages (HTML)
 * Redirects to login page if not authenticated
 */
function requireAuthBrowser(req, res, next) {
  // Check if user is authenticated (session exists)
  console.log(`🔐 requireAuthBrowser check for ${req.originalUrl}:`, {
    hasSession: !!req.session,
    sessionID: req.sessionID,
    hasUser: !!(req.session && req.session.user),
    userId: req.session?.user?.user_id,
    workspaceId: req.session?.user?.workspace_id,
    cookies: req.headers.cookie ? 'present' : 'missing',
    sessionKeys: req.session ? Object.keys(req.session) : []
  });

  if (!req.session || !req.session.user) {
    // Log session failure for debugging
    console.log(`❌ Session invalid for ${req.originalUrl} - redirecting to login`);
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
    console.log(`❌ [WORKSPACE] No session/user`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  // Get workspace_id from query params (for GET) or body (for POST)
  const requestedWorkspaceId = req.query.workspace_id || req.body?.workspace_id;

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

/** Google sources the Drive Picker needs (Settings only; docs/specs/2026-10-context-from-drive.md) */
const DRIVE_PICKER_SOURCES = {
  script: 'https://apis.google.com https://accounts.google.com/gsi/client',
  style: 'https://accounts.google.com/gsi/style',
  frame: 'https://docs.google.com https://drive.google.com https://accounts.google.com',
  connect: 'https://accounts.google.com/gsi/'
};

/**
 * The Content-Security-Policy header value
 * @param {{ drivePicker?: boolean }} [options] - drivePicker: also allow Google's Picker scripts and frames
 * @returns {string}
 */
function buildCsp({ drivePicker = false } = {}) {
  const extra = kind => (drivePicker ? ` ${DRIVE_PICKER_SOURCES[kind]}` : '');
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${extra('script')}`, // no third-party scripts (except the Drive Picker on Settings); unsafe-inline is still needed for inline scripts and onclick handlers (to remove next)
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${extra('style')}`, // unsafe-inline needed for inline styles, Google Fonts for Material icons
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com", // Google Fonts for Material icons
    `connect-src 'self'${extra('connect')}`,
    ...(drivePicker ? [`frame-src ${DRIVE_PICKER_SOURCES.frame}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests"
  ].join('; ');
}

/**
 * Opens the policy for the Google Drive Picker on this response (Settings page only). The
 * Picker's API key is restricted by referrer, so the page sends its origin (not the path).
 * @param {import('express').Response} res
 */
function allowDrivePicker(res) {
  res.setHeader('Content-Security-Policy', buildCsp({ drivePicker: true }));
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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
  res.setHeader('Content-Security-Policy', buildCsp());

  // Only add HSTS in production (requires HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

/**
 * Who a rate limit counts against: the signed-in person (so colleagues behind one office IP
 * don't share a budget), or the IP when there's no session
 * @param {import('express').Request} req
 * @returns {string}
 */
function rateLimitKey(req) {
  const user = req.session?.user;
  if (user?.user_id) return `user:${user.workspace_id}:${user.user_id}`;
  return `ip:${ipKeyGenerator(req.ip || '')}`;
}

const API_LIMIT_SIGNED_IN = 1000; // per person per 15 min: a busy session (Home, editing cards) makes a few hundred
const API_LIMIT_ANONYMOUS = 100; // per IP per 15 min

/**
 * Rate limiting for API endpoints (prevents abuse and DoS)
 */
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: req => (req.session?.user?.user_id ? API_LIMIT_SIGNED_IN : API_LIMIT_ANONYMOUS),
  keyGenerator: rateLimitKey,
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
  max: 20, // 20 AI requests per hour per person (per IP without a session)
  keyGenerator: rateLimitKey,
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
  buildCsp,
  allowDrivePicker,
  apiRateLimiter,
  authRateLimiter,
  aiRateLimiter,
  rateLimitKey
};
