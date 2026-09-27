const crypto = require('crypto');
const {
  getWorkspaceInvitesCollection,
  getWorkspaceMembersCollection,
  getSpaceMembersCollection
} = require('../../config/database');
const { addMember } = require('../users/user-service');

/**
 * Workspace invites: validation and joining.
 * Used by Google sign-in (/auth/google?invite=…) and POST /api/invites/:id/accept.
 */

/**
 * Loads an invite and checks it can still be used
 * @param {string} inviteId
 * @param {string} [email] - if the invite is addressed to an email, it must match
 * @returns {Promise<{ invite: Object|null, error: string|null }>}
 */
async function getUsableInvite(inviteId, email) {
  if (!inviteId || typeof inviteId !== 'string') return { invite: null, error: 'Invite not found' };

  const invite = await getWorkspaceInvitesCollection().findOne({ invite_id: inviteId });
  if (!invite) return { invite: null, error: 'Invite not found' };
  if (new Date(invite.expires_at) < new Date()) return { invite: null, error: 'Invite has expired' };
  if (invite.max_uses && invite.uses_count >= invite.max_uses) return { invite: null, error: 'Invite has reached maximum uses' };
  if (invite.status !== 'active') return { invite: null, error: 'Invite is no longer valid' };
  if (invite.email && email && invite.email.trim().toLowerCase() !== email.toLowerCase()) {
    return { invite: null, error: `This invite was sent to ${invite.email}. Sign in with that Google account.` };
  }
  return { invite, error: null };
}

/**
 * Joins a user to the invite's workspace (and space, if the invite has one).
 * If the user is already a member, returns the existing membership.
 * @param {Object} invite - a usable invite (see getUsableInvite)
 * @param {Object} user - { user_id, name, email }
 * @returns {Promise<{ membership: Object, alreadyMember: boolean }>}
 */
async function acceptInvite(invite, user) {
  const existing = await getWorkspaceMembersCollection().findOne({
    workspace_id: invite.workspace_id,
    $or: [{ user_id: user.user_id }, { email: user.email }],
    removed_at: null
  });
  if (existing) return { membership: existing, alreadyMember: true };

  const membership = await addMember({
    workspace: { workspace_id: invite.workspace_id, name: invite.workspace_name },
    user,
    role: invite.role === 'admin' ? 'admin' : 'member',
    joinedVia: 'invite',
    extra: { invited_by: invite.invited_by, invited_by_name: invite.invited_by_name }
  });

  if (invite.space_id) {
    await getSpaceMembersCollection().insertOne({
      membership_id: `smem_${crypto.randomBytes(12).toString('hex')}`,
      workspace_id: invite.workspace_id,
      space_id: invite.space_id,
      user_id: user.user_id,
      user_name: user.name,
      role: invite.space_role || 'member',
      added_by: invite.invited_by,
      added_by_name: invite.invited_by_name,
      added_at: new Date().toISOString(),
      removed_at: null
    });
  }

  await getWorkspaceInvitesCollection().updateOne(
    { invite_id: invite.invite_id },
    { $inc: { uses_count: 1 }, $set: { last_used_at: new Date().toISOString() } }
  );

  return { membership, alreadyMember: false };
}

module.exports = {
  getUsableInvite,
  acceptInvite
};
