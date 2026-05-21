const express = require('express');
const crypto = require('crypto');
const { getWorkspaceInvitesCollection, getWorkspaceMembersCollection, getWorkspaceAdminsCollection } = require('../config/database');

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
    const { workspace_id, role = 'member', expires_in_days = 30, max_uses = null } = req.body;

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const userName = req.session.user.user_name;
    const workspaceName = req.session.user.workspace_name || workspace_id;

    // Verify user is workspace admin
    const adminsCollection = getWorkspaceAdminsCollection();

    const isAdmin = await adminsCollection.findOne({
      workspace_id: workspace_id,
      user_id: userId,
      role: 'admin',
      deactivated_at: null
    });

    if (!isAdmin) {
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
      status: 'active'
    };

    await invitesCollection.insertOne(invite);

    // Generate invite URL
    const baseUrl = process.env.APP_URL || 'https://app.corteza.app';
    const inviteUrl = `${baseUrl}/invite/${inviteId}`;

    res.json({
      success: true,
      invite_id: inviteId,
      invite_url: inviteUrl,
      expires_at: expiresAt.toISOString()
    });

  } catch (error) {
    console.error('Error creating invite:', error);
    res.status(500).json({ success: false, error: 'Failed to create invite' });
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

    const invitesCollection = getWorkspaceInvitesCollection();

    const invite = await invitesCollection.findOne({ invite_id: invite_id });

    if (!invite) {
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
 * POST /api/invites/:invite_id/accept
 * Accept an invite and join the workspace
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

module.exports = router;
