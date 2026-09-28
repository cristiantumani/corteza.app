const {
  getWorkspaceSpacesCollection,
  getSpaceMembersCollection,
  getDecisionsCollection
} = require('../../config/database');
const { getUserAccessibleSpaces } = require('../../services/permissions');
const { ensurePersonalSpace } = require('../../services/spaces');

/**
 * The spaces a user sees, with decision counts and their role in each.
 *
 * Used by GET /api/spaces and to preload the dashboard (routes/dashboard.js).
 * A fixed number of queries whatever the number of spaces: one aggregate for
 * the counts and one query for the memberships.
 *
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {string} params.userId
 * @param {string} [params.userName]
 * @param {boolean} params.isAdminUser - workspace admins see every shared space (to manage them),
 *   but never a colleague's personal space
 * @returns {Promise<Object[]>} spaces with decision_count, is_creator, user_role, can_modify, can_create
 */
async function listSpacesForUser({ workspaceId, userId, userName, isAdminUser }) {
  // Every member has a personal space (older members get it here the first time)
  await ensurePersonalSpace(workspaceId, userId, userName);

  const spacesCollection = getWorkspaceSpacesCollection();
  let spaces;
  if (isAdminUser) {
    spaces = await spacesCollection.find({
      workspace_id: workspaceId,
      archived: false,
      $or: [{ personal_for: { $exists: false } }, { personal_for: null }, { personal_for: userId }]
    }).toArray();
  } else {
    const accessibleSpaceIds = await getUserAccessibleSpaces(null, workspaceId, userId);
    if (accessibleSpaceIds.length === 0) return [];
    spaces = await spacesCollection.find({ workspace_id: workspaceId, space_id: { $in: accessibleSpaceIds }, archived: false }).toArray();
  }
  // Their personal space first, then the rest in creation order
  spaces.sort((a, b) => (b.personal_for === userId) - (a.personal_for === userId) || String(a.created_at).localeCompare(String(b.created_at)));
  if (spaces.length === 0) return [];

  const spaceIds = spaces.map(space => space.space_id);
  const [counts, memberships] = await Promise.all([
    getDecisionsCollection().aggregate([
      { $match: { workspace_id: workspaceId, space_id: { $in: spaceIds } } },
      { $group: { _id: '$space_id', count: { $sum: 1 } } }
    ]).toArray(),
    getSpaceMembersCollection()
      .find({ workspace_id: workspaceId, user_id: userId, space_id: { $in: spaceIds }, removed_at: null })
      .project({ space_id: 1, role: 1 })
      .toArray()
  ]);
  const countBySpace = new Map(counts.map(entry => [entry._id, entry.count]));
  const roleBySpace = new Map(memberships.map(membership => [membership.space_id, membership.role]));

  return spaces.map(space => {
    const isCreator = space.created_by === userId;
    // Public spaces: everyone in the workspace is a member. Private/shared: explicit membership only
    const userRole = space.visibility === 'public' ? 'member' : (roleBySpace.get(space.space_id) || null);
    return {
      ...space,
      is_personal: space.personal_for === userId,
      decision_count: countBySpace.get(space.space_id) || 0,
      is_creator: isCreator, // who created it (may not be a member)
      user_role: userRole, // actual role in the space (null if not a member)
      can_modify: isAdminUser || isCreator || userRole === 'admin', // admins, creator and space admins can manage
      can_create: ['owner', 'admin', 'member'].includes(userRole) // same rule as canCreateInSpace()
    };
  });
}

module.exports = { listSpacesForUser };
