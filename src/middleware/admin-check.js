const { getSlackClient } = require('../config/slack-client');

/**
 * Admin validation middleware
 * Checks if a user has workspace admin privileges in Slack
 */

/**
 * Check if a user is a Slack workspace admin
 * @param {WebClient} client - Authenticated Slack Web API client
 * @param {string} userId - Slack user ID
 * @param {string} workspaceId - Slack workspace/team ID
 * @returns {Promise<boolean>} true if user is admin, owner, or primary owner
 */
async function isWorkspaceAdmin(client, userId, workspaceId) {
  try {
    const userInfo = await client.users.info({ user: userId });

    if (!userInfo.ok || !userInfo.user) {
      console.error(`❌ Failed to fetch user info for ${userId} in ${workspaceId}`);
      return false;
    }

    // Check if user is admin, owner, or primary owner
    const isAdmin = userInfo.user.is_admin === true;
    const isOwner = userInfo.user.is_owner === true;
    const isPrimaryOwner = userInfo.user.is_primary_owner === true;

    return isAdmin || isOwner || isPrimaryOwner;
  } catch (error) {
    console.error(`❌ Error checking admin status for ${userId} in ${workspaceId}:`, error.message);
    // Fail secure - deny access on error
    return false;
  }
}

/**
 * Express middleware to require workspace admin access
 * Returns 403 if user is not a workspace admin
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next middleware
 */
async function requireWorkspaceAdmin(req, res, next) {
  try {
    // Check if authenticated
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    const workspaceId = req.session.user.workspace_id;
    const userId = req.session.user.user_id;

    if (!workspaceId || !userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid session data'
      });
    }

    // Get Slack client for this workspace
    const client = await getSlackClient(workspaceId);

    // Check if user is admin
    const isAdmin = await isWorkspaceAdmin(client, userId, workspaceId);

    if (!isAdmin) {
      console.log(`⚠️  Non-admin user ${userId} attempted to access admin endpoint in ${workspaceId}`);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only workspace admins can configure settings'
      });
    }

    // User is admin, continue
    next();
  } catch (error) {
    console.error('❌ Error in requireWorkspaceAdmin middleware:', error.message);
    // Fail secure - deny access on error
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify admin status'
    });
  }
}

module.exports = {
  isWorkspaceAdmin,
  requireWorkspaceAdmin
};
