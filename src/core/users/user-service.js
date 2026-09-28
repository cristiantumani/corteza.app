const crypto = require('crypto');
const { getDatabase, getWorkspaceMembersCollection, getWorkspaceAdminsCollection } = require('../../config/database');

/**
 * Users (the `users` collection) and their workspace memberships
 * (`workspace_members`, `workspace_admins`).
 *
 * A user is a Google account (`google_sub`, `email`). Memberships keep their own
 * `user_id`, because older memberships (Slack, magic link) used other ID formats
 * and decisions reference them. The session always uses the membership's user_id.
 */

function collection() {
  return getDatabase().collection('users');
}

/**
 * Finds or creates the user for a verified Google identity.
 * Matches by Google `sub` first, then by email (links accounts created before Google sign-in).
 * @param {Object} identity - { sub, email, name, picture }
 * @param {string} [preferredUserId] - reuse this user_id when creating (e.g. an existing membership's)
 * @returns {Promise<Object>} The user document
 */
async function upsertGoogleUser({ sub, email, name, picture }, preferredUserId) {
  const users = collection();
  const now = new Date();
  const normalizedEmail = email.toLowerCase();

  const existing = await users.findOne({ $or: [{ google_sub: sub }, { email: normalizedEmail }] });
  if (existing) {
    await users.updateOne(
      { _id: existing._id },
      { $set: { google_sub: sub, email: normalizedEmail, name, picture: picture || null, last_login_at: now } }
    );
    return { ...existing, google_sub: sub, email: normalizedEmail, name, picture: picture || null, last_login_at: now };
  }

  const user = {
    user_id: preferredUserId || `usr_${crypto.randomBytes(8).toString('hex')}`,
    google_sub: sub,
    email: normalizedEmail,
    name,
    picture: picture || null,
    last_workspace_id: null,
    created_at: now,
    last_login_at: now
  };
  await users.insertOne(user);
  return user;
}

async function setLastWorkspace(userId, workspaceId) {
  await collection().updateOne({ user_id: userId }, { $set: { last_workspace_id: workspaceId } });
}

/**
 * Active memberships for an email address, newest first
 */
async function findMembershipsByEmail(email) {
  return getWorkspaceMembersCollection()
    .find({ email: email.toLowerCase(), removed_at: null })
    .sort({ joined_at: -1 })
    .toArray();
}

/**
 * Adds a user to a workspace
 * @param {Object} params
 * @param {Object} params.workspace - { workspace_id, name }
 * @param {Object} params.user - { user_id, name, email }
 * @param {'admin'|'member'} params.role
 * @param {string} params.joinedVia - 'google' | 'google_domain' | 'invite'
 * @param {Object} [params.extra] - extra fields (e.g. invited_by)
 * @returns {Promise<Object>} The membership document
 */
async function addMember({ workspace, user, role, joinedVia, extra = {} }) {
  const now = new Date().toISOString();
  const membership = {
    membership_id: `mem_${crypto.randomBytes(12).toString('hex')}`,
    workspace_id: workspace.workspace_id,
    workspace_name: workspace.name,
    user_id: user.user_id,
    user_name: user.name,
    email: user.email,
    role,
    joined_via: joinedVia,
    joined_at: now,
    removed_at: null,
    ...extra
  };
  await getWorkspaceMembersCollection().insertOne(membership);

  if (role === 'admin') {
    await getWorkspaceAdminsCollection().insertOne({
      workspace_id: workspace.workspace_id,
      user_id: user.user_id,
      user_name: user.name,
      email: user.email,
      role: 'admin',
      created_at: now,
      deactivated_at: null
    });
  }

  console.log(`👤 ${user.email} joined ${workspace.workspace_id} as ${role} (${joinedVia})`);
  return membership;
}

module.exports = {
  upsertGoogleUser,
  setLastWorkspace,
  findMembershipsByEmail,
  addMember
};
