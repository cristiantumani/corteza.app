const express = require('express');
const crypto = require('crypto');
const { getWorkspaceInvitesCollection, getWorkspaceMembersCollection, getWorkspaceAdminsCollection, getSpaceMembersCollection } = require('../config/database');
const { sendInviteEmail } = require('../utils/n8n-client');

const router = express.Router();

// Apply JSON body parser to all routes in this router
router.use(express.json());

/**
 * Workspace Invitations API
 *
 * Allows workspace admins to generate invite links for team members.
 * Invited users can join the workspace via the invite link.
 */

/**
 * POST /api/invites
 * Create a new workspace invite link
 *
 * Body: { workspace_id, role, expires_in_days, max_uses }
 * Returns: { invite_id, invite_url }
 */
router.post('/api/invites', async (req, res) => {
  try {
    const { workspace_id, role = 'member', expires_in_days = 30, max_uses = null, email = null, space_id = null, space_role = 'member' } = req.body;

    console.log('📧 POST /api/invites - Creating invite:', { workspace_id, role, email, space_id, space_role });

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const userName = req.session.user.user_name;
    const workspaceName = req.session.user.workspace_name || workspace_id;

    console.log('📧 User:', { userId, userName, workspaceName });

    // Verify user is workspace admin (or owner of their own workspace)
    const adminsCollection = getWorkspaceAdminsCollection();

    const isAdmin = await adminsCollection.findOne({
      workspace_id: workspace_id,
      user_id: userId,
      role: 'admin',
      deactivated_at: null
    });

    console.log('📧 Is admin?', !!isAdmin);

    // For email-authenticated workspaces, the creator is automatically admin
    // If no admin record exists but user's workspace matches, allow them to create invites
    const isWorkspaceOwner = req.session.user.workspace_id === workspace_id;

    if (!isAdmin && !isWorkspaceOwner) {
      console.log('⚠️  User not authorized - not admin and not workspace owner');
      return res.status(403).json({ success: false, error: 'Only workspace admins can create invites' });
    }

    // Generate unique invite token
    const inviteId = `inv_${crypto.randomBytes(16).toString('hex')}`;

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    // Create invite record
    const invitesCollection = getWorkspaceInvitesCollection();
    const invite = {
      invite_id: inviteId,
      workspace_id: workspace_id,
      workspace_name: workspaceName,
      invited_by: userId,
      invited_by_name: userName,
      role: role,
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      max_uses: max_uses,
      uses_count: 0,
      status: 'active',
      space_id: space_id || null,  // Optional: auto-add to space
      space_role: space_role || 'member'  // Role within the space
    };

    await invitesCollection.insertOne(invite);

    // Generate invite URL
    const baseUrl = process.env.APP_URL || 'https://app.corteza.app';
    const inviteUrl = `${baseUrl}/invite/${inviteId}`;

    // Send email if email address was provided
    let emailSent = false;
    if (email && email.trim().length > 0) {
      try {
        // Get space name if space_id is provided
        let spaceName = null;
        if (space_id) {
          const { getWorkspaceSpacesCollection } = require('../config/database');
          const spacesCollection = getWorkspaceSpacesCollection();
          const space = await spacesCollection.findOne({ space_id: space_id });
          spaceName = space?.name || null;
        }

        const emailResult = await sendInviteEmail({
          email: email.trim(),
          inviter_name: userName,
          workspace_name: workspaceName,
          role: role,
          invite_url: inviteUrl,
          expires_days: expires_in_days || 30,
          space_name: spaceName  // Include space name if inviting to specific space
        });
        emailSent = emailResult.success;
        console.log('📧 Invite email sent to:', email, spaceName ? `(space: ${spaceName})` : '');
      } catch (emailError) {
        console.error('⚠️  Failed to send invite email:', emailError);
        // Don't fail the invite creation if email fails
      }
    }

    res.json({
      success: true,
      invite_id: inviteId,
      invite_url: inviteUrl,
      expires_at: expiresAt.toISOString(),
      email_sent: emailSent
    });

  } catch (error) {
    console.error('Error creating invite:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ success: false, error: `Failed to create invite: ${error.message}` });
  }
});

/**
 * GET /api/invites
 * List all active invites for a workspace
 */
router.get('/api/invites', async (req, res) => {
  try {
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ success: false, error: 'workspace_id required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;

    // Verify user is workspace admin
    const adminsCollection = getWorkspaceAdminsCollection();

    const isAdmin = await adminsCollection.findOne({
      workspace_id: workspace_id,
      user_id: userId,
      role: 'admin',
      deactivated_at: null
    });

    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can view invites' });
    }

    // Get all invites for workspace
    const invitesCollection = getWorkspaceInvitesCollection();
    const invites = await invitesCollection.find({
      workspace_id: workspace_id
    }).sort({ created_at: -1 }).toArray();

    // Add invite URLs
    const baseUrl = process.env.APP_URL || 'https://app.corteza.app';
    const invitesWithUrls = invites.map(invite => ({
      ...invite,
      invite_url: `${baseUrl}/invite/${invite.invite_id}`,
      is_expired: new Date(invite.expires_at) < new Date()
    }));

    res.json({
      success: true,
      invites: invitesWithUrls
    });

  } catch (error) {
    console.error('Error listing invites:', error);
    res.status(500).json({ success: false, error: 'Failed to list invites' });
  }
});

/**
 * GET /api/invites/:invite_id
 * Get details about an invite (public endpoint)
 */
router.get('/api/invites/:invite_id', async (req, res) => {
  try {
    const { invite_id } = req.params;
    console.log('📧 GET /api/invites/:invite_id - Looking up invite:', invite_id);

    const invitesCollection = getWorkspaceInvitesCollection();

    const invite = await invitesCollection.findOne({ invite_id: invite_id });
    console.log('📧 Invite found:', !!invite);

    if (!invite) {
      console.log('❌ Invite not found in database');
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    // Check if expired
    const isExpired = new Date(invite.expires_at) < new Date();

    // Check if max uses reached
    const maxUsesReached = invite.max_uses && invite.uses_count >= invite.max_uses;

    // Check if revoked
    const isRevoked = invite.status === 'revoked';

    const isValid = !isExpired && !maxUsesReached && !isRevoked && invite.status === 'active';

    res.json({
      success: true,
      invite: {
        invite_id: invite.invite_id,
        workspace_id: invite.workspace_id,
        workspace_name: invite.workspace_name,
        invited_by_name: invite.invited_by_name,
        role: invite.role,
        created_at: invite.created_at,
        expires_at: invite.expires_at,
        is_valid: isValid,
        is_expired: isExpired,
        is_revoked: isRevoked,
        max_uses_reached: maxUsesReached
      }
    });

  } catch (error) {
    console.error('Error getting invite:', error);
    res.status(500).json({ success: false, error: 'Failed to get invite' });
  }
});

/**
 * POST /api/invites/:invite_id/signup
 * Sign up for new account via invite (for users without account)
 * Body: { email, password, full_name }
 */
router.post('/api/invites/:invite_id/signup', async (req, res) => {
  try {
    const { invite_id } = req.params;
    const { email, password, full_name } = req.body;

    // Validate inputs
    if (!email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and full name are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const invitesCollection = getWorkspaceInvitesCollection();
    const membersCollection = getWorkspaceMembersCollection();
    const spaceMembersCollection = getSpaceMembersCollection();

    // Get invite
    const invite = await invitesCollection.findOne({ invite_id: invite_id });

    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    // Validate invite
    const isExpired = new Date(invite.expires_at) < new Date();
    const maxUsesReached = invite.max_uses && invite.uses_count >= invite.max_uses;
    const isRevoked = invite.status === 'revoked';

    if (isExpired) {
      return res.status(400).json({ success: false, error: 'Invite has expired' });
    }

    if (maxUsesReached) {
      return res.status(400).json({ success: false, error: 'Invite has reached maximum uses' });
    }

    if (isRevoked || invite.status !== 'active') {
      return res.status(400).json({ success: false, error: 'Invite is no longer valid' });
    }

    // Check if email is already a member of this workspace
    const existingMember = await membersCollection.findOne({
      workspace_id: invite.workspace_id,
      email: normalizedEmail,
      removed_at: null
    });

    if (existingMember) {
      return res.status(400).json({
        success: false,
        error: 'This email is already a member of the workspace. Please login instead.'
      });
    }

    // Hash password
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Generate user_id (use email as user_id for email-based accounts)
    const userId = `email_${normalizedEmail.replace(/[^a-z0-9]/g, '_')}`;

    // Create workspace membership
    const membershipId = `mem_${crypto.randomBytes(12).toString('hex')}`;
    const membership = {
      membership_id: membershipId,
      workspace_id: invite.workspace_id,
      workspace_name: invite.workspace_name,
      user_id: userId,
      user_name: full_name,
      email: normalizedEmail,
      password_hash: passwordHash,
      password_set_at: new Date().toISOString(),
      role: invite.role || 'member',
      joined_via: 'invite',
      invited_by: invite.invited_by,
      invited_by_name: invite.invited_by_name,
      joined_at: new Date().toISOString(),
      removed_at: null,
      onboarding_completed: true,  // ✅ Already provided name, email, password - skip onboarding
      onboarding_completed_at: new Date().toISOString()
    };

    await membersCollection.insertOne(membership);

    // Add to space if invite includes space_id
    if (invite.space_id) {
      const spaceMembershipId = `smem_${crypto.randomBytes(12).toString('hex')}`;
      const spaceMembership = {
        membership_id: spaceMembershipId,
        workspace_id: invite.workspace_id,
        space_id: invite.space_id,
        user_id: userId,
        user_name: full_name,
        role: invite.space_role || 'member',
        added_by: invite.invited_by,
        added_by_name: invite.invited_by_name,
        added_at: new Date().toISOString(),
        removed_at: null
      };

      await spaceMembersCollection.insertOne(spaceMembership);
    }

    // Increment invite uses count
    await invitesCollection.updateOne(
      { invite_id: invite_id },
      {
        $inc: { uses_count: 1 },
        $set: { last_used_at: new Date().toISOString() }
      }
    );

    // Create session
    req.session.user = {
      user_id: userId,
      user_name: full_name,
      workspace_id: invite.workspace_id,
      workspace_name: invite.workspace_name,
      email: normalizedEmail,
      authenticated_at: new Date().toISOString()
    };

    console.log(`✅ New user signed up via invite: ${normalizedEmail} joined ${invite.workspace_name}`);

    res.json({
      success: true,
      workspace_id: invite.workspace_id,
      workspace_name: invite.workspace_name,
      space_id: invite.space_id || null,
      needs_onboarding: false  // ✅ Skip onboarding - user already provided all required info
    });

  } catch (error) {
    console.error('Error signing up via invite:', error);
    res.status(500).json({ success: false, error: 'Failed to create account' });
  }
});

/**
 * POST /api/invites/:invite_id/accept
 * Accept an invite and join the workspace (for existing users)
 */
router.post('/api/invites/:invite_id/accept', async (req, res) => {
  try {
    const { invite_id } = req.params;

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const userName = req.session.user.user_name;
    const userEmail = req.session.user.email;

    const invitesCollection = getWorkspaceInvitesCollection();
    const membersCollection = getWorkspaceMembersCollection();

    // Get invite
    const invite = await invitesCollection.findOne({ invite_id: invite_id });

    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    // Validate invite
    const isExpired = new Date(invite.expires_at) < new Date();
    const maxUsesReached = invite.max_uses && invite.uses_count >= invite.max_uses;
    const isRevoked = invite.status === 'revoked';

    if (isExpired) {
      return res.status(400).json({ success: false, error: 'Invite has expired' });
    }

    if (maxUsesReached) {
      return res.status(400).json({ success: false, error: 'Invite has reached maximum uses' });
    }

    if (isRevoked || invite.status !== 'active') {
      return res.status(400).json({ success: false, error: 'Invite is no longer valid' });
    }

    // Check if user is already a member
    const existingMember = await membersCollection.findOne({
      workspace_id: invite.workspace_id,
      user_id: userId,
      removed_at: null
    });

    if (existingMember) {
      return res.status(400).json({ success: false, error: 'You are already a member of this workspace' });
    }

    // Add user to workspace
    const membershipId = `mem_${crypto.randomBytes(12).toString('hex')}`;
    const membership = {
      membership_id: membershipId,
      workspace_id: invite.workspace_id,
      workspace_name: invite.workspace_name,
      user_id: userId,
      user_name: userName,
      email: userEmail,
      role: invite.role,
      joined_via: 'invite',
      invited_by: invite.invited_by,
      invited_by_name: invite.invited_by_name,
      joined_at: new Date().toISOString(),
      removed_at: null
    };

    await membersCollection.insertOne(membership);

    // Add to space if invite includes space_id
    if (invite.space_id) {
      const spaceMembersCollection = getSpaceMembersCollection();
      const spaceMembershipId = `smem_${crypto.randomBytes(12).toString('hex')}`;
      const spaceMembership = {
        membership_id: spaceMembershipId,
        workspace_id: invite.workspace_id,
        space_id: invite.space_id,
        user_id: userId,
        user_name: userName,
        role: invite.space_role || 'member',
        added_by: invite.invited_by,
        added_by_name: invite.invited_by_name,
        added_at: new Date().toISOString(),
        removed_at: null
      };

      await spaceMembersCollection.insertOne(spaceMembership);
    }

    // Increment invite uses count
    await invitesCollection.updateOne(
      { invite_id: invite_id },
      {
        $inc: { uses_count: 1 },
        $set: { last_used_at: new Date().toISOString() }
      }
    );

    // Update user session with new workspace
    req.session.user.workspace_id = invite.workspace_id;
    req.session.user.workspace_name = invite.workspace_name;

    res.json({
      success: true,
      workspace_id: invite.workspace_id,
      workspace_name: invite.workspace_name,
      space_id: invite.space_id || null,
      role: invite.role
    });

  } catch (error) {
    console.error('Error accepting invite:', error);
    res.status(500).json({ success: false, error: 'Failed to accept invite' });
  }
});

/**
 * DELETE /api/invites/:invite_id
 * Revoke an invite
 */
router.delete('/api/invites/:invite_id', async (req, res) => {
  try {
    const { invite_id } = req.params;

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;

    const invitesCollection = getWorkspaceInvitesCollection();

    // Get invite
    const invite = await invitesCollection.findOne({ invite_id: invite_id });

    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    // Verify user is workspace admin
    const adminsCollection = getWorkspaceAdminsCollection();
    const isAdmin = await adminsCollection.findOne({
      workspace_id: invite.workspace_id,
      user_id: userId,
      role: 'admin',
      deactivated_at: null
    });

    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Only workspace admins can revoke invites' });
    }

    // Revoke invite
    await invitesCollection.updateOne(
      { invite_id: invite_id },
      {
        $set: {
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: userId
        }
      }
    );

    res.json({ success: true });

  } catch (error) {
    console.error('Error revoking invite:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke invite' });
  }
});

/**
 * GET /api/workspace-members
 * List all members of a workspace
 */
router.get('/api/workspace-members', async (req, res) => {
  try {
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ success: false, error: 'workspace_id required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Verify user belongs to this workspace
    if (req.session.user.workspace_id !== workspace_id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Get all workspace members
    const membersCollection = getWorkspaceMembersCollection();
    const members = await membersCollection.find({
      workspace_id: workspace_id,
      removed_at: null
    }).sort({ joined_at: 1 }).toArray();

    res.json({
      success: true,
      members: members
    });

  } catch (error) {
    console.error('Error listing workspace members:', error);
    res.status(500).json({ success: false, error: 'Failed to list workspace members' });
  }
});

/**
 * GET /api/workspace-admins
 * Get workspace admin information
 */
router.get('/api/workspace-admins', async (req, res) => {
  try {
    const { workspace_id } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ success: false, error: 'workspace_id required' });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Verify user belongs to this workspace
    if (req.session.user.workspace_id !== workspace_id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Get workspace admins
    const adminsCollection = getWorkspaceAdminsCollection();
    const admins = await adminsCollection.find({
      workspace_id: workspace_id,
      role: 'admin',
      deactivated_at: null
    }).toArray();

    // Get admin user details from workspace_members
    const membersCollection = getWorkspaceMembersCollection();
    const adminDetails = await Promise.all(
      admins.map(async (admin) => {
        const member = await membersCollection.findOne({
          workspace_id: workspace_id,
          user_id: admin.user_id,
          removed_at: null
        });
        return {
          user_id: admin.user_id,
          user_name: member?.user_name || admin.user_id,
          email: member?.email || null
        };
      })
    );

    res.json({
      success: true,
      admins: adminDetails.filter(a => a !== null)
    });

  } catch (error) {
    console.error('Error listing workspace admins:', error);
    res.status(500).json({ success: false, error: 'Failed to list workspace admins' });
  }
});

module.exports = router;
