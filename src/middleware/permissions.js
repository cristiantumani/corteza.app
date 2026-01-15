const { isAdmin } = require('../services/permissions');
const { getSlackClient } = require('../config/slack-client');

/**
 * Express middleware for role-based access control
 */

/**
 * Require admin role for API endpoint
 * Usage: expressApp.get('/api/admin-only', apiRateLimiter, requireAuth, requireAdmin, handler);
 */
async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const { workspace_id, user_id } = req.session.user;

  try {
    const client = await getSlackClient(workspace_id);
    const userIsAdmin = await isAdmin(client, workspace_id, user_id);

    if (!userIsAdmin) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Forbidden',
        message: 'Admin access required'
      }));
      return;
    }

    // Attach admin status to request for downstream handlers
    req.user = {
      ...req.session.user,
      is_admin: true
    };

    next();
  } catch (error) {
    console.error('❌ Permission check error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Permission check failed' }));
    return;
  }
}

module.exports = {
  requireAdmin
};
