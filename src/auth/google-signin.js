const workspaces = require('../core/workspaces/workspace-service');
const users = require('../core/users/user-service');
const invites = require('../core/invites/invite-service');
const { isAdmin } = require('../services/permissions');
const beta = require('../core/beta/beta-access');
const { ensurePersonalSpace } = require('../services/spaces');

/**
 * Decides which workspace a verified Google user signs in to.
 *
 * Order:
 *   1. Invite link (/invite/:id → Google): join the invite's workspace.
 *   2. Existing memberships (matched by email): use the last workspace they used,
 *      else the one owning their Google domain, else the newest. An admin of a
 *      workspace with no domain claims their domain for it, so colleagues auto-join.
 *   3. Google Workspace account (`hd` claim) whose domain has a workspace: join as member.
 *   4. Google Workspace account with a new domain: create the workspace, become admin.
 *   5. Consumer account (gmail.com etc., no `hd`): create a personal workspace.
 *
 * Private beta (BETA_REQUIRED=true): 4 and 5 only happen for approved people
 * (core/beta/beta-access.js). Anyone else gets `notInBeta` and nothing is saved.
 *
 * Only Google's `hd` claim is trusted as the domain, never the email's domain,
 * so a consumer account like someone@ninjaexcel.com (not a Workspace account)
 * can't join the ninjaexcel.com workspace.
 *
 * @param {Object} identity - verified ID token claims: { sub, email, email_verified, name, picture, hd }
 * @param {Object} [options]
 * @param {string} [options.inviteId]
 * @returns {Promise<{ sessionUser?: Object, needsOnboarding?: boolean, notInBeta?: boolean, error?: string }>}
 */
async function signInWithGoogle(identity, { inviteId } = {}) {
  if (!identity?.email || identity.email_verified !== true) {
    return { error: 'Your Google account email is not verified.' };
  }

  const email = identity.email.toLowerCase();
  const domain = identity.hd ? identity.hd.toLowerCase() : null;
  const memberships = await users.findMembershipsByEmail(email);
  const domainWorkspace = !inviteId && memberships.length === 0 && domain ? await workspaces.findByGoogleDomain(domain) : null;

  // Private beta: only approved people get a new workspace (checked before anything is saved)
  if (!inviteId && memberships.length === 0 && !domainWorkspace && !(await beta.isApproved(email, domain))) {
    return { notInBeta: true, email };
  }

  const user = await users.upsertGoogleUser(
    { sub: identity.sub, email, name: identity.name || email.split('@')[0], picture: identity.picture },
    memberships[0]?.user_id
  );

  // 1. Invite
  if (inviteId) {
    const { invite, error } = await invites.getUsableInvite(inviteId, email);
    if (error) return { error };
    const inviteUser = membershipUser(memberships.find(m => m.workspace_id === invite.workspace_id), user);
    const { membership } = await invites.acceptInvite(invite, inviteUser);
    return finish(user, membership);
  }

  // 2. Existing memberships
  if (memberships.length > 0) {
    let membership = memberships.find(m => m.workspace_id === user.last_workspace_id);
    if (!membership && domain) {
      const domainWorkspace = await workspaces.findByGoogleDomain(domain);
      membership = domainWorkspace && memberships.find(m => m.workspace_id === domainWorkspace.workspace_id);
    }
    membership = membership || memberships[0];

    // workspace_admins is the source of truth (older onboarding could overwrite membership.role)
    if (domain && await isAdmin(null, membership.workspace_id, membership.user_id)) {
      await workspaces.ensureWorkspaceRecord(membership.workspace_id, membership.workspace_name);
      await workspaces.claimGoogleDomain(membership.workspace_id, domain);
    }
    return finish(user, membership);
  }

  // 3. Known domain: join as member
  if (domain) {
    if (domainWorkspace) {
      const membership = await users.addMember({ workspace: domainWorkspace, user, role: 'member', joinedVia: 'google_domain' });
      return finish(user, membership);
    }

    // 4. New domain: create the workspace
    try {
      const workspace = await workspaces.createWorkspace({
        name: domain,
        googleDomain: domain,
        createdBy: { user_id: user.user_id, user_name: user.name }
      });
      const membership = await users.addMember({ workspace, user, role: 'admin', joinedVia: 'google' });
      return finish(user, membership);
    } catch (error) {
      if (error.code !== 11000) throw error;
      // A colleague created the domain's workspace at the same moment: join it
      const workspace = await workspaces.findByGoogleDomain(domain);
      const membership = await users.addMember({ workspace, user, role: 'member', joinedVia: 'google_domain' });
      return finish(user, membership);
    }
  }

  // 5. Personal workspace
  const workspace = await workspaces.createWorkspace({
    name: `${user.name}'s workspace`,
    createdBy: { user_id: user.user_id, user_name: user.name }
  });
  const membership = await users.addMember({ workspace, user, role: 'admin', joinedVia: 'google' });
  return finish(user, membership);
}

/** The identity to use inside a workspace: an existing membership's user_id wins */
function membershipUser(membership, user) {
  return { user_id: membership?.user_id || user.user_id, name: user.name, email: user.email };
}

async function finish(user, membership) {
  await users.setLastWorkspace(user.user_id, membership.workspace_id);
  await ensurePersonalSpace(membership.workspace_id, membership.user_id, membership.user_name || user.name);
  return {
    sessionUser: {
      user_id: membership.user_id,
      user_name: membership.user_name || user.name,
      workspace_id: membership.workspace_id,
      workspace_name: membership.workspace_name,
      email: user.email,
      picture: user.picture || null,
      auth_provider: 'google',
      authenticated_at: new Date().toISOString()
    },
    needsOnboarding: membership.onboarding_completed === false
  };
}

module.exports = { signInWithGoogle };
