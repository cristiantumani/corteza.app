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

    // 2. Fallback: Check Slack admin status (only if client is available)
    if (client) {
      const isSlackAdminUser = await isSlackAdmin(client, userId, workspaceId);

      if (isSlackAdminUser) {
        // Auto-promote Slack admin to app admin
        console.log(`✅ Auto-promoting Slack admin ${userId} to app admin in workspace ${workspaceId}`);
        await promoteToAdmin(workspaceId, userId, 'slack_admin', null);
        return true;
      }
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

/**
 * Check if user can access a space
 * Rules:
 * - Workspace admins can access all spaces
 * - Private spaces: owner only
 * - Shared spaces: owner + members
 * - Public spaces: all workspace members
 *
 * @param {object} client - Slack client
 * @param {string} workspaceId - Workspace ID
 * @param {string} spaceId - Space ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} true if user can access the space
 */
async function canAccessSpace(client, workspaceId, spaceId, userId) {
  try {
    const { getWorkspaceSpacesCollection, getSpaceMembersCollection } = require('../config/database');

    // Workspace admins can access all spaces
    if (await isAdmin(client, workspaceId, userId)) {
      return true;
    }

    // Get space details
    const spacesCollection = getWorkspaceSpacesCollection();
    const space = await spacesCollection.findOne({
      workspace_id: workspaceId,
      space_id: spaceId,
      archived: false
    });

    if (!space) {
      return false; // Space doesn't exist or is archived
    }

    // Public spaces: everyone in workspace can access
    if (space.visibility === 'public') {
      return true;
    }

    // Private spaces: owner only
    if (space.visibility === 'private') {
      return space.created_by === userId;
    }

    // Shared spaces: check membership
    if (space.visibility === 'shared') {
      // Owner can access
      if (space.created_by === userId) {
        return true;
      }

      // Check if user is a member
      const membersCollection = getSpaceMembersCollection();
      const membership = await membersCollection.findOne({
        workspace_id: workspaceId,
        space_id: spaceId,
        user_id: userId,
        removed_at: null
      });

      return !!membership;
    }

    return false;
  } catch (error) {
    console.error('Error checking space access:', error);
    return false; // Fail secure
  }
}

/**
 * Get all space IDs that a user can access
 * @param {object} client - Slack client
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User ID
 * @returns {Promise<string[]>} Array of space IDs
 */
async function getUserAccessibleSpaces(client, workspaceId, userId) {
  try {
    console.log('🔍 getUserAccessibleSpaces called:', { workspaceId, userId });

    const { getWorkspaceSpacesCollection, getSpaceMembersCollection } = require('../config/database');

    const spacesCollection = getWorkspaceSpacesCollection();
    const membersCollection = getSpaceMembersCollection();

    // Workspace admins can access all spaces
    const userIsAdmin = await isAdmin(client, workspaceId, userId);
    console.log('🔍 User is admin?', userIsAdmin);

    if (userIsAdmin) {
      // Return all non-archived spaces
      const allSpaces = await spacesCollection.find({
        workspace_id: workspaceId,
        archived: false
      }).toArray();
      console.log('🔍 Admin sees all spaces:', allSpaces.length);
      return allSpaces.map(s => s.space_id);
    }

    // Get public spaces (everyone can access)
    const publicSpaces = await spacesCollection.find({
      workspace_id: workspaceId,
      visibility: 'public',
      archived: false
    }).toArray();
    console.log('🔍 Public spaces:', publicSpaces.length);

    // Get private spaces owned by user
    const privateSpaces = await spacesCollection.find({
      workspace_id: workspaceId,
      visibility: 'private',
      created_by: userId,
      archived: false
    }).toArray();
    console.log('🔍 Private spaces owned by user:', privateSpaces.length);

    // Get shared spaces where user is owner or member
    const sharedOwnedSpaces = await spacesCollection.find({
      workspace_id: workspaceId,
      visibility: 'shared',
      created_by: userId,
      archived: false
    }).toArray();
    console.log('🔍 Shared spaces owned by user:', sharedOwnedSpaces.length);

    const memberships = await membersCollection.find({
      workspace_id: workspaceId,
      user_id: userId,
      removed_at: null
    }).toArray();

    const sharedMemberSpaceIds = memberships.map(m => m.space_id);
    const sharedMemberSpaces = await spacesCollection.find({
      workspace_id: workspaceId,
      space_id: { $in: sharedMemberSpaceIds },
      visibility: 'shared',
      archived: false
    }).toArray();

    // Combine all accessible spaces
    const allAccessibleSpaces = [
      ...publicSpaces,
      ...privateSpaces,
      ...sharedOwnedSpaces,
      ...sharedMemberSpaces
    ];

    // Deduplicate by space_id
    const uniqueSpaceIds = [...new Set(allAccessibleSpaces.map(s => s.space_id))];
    console.log('🔍 Total unique accessible spaces:', uniqueSpaceIds.length);
    console.log('🔍 Space IDs:', uniqueSpaceIds);
    return uniqueSpaceIds;
  } catch (error) {
    console.error('Error getting accessible spaces:', error);
    return []; // Fail secure - return empty array
  }
}

/**
 * Check if user can create decisions in a space
 * Rules:
 * - Workspace admins can create anywhere
 * - Public spaces: all workspace members can create
 * - Private spaces: owner only
 * - Shared spaces: owner, admins, and members (not viewers)
 *
 * @param {object} client - Slack client
 * @param {string} workspaceId - Workspace ID
 * @param {string} spaceId - Space ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} true if user can create in the space
 */
async function canCreateInSpace(client, workspaceId, spaceId, userId) {
  try {
    const { getWorkspaceSpacesCollection, getSpaceMembersCollection } = require('../config/database');

    // Workspace admins can create anywhere
    if (await isAdmin(client, workspaceId, userId)) {
      return true;
    }

    // Get space details
    const spacesCollection = getWorkspaceSpacesCollection();
    const space = await spacesCollection.findOne({
      workspace_id: workspaceId,
      space_id: spaceId,
      archived: false
    });

    if (!space) {
      return false;
    }

    // Public spaces: everyone can create
    if (space.visibility === 'public') {
      return true;
    }

    // Private spaces: owner only
    if (space.visibility === 'private') {
      return space.created_by === userId;
    }

    // Shared spaces: check role
    if (space.visibility === 'shared') {
      // Owner can create
      if (space.created_by === userId) {
        return true;
      }

      // Check member role (viewers can't create)
      const membersCollection = getSpaceMembersCollection();
      const membership = await membersCollection.findOne({
        workspace_id: workspaceId,
        space_id: spaceId,
        user_id: userId,
        removed_at: null
      });

      if (!membership) {
        return false;
      }

      // Owner, admin, and member roles can create (viewer cannot)
      return ['owner', 'admin', 'member'].includes(membership.role);
    }

    return false;
  } catch (error) {
    console.error('Error checking create permission:', error);
    return false;
  }
}

/**
 * Check if user can modify space settings (edit name, description, etc.)
 * Rules:
 * - Workspace admins can modify any space
 * - Space owner can modify their space
 * - Space admins can modify space settings (but not delete)
 *
 * @param {object} client - Slack client
 * @param {string} workspaceId - Workspace ID
 * @param {string} spaceId - Space ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} true if user can modify the space
 */
async function canModifySpace(client, workspaceId, spaceId, userId) {
  try {
    const { getWorkspaceSpacesCollection, getSpaceMembersCollection } = require('../config/database');

    // Workspace admins can modify any space
    if (await isAdmin(client, workspaceId, userId)) {
      return true;
    }

    // Get space details
    const spacesCollection = getWorkspaceSpacesCollection();
    const space = await spacesCollection.findOne({
      workspace_id: workspaceId,
      space_id: spaceId,
      archived: false
    });

    if (!space) {
      return false;
    }

    // Owner can modify
    if (space.created_by === userId) {
      return true;
    }

    // Check if user is space admin
    const membersCollection = getSpaceMembersCollection();
    const membership = await membersCollection.findOne({
      workspace_id: workspaceId,
      space_id: spaceId,
      user_id: userId,
      removed_at: null
    });

    return membership && membership.role === 'admin';
  } catch (error) {
    console.error('Error checking modify space permission:', error);
    return false;
  }
}

/**
 * Add a member to a space
 * @param {string} workspaceId - Workspace ID
 * @param {string} spaceId - Space ID
 * @param {string} userId - User ID to add
 * @param {string} userName - User display name
 * @param {string} role - Member role (owner|admin|member|viewer)
 * @param {string} addedBy - User ID who is adding the member
 * @param {string} addedByName - Display name of user adding the member
 * @returns {Promise<object>} Membership record
 */
async function addSpaceMember(workspaceId, spaceId, userId, userName, role, addedBy, addedByName) {
  try {
    const { getSpaceMembersCollection } = require('../config/database');
    const crypto = require('crypto');

    const membersCollection = getSpaceMembersCollection();

    const membership = {
      membership_id: `mem_${crypto.randomBytes(12).toString('hex')}`,
      workspace_id: workspaceId,
      space_id: spaceId,
      user_id: userId,
      user_name: userName,
      role: role,
      added_by: addedBy,
      added_by_name: addedByName,
      added_at: new Date().toISOString(),
      removed_at: null
    };

    await membersCollection.insertOne(membership);
    return membership;
  } catch (error) {
    console.error('Error adding space member:', error);
    throw error;
  }
}

/**
 * Remove a member from a space (soft delete)
 * @param {string} spaceId - Space ID
 * @param {string} userId - User ID to remove
 * @returns {Promise<boolean>} Success status
 */
async function removeSpaceMember(spaceId, userId) {
  try {
    const { getSpaceMembersCollection } = require('../config/database');

    const membersCollection = getSpaceMembersCollection();

    await membersCollection.updateOne(
      {
        space_id: spaceId,
        user_id: userId,
        removed_at: null
      },
      {
        $set: {
          removed_at: new Date().toISOString()
        }
      }
    );

    return true;
  } catch (error) {
    console.error('Error removing space member:', error);
    throw error;
  }
}

module.exports = {
  isAdmin,
  promoteToAdmin,
  demoteFromAdmin,
  listAdmins,
  canModifyDecision,
  canAccessSpace,
  getUserAccessibleSpaces,
  canCreateInSpace,
  canModifySpace,
  addSpaceMember,
  removeSpaceMember
};
