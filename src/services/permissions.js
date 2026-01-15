const { getWorkspaceAdminsCollection } = require('../config/database');
const { isWorkspaceAdmin: isSlackAdmin } = require('../middleware/admin-check');
const { getSlackClient } = require('../config/slack-client');

/**
 * Role-based permission service
 * Manages admin roles and access control
 */

/**
 * Check if user is an admin
 * Priority:
 * 1. Check workspace_admins collection
 * 2. Fallback to Slack admin status (auto-promotes on first check)
 */
async function isAdmin(client, workspaceId, userId) {
  try {
    const collection = getWorkspaceAdminsCollection();

    // 1. Check database for admin record
    const adminRecord = await collection.findOne({
      workspace_id: workspaceId,
      user_id: userId,
      role: 'admin',
      deactivated_at: null
    });

    if (adminRecord) {
      return true;
    }

    // 2. Fallback: Check Slack admin status
    const isSlackAdminUser = await isSlackAdmin(client, userId, workspaceId);

    if (isSlackAdminUser) {
      // Auto-promote Slack admin to app admin
      console.log(`✅ Auto-promoting Slack admin ${userId} to app admin in workspace ${workspaceId}`);
      await promoteToAdmin(workspaceId, userId, 'slack_admin', null);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking admin status:', error);
    // Fail secure: return false on error
    return false;
  }
}

/**
 * Promote user to admin
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User ID to promote
 * @param {string} source - 'slack_admin' or 'assigned'
 * @param {string|null} assignedBy - User ID who assigned (null for slack_admin)
 */
async function promoteToAdmin(workspaceId, userId, source = 'assigned', assignedBy = null) {
  try {
    const collection = getWorkspaceAdminsCollection();

    // Get user info from Slack
    const client = await getSlackClient(workspaceId);
    const userInfo = await client.users.info({ user: userId });
    const userName = userInfo.user.name;
    const email = userInfo.user.profile?.email || null;

    // Get assigner info if provided
    let assignedByName = null;
    if (assignedBy) {
      const assignerInfo = await client.users.info({ user: assignedBy });
      assignedByName = assignerInfo.user.name;
    }

    // Upsert admin record
    await collection.updateOne(
      { workspace_id: workspaceId, user_id: userId },
      {
        $set: {
          workspace_id: workspaceId,
          user_id: userId,
          user_name: userName,
          email: email,
          role: 'admin',
          source: source,
          assigned_by: assignedBy,
          assigned_by_name: assignedByName,
          assigned_at: new Date().toISOString(),
          is_slack_admin: source === 'slack_admin',
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deactivated_at: null  // Reactivate if previously deactivated
        },
        $setOnInsert: {
          created_at: new Date().toISOString()
        }
      },
      { upsert: true }
    );

    console.log(`✅ Promoted ${userName} (${userId}) to admin in workspace ${workspaceId}`);
    return true;
  } catch (error) {
    console.error('Error promoting to admin:', error);
    throw error;
  }
}

/**
 * Demote admin to non-admin (soft delete)
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User ID to demote
 */
async function demoteFromAdmin(workspaceId, userId) {
  try {
    const collection = getWorkspaceAdminsCollection();

    await collection.updateOne(
      { workspace_id: workspaceId, user_id: userId },
      {
        $set: {
          deactivated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }
    );

    console.log(`✅ Demoted user ${userId} from admin in workspace ${workspaceId}`);
    return true;
  } catch (error) {
    console.error('Error demoting from admin:', error);
    throw error;
  }
}

/**
 * List all admins for a workspace
 * @param {string} workspaceId - Workspace ID
 * @returns {Array} Array of admin records
 */
async function listAdmins(workspaceId) {
  try {
    const collection = getWorkspaceAdminsCollection();

    return await collection.find({
      workspace_id: workspaceId,
      role: 'admin',
      deactivated_at: null
    }).toArray();
  } catch (error) {
    console.error('Error listing admins:', error);
    throw error;
  }
}

/**
 * Check if user can edit/delete a specific decision
 * Rules:
 * - Admins can modify any decision
 * - Non-admins can only modify their own decisions
 *
 * @param {object} client - Slack client
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User ID attempting the action
 * @param {string} decisionCreatorId - User ID who created the decision
 * @returns {boolean} true if user can modify the decision
 */
async function canModifyDecision(client, workspaceId, userId, decisionCreatorId) {
  try {
    // Admins can modify any decision
    if (await isAdmin(client, workspaceId, userId)) {
      return true;
    }

    // Non-admins can only modify their own decisions
    return userId === decisionCreatorId;
  } catch (error) {
    console.error('Error checking modification permission:', error);
    // Fail secure: deny access on error
    return false;
  }
}

module.exports = {
  isAdmin,
  promoteToAdmin,
  demoteFromAdmin,
  listAdmins,
  canModifyDecision
};
