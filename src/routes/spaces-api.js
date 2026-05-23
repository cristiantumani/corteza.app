const express = require('express');
const crypto = require('crypto');
const {
  getWorkspaceSpacesCollection,
  getSpaceMembersCollection,
  getDecisionsCollection
} = require('../config/database');
const {
  isAdmin,
  canAccessSpace,
  getUserAccessibleSpaces,
  canModifySpace,
  addSpaceMember,
  removeSpaceMember
} = require('../services/permissions');
const { getSlackClient } = require('../config/slack-client');

const router = express.Router();

// Apply JSON body parser to all routes in this router
router.use(express.json());

/**
 * Helper function to safely get Slack client
 * Returns null if client is unavailable (e.g., test workspaces)
 */
async function getSlackClientSafe(workspaceId) {
  try {
    return await getSlackClient(workspaceId);
  } catch (error) {
    // Slack client unavailable (e.g., test workspace) - continue with database-only checks
    return null;
  }
}

/**
 * GET /api/spaces?workspace_id=X
 * List all accessible spaces for the current user
 */
router.get('/api/spaces', async (req, res) => {
  try {
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;

    // Get Slack client (optional for test workspaces - returns null if unavailable)
    const client = await getSlackClientSafe(workspace_id);

    // Check if user is workspace admin
    const userIsAdmin = await isAdmin(client, workspace_id, userId);

    // Fetch space details
    const spacesCollection = getWorkspaceSpacesCollection();
    let spaces;

    if (userIsAdmin) {
      // Admins can SEE all spaces (for management), even if they can't access content
      spaces = await spacesCollection.find({
        workspace_id: workspace_id,
        archived: false
      }).sort({ is_default: -1, created_at: 1 }).toArray();
    } else {
      // Regular users only see accessible spaces
      const accessibleSpaceIds = await getUserAccessibleSpaces(client, workspace_id, userId);

      if (accessibleSpaceIds.length === 0) {
        return res.json({ success: true, spaces: [] });
      }

      spaces = await spacesCollection.find({
        workspace_id: workspace_id,
        space_id: { $in: accessibleSpaceIds },
        archived: false
      }).sort({ is_default: -1, created_at: 1 }).toArray();
    }

    // Get decision counts for each space
    const decisionsCollection = getDecisionsCollection();

    const spacesWithMetadata = await Promise.all(spaces.map(async (space) => {
      // Count decisions in this space
      const decisionCount = await decisionsCollection.countDocuments({
        workspace_id: workspace_id,
        space_id: space.space_id
      });

      // Check if user is creator (for display purposes)
      const isCreator = space.created_by === userId;

      // Determine user's role in this space
      let userRole = null;
      const membersCollection = getSpaceMembersCollection();

      if (space.visibility === 'public') {
        // Public spaces: everyone in workspace is auto-member
        userRole = 'member';
      } else if (space.visibility === 'private' || space.visibility === 'shared') {
        // Private/Shared: check explicit membership (even creator needs to be added)
        const membership = await membersCollection.findOne({
          space_id: space.space_id,
          user_id: userId,
          removed_at: null
        });
        userRole = membership?.role || null;
      }

      return {
        ...space,
        decision_count: decisionCount,
        is_creator: isCreator,  // Who created it (may not be member)
        user_role: userRole,    // Actual role in space (null if not member)
        can_modify: userIsAdmin || isCreator || userRole === 'admin'  // Admins + creator + space admins can manage
      };
    }));

    res.json({ success: true, spaces: spacesWithMetadata });
  } catch (error) {
    console.error('❌ Error listing spaces:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ success: false, error: 'Failed to list spaces' });
  }
});

/**
 * POST /api/spaces
 * Create a new space
 * Body: { workspace_id, name, description, visibility, settings }
 */
router.post('/api/spaces', async (req, res) => {
  try {
    const { workspace_id, name, description, visibility, settings } = req.body;

    // Validation
    if (!workspace_id || !name || !visibility) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: workspace_id, name, visibility'
      });
    }

    if (!['private', 'shared', 'public'].includes(visibility)) {
      return res.status(400).json({
        error: 'Invalid visibility. Must be: private, shared, or public'
      });
    }

    if (name.length > 50) {
      return res.status(400).json({
        error: 'Space name must be 50 characters or less'
      });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const userName = req.session.user.user_name;

    // Generate space ID
    const spaceId = `sp_${crypto.randomBytes(12).toString('hex')}`;

    // Create space document
    const space = {
      space_id: spaceId,
      workspace_id: workspace_id,
      name: name.trim(),
      description: description?.trim() || '',
      visibility: visibility,
      created_by: userId,
      created_by_name: userName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_default: false,
      archived: false,
      archived_at: null,
      settings: {
        color: settings?.color || '#667eea',
        icon: settings?.icon || '📁'
      }
    };

    const spacesCollection = getWorkspaceSpacesCollection();
    await spacesCollection.insertOne(space);

    console.log(`✅ Created space: ${spaceId} (${name}) in workspace ${workspace_id} with visibility: ${visibility}`);

    // NOTE: Creator is NOT auto-added to private/shared spaces
    // They must explicitly add themselves as a member if they want access
    // This ensures even admins don't get automatic access to private spaces they create

    res.status(201).json({
      success: true,
      space: space
    });
  } catch (error) {
    console.error('Error creating space:', error);
    console.error('Error details:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to create space: ${error.message}`
    });
  }
});

/**
 * GET /api/spaces/:space_id
 * Get details of a specific space
 */
router.get('/api/spaces/:space_id', async (req, res) => {
  try {
    const { space_id } = req.params;
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const client = await getSlackClientSafe(workspace_id);

    // Check if user can access this space
    const canAccess = await canAccessSpace(client, workspace_id, space_id, userId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied to this space' });
    }

    // Get space details
    const spacesCollection = getWorkspaceSpacesCollection();
    const space = await spacesCollection.findOne({
      workspace_id: workspace_id,
      space_id: space_id,
      archived: false
    });

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    // Get member count for shared spaces
    let memberCount = 0;
    if (space.visibility === 'shared') {
      const membersCollection = getSpaceMembersCollection();
      memberCount = await membersCollection.countDocuments({
        space_id: space_id,
        removed_at: null
      });
    }

    // Get decision count
    const decisionsCollection = getDecisionsCollection();
    const decisionCount = await decisionsCollection.countDocuments({
      workspace_id: workspace_id,
      space_id: space_id
    });

    res.json({
      success: true,
      space: {
        ...space,
        member_count: memberCount,
        decision_count: decisionCount,
        is_owner: space.created_by === userId
      }
    });
  } catch (error) {
    console.error('Error getting space:', error);
    res.status(500).json({ error: 'Failed to get space details' });
  }
});

/**
 * PUT /api/spaces/:space_id
 * Update space settings
 * Body: { name, description, visibility, settings }
 */
router.put('/api/spaces/:space_id', async (req, res) => {
  try {
    const { space_id } = req.params;
    const { workspace_id, name, description, visibility, settings } = req.body;

    if (!workspace_id) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const client = await getSlackClientSafe(workspace_id);

    // Check if user can modify this space
    const canModify = await canModifySpace(client, workspace_id, space_id, userId);
    if (!canModify) {
      return res.status(403).json({
        error: 'You do not have permission to modify this space'
      });
    }

    // Build update document
    const updates = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) {
      if (name.length > 50) {
        return res.status(400).json({
          error: 'Space name must be 50 characters or less'
        });
      }
      updates.name = name.trim();
    }

    if (description !== undefined) {
      updates.description = description.trim();
    }

    if (visibility !== undefined) {
      if (!['private', 'shared', 'public'].includes(visibility)) {
        return res.status(400).json({
          error: 'Invalid visibility. Must be: private, shared, or public'
        });
      }
      updates.visibility = visibility;
    }

    if (settings !== undefined) {
      updates['settings.color'] = settings.color || '#667eea';
      updates['settings.icon'] = settings.icon || '📁';
    }

    // Update space
    const spacesCollection = getWorkspaceSpacesCollection();
    const result = await spacesCollection.updateOne(
      {
        workspace_id: workspace_id,
        space_id: space_id,
        archived: false
      },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Space not found' });
    }

    console.log(`✅ Updated space: ${space_id}`);

    res.json({
      success: true,
      message: 'Space updated successfully'
    });
  } catch (error) {
    console.error('Error updating space:', error);
    res.status(500).json({ error: 'Failed to update space' });
  }
});

/**
 * DELETE /api/spaces/:space_id
 * Archive a space (soft delete)
 * Only owner or workspace admin can delete
 * Cannot delete default space
 */
router.delete('/api/spaces/:space_id', async (req, res) => {
  try {
    const { space_id } = req.params;
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const client = await getSlackClientSafe(workspace_id);

    // Get space details
    const spacesCollection = getWorkspaceSpacesCollection();
    const space = await spacesCollection.findOne({
      workspace_id: workspace_id,
      space_id: space_id,
      archived: false
    });

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    // Cannot delete default space
    if (space.is_default) {
      return res.status(400).json({
        error: 'Cannot delete the default space'
      });
    }

    // Only owner or workspace admin can delete
    const userIsAdmin = await isAdmin(client, workspace_id, userId);
    const isOwner = space.created_by === userId;

    if (!userIsAdmin && !isOwner) {
      return res.status(403).json({
        error: 'Only the space owner or workspace admins can delete this space'
      });
    }

    // Archive the space
    await spacesCollection.updateOne(
      {
        workspace_id: workspace_id,
        space_id: space_id
      },
      {
        $set: {
          archived: true,
          archived_at: new Date().toISOString()
        }
      }
    );

    console.log(`✅ Archived space: ${space_id} (${space.name})`);

    res.json({
      success: true,
      message: 'Space archived successfully'
    });
  } catch (error) {
    console.error('Error deleting space:', error);
    res.status(500).json({ error: 'Failed to delete space' });
  }
});

/**
 * GET /api/spaces/:space_id/members
 * List all members of a space
 */
router.get('/api/spaces/:space_id/members', async (req, res) => {
  try {
    const { space_id } = req.params;
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const client = await getSlackClientSafe(workspace_id);

    // Check if user can access this space
    const canAccess = await canAccessSpace(client, workspace_id, space_id, userId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied to this space' });
    }

    // Get space to check if it's shared
    const spacesCollection = getWorkspaceSpacesCollection();
    const space = await spacesCollection.findOne({
      workspace_id: workspace_id,
      space_id: space_id,
      archived: false
    });

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    // Public spaces don't have explicit members
    if (space.visibility === 'public') {
      return res.json({ success: true, members: [] });
    }

    // Get members for private/shared spaces
    const membersCollection = getSpaceMembersCollection();
    const spaceMembers = await membersCollection.find({
      space_id: space_id,
      removed_at: null
    }).sort({ added_at: 1 }).toArray();

    // Enrich with email from workspace_members
    const { getWorkspaceMembersCollection } = require('../config/database');
    const workspaceMembersCollection = getWorkspaceMembersCollection();

    const enrichedMembers = await Promise.all(spaceMembers.map(async (member) => {
      // Try to get email from workspace_members
      const workspaceMember = await workspaceMembersCollection.findOne({
        workspace_id: workspace_id,
        user_id: member.user_id,
        removed_at: null
      });

      return {
        ...member,
        email: workspaceMember?.email || null,
        user_name: member.user_name || workspaceMember?.user_name || member.user_id
      };
    }));

    res.json({
      success: true,
      members: enrichedMembers
    });
  } catch (error) {
    console.error('Error listing space members:', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

/**
 * POST /api/spaces/:space_id/members
 * Add a member to a space
 * Body: { user_id, user_name, role }
 */
router.post('/api/spaces/:space_id/members', async (req, res) => {
  try {
    const { space_id } = req.params;
    const { workspace_id, user_id, user_name, email, role } = req.body;

    // Accept either email or user_id (backwards compatibility)
    if (!workspace_id || (!user_id && !email) || !role) {
      return res.status(400).json({
        error: 'Missing required fields: workspace_id, (email or user_id), role'
      });
    }

    if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
      return res.status(400).json({
        error: 'Invalid role. Must be: owner, admin, member, or viewer'
      });
    }

    // If email provided, look up user_id from workspace members
    let finalUserId = user_id;
    let finalUserName = user_name;

    if (email && !user_id) {
      const { getWorkspaceMembersCollection } = require('../config/database');
      const workspaceMembersCollection = getWorkspaceMembersCollection();

      const normalizedEmail = email.toLowerCase().trim();
      console.log(`📧 Looking up user by email: ${normalizedEmail} in workspace: ${workspace_id}`);

      // Look up user by email in workspace_members
      const workspaceMember = await workspaceMembersCollection.findOne({
        workspace_id: workspace_id,
        email: normalizedEmail,
        removed_at: null
      });

      console.log(`📧 Workspace member found:`, workspaceMember ? `Yes (${workspaceMember.user_id})` : 'No');

      if (!workspaceMember) {
        // FALLBACK: For email-authenticated users, try generating user_id from email
        // This handles existing users who were added before email was stored in session
        const crypto = require('crypto');
        const generatedUserId = `U${crypto.createHash('md5').update(normalizedEmail).digest('hex').substring(0, 8).toUpperCase()}`;
        console.log(`📧 Generated user_id from email: ${generatedUserId}`);

        const memberByUserId = await workspaceMembersCollection.findOne({
          workspace_id: workspace_id,
          user_id: generatedUserId,
          removed_at: null
        });

        if (memberByUserId) {
          console.log(`✅ Found member by generated user_id (old record without email)`);
          // Update the record to include email for future lookups
          await workspaceMembersCollection.updateOne(
            { _id: memberByUserId._id },
            { $set: { email: normalizedEmail } }
          );
          console.log(`✅ Updated workspace_members record with email: ${normalizedEmail}`);

          finalUserId = memberByUserId.user_id;
          finalUserName = memberByUserId.user_name || email;
        } else {
          // Debug: Show all members in this workspace
          const allMembers = await workspaceMembersCollection.find({
            workspace_id: workspace_id,
            removed_at: null
          }).toArray();
          console.log(`📧 All members in workspace ${workspace_id}:`, allMembers.map(m => ({ email: m.email, user_id: m.user_id })));

          return res.status(404).json({
            error: 'User not found in workspace',
            message: 'This email is not a member of the workspace. Please invite them to the workspace first via Team Invitations.'
          });
        }
      } else {
        finalUserId = workspaceMember.user_id;
        finalUserName = workspaceMember.user_name || email;
        console.log(`✅ Resolved email ${email} to user_id ${finalUserId}`);
      }
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentUserId = req.session.user.user_id;
    const currentUserName = req.session.user.user_name;
    const client = await getSlackClientSafe(workspace_id);

    // Check if current user can modify this space
    const canModify = await canModifySpace(client, workspace_id, space_id, currentUserId);
    if (!canModify) {
      return res.status(403).json({
        error: 'You do not have permission to add members to this space'
      });
    }

    // Get space details
    const spacesCollection = getWorkspaceSpacesCollection();
    const space = await spacesCollection.findOne({
      workspace_id: workspace_id,
      space_id: space_id,
      archived: false
    });

    if (!space) {
      return res.status(404).json({ error: 'Space not found' });
    }

    // Only private and shared spaces support explicit membership
    if (space.visibility === 'public') {
      return res.status(400).json({
        error: 'Cannot add members to public spaces - all workspace members automatically have access'
      });
    }

    // Check if user is already a member
    const membersCollection = getSpaceMembersCollection();
    const existingMember = await membersCollection.findOne({
      space_id: space_id,
      user_id: finalUserId,
      removed_at: null
    });

    if (existingMember) {
      return res.status(400).json({
        error: 'User is already a member of this space'
      });
    }

    // Add member
    const membership = await addSpaceMember(
      workspace_id,
      space_id,
      finalUserId,
      finalUserName || finalUserId,
      role,
      currentUserId,
      currentUserName
    );

    console.log(`✅ Added member ${finalUserId} (${email || 'no email'}) to space ${space_id} with role ${role}`);

    res.status(201).json({
      success: true,
      membership: membership
    });
  } catch (error) {
    console.error('Error adding space member:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

/**
 * DELETE /api/spaces/:space_id/members/:user_id
 * Remove a member from a space
 */
router.delete('/api/spaces/:space_id/members/:user_id', async (req, res) => {
  try {
    const { space_id, user_id } = req.params;
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentUserId = req.session.user.user_id;
    const client = await getSlackClientSafe(workspace_id);

    // Check if current user can modify this space
    const canModify = await canModifySpace(client, workspace_id, space_id, currentUserId);
    if (!canModify) {
      return res.status(403).json({
        error: 'You do not have permission to remove members from this space'
      });
    }

    // Remove member
    await removeSpaceMember(space_id, user_id);

    console.log(`✅ Removed member ${user_id} from space ${space_id}`);

    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    console.error('Error removing space member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

/**
 * PUT /api/spaces/:space_id/members/:user_id
 * Update a member's role in a space
 * Body: { role }
 */
router.put('/api/spaces/:space_id/members/:user_id', async (req, res) => {
  try {
    const { space_id, user_id } = req.params;
    const { workspace_id, role } = req.body;

    if (!workspace_id || !role) {
      return res.status(400).json({
        error: 'Missing required fields: workspace_id, role'
      });
    }

    if (!['admin', 'member', 'viewer'].includes(role)) {
      return res.status(400).json({
        error: 'Invalid role. Must be: admin, member, or viewer'
      });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentUserId = req.session.user.user_id;
    const client = await getSlackClientSafe(workspace_id);

    // Check if current user can modify this space
    const canModify = await canModifySpace(client, workspace_id, space_id, currentUserId);
    if (!canModify) {
      return res.status(403).json({
        error: 'You do not have permission to update member roles in this space'
      });
    }

    // Update member role
    const membersCollection = getSpaceMembersCollection();
    const result = await membersCollection.updateOne(
      {
        space_id: space_id,
        user_id: user_id,
        removed_at: null
      },
      {
        $set: {
          role: role,
          updated_at: new Date().toISOString()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    console.log(`✅ Updated role for member ${user_id} in space ${space_id} to ${role}`);

    res.json({
      success: true,
      message: 'Member role updated successfully'
    });
  } catch (error) {
    console.error('Error updating member role:', error);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

/**
 * GET /api/spaces/:space_id/stats
 * Get statistics for a space
 */
router.get('/api/spaces/:space_id/stats', async (req, res) => {
  try {
    const { space_id } = req.params;
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const client = await getSlackClientSafe(workspace_id);

    // Check if user can access this space
    const canAccess = await canAccessSpace(client, workspace_id, space_id, userId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied to this space' });
    }

    const decisionsCollection = getDecisionsCollection();

    // Get total decisions
    const totalDecisions = await decisionsCollection.countDocuments({
      workspace_id: workspace_id,
      space_id: space_id
    });

    // Get decisions by type
    const decisionsByType = await decisionsCollection.aggregate([
      {
        $match: {
          workspace_id: workspace_id,
          space_id: space_id
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Get top contributors
    const topContributors = await decisionsCollection.aggregate([
      {
        $match: {
          workspace_id: workspace_id,
          space_id: space_id
        }
      },
      {
        $group: {
          _id: '$creator',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]).toArray();

    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentDecisions = await decisionsCollection.countDocuments({
      workspace_id: workspace_id,
      space_id: space_id,
      timestamp: { $gte: thirtyDaysAgo.toISOString() }
    });

    res.json({
      success: true,
      stats: {
        total_decisions: totalDecisions,
        recent_decisions_30d: recentDecisions,
        by_type: decisionsByType,
        top_contributors: topContributors
      }
    });
  } catch (error) {
    console.error('Error getting space stats:', error);
    res.status(500).json({ error: 'Failed to get space statistics' });
  }
});

module.exports = router;
