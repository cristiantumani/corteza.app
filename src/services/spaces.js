const crypto = require('crypto');
const { getWorkspaceSpacesCollection, getSpaceMembersCollection } = require('../config/database');

/**
 * Space helpers shared by routes, Slack handlers and scripts.
 *
 * Personal spaces: every member has one private space of their own
 * (`personal_for: <user_id>`, created on first sign-in). Everything they capture
 * (Google Meet, imports, Log manually) goes there unless they pick another space,
 * so colleagues in the same workspace don't see each other's meetings.
 * A partial unique index (config/database.js) guarantees one per member.
 *
 * Default space: "General", public, only for captures with no Corteza user behind them
 * (Slack, API keys). Created lazily when one of those needs it.
 * A partial unique index guarantees one default per workspace.
 */

const DEFAULT_SPACE_NAME = 'General';
const PERSONAL_SPACE_NAME = 'My space';

function newSpaceId() {
  return `sp_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Returns a member's personal space, creating it (and their owner membership) if needed
 * @param {string} workspaceId
 * @param {string} userId - the membership's user_id
 * @param {string} [userName]
 * @returns {Promise<Object>} The personal space document
 */
async function ensurePersonalSpace(workspaceId, userId, userName = null) {
  const spacesCollection = getWorkspaceSpacesCollection();
  const existing = await spacesCollection.findOne({ workspace_id: workspaceId, personal_for: userId });
  if (existing && !existing.archived) return existing;

  const now = new Date().toISOString();
  if (existing) {
    await spacesCollection.updateOne({ _id: existing._id }, { $set: { archived: false, archived_at: null, updated_at: now } });
  } else {
    try {
      await spacesCollection.updateOne(
        { workspace_id: workspaceId, personal_for: userId },
        {
          $setOnInsert: {
            space_id: newSpaceId(),
            workspace_id: workspaceId,
            personal_for: userId,
            name: PERSONAL_SPACE_NAME,
            description: 'Outcomes from your meetings. Only you can see them.',
            visibility: 'private',
            created_by: userId,
            created_by_name: userName || 'Unknown',
            created_at: now,
            updated_at: now,
            is_default: false,
            archived: false,
            archived_at: null,
            settings: { color: '#3953bd', icon: '👤' }
          }
        },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error; // created at the same moment by another request
    }
  }

  const space = await spacesCollection.findOne({ workspace_id: workspaceId, personal_for: userId });
  // The owner is an explicit member, so every private-space permission check works unchanged
  await getSpaceMembersCollection().updateOne(
    { workspace_id: workspaceId, space_id: space.space_id, user_id: userId },
    {
      $set: { role: 'owner', removed_at: null },
      $setOnInsert: {
        membership_id: `mem_${crypto.randomBytes(12).toString('hex')}`,
        user_name: userName || 'Unknown',
        added_by: userId,
        added_by_name: userName || 'Unknown',
        added_at: now
      }
    },
    { upsert: true }
  );
  if (space.created_at === now) console.log(`👤 Created personal space ${space.space_id} for ${userId} in ${workspaceId}`);
  return space;
}

/**
 * Returns the workspace's default space, creating it if it doesn't exist yet
 * @param {string} workspaceId
 * @param {string} [createdBy='system'] - user_id recorded as creator when the space is created
 * @param {string} [createdByName='System']
 * @returns {Promise<Object>} The default space document
 */
async function ensureDefaultSpace(workspaceId, createdBy = 'system', createdByName = 'System') {
  const spacesCollection = getWorkspaceSpacesCollection();

  const existing = await spacesCollection.findOne({ workspace_id: workspaceId, is_default: true, archived: false });
  if (existing) return existing;

  const now = new Date().toISOString();
  try {
    await spacesCollection.updateOne(
      { workspace_id: workspaceId, is_default: true },
      {
        $setOnInsert: {
          space_id: newSpaceId(),
          workspace_id: workspaceId,
          name: DEFAULT_SPACE_NAME,
          description: 'Default space for all team decisions',
          visibility: 'public',
          created_by: createdBy,
          created_by_name: createdByName,
          created_at: now,
          updated_at: now,
          is_default: true,
          archived: false,
          archived_at: null,
          settings: { color: '#667eea', icon: '🏠' }
        }
      },
      { upsert: true }
    );
  } catch (error) {
    // Another request created it at the same moment (unique index) — fall through and read it
    if (error.code !== 11000) throw error;
  }

  // An archived default space is un-archived rather than duplicated
  const space = await spacesCollection.findOne({ workspace_id: workspaceId, is_default: true });
  if (space.archived) {
    await spacesCollection.updateOne(
      { _id: space._id },
      { $set: { archived: false, archived_at: null, updated_at: now } }
    );
    space.archived = false;
  } else if (space.created_at === now) {
    console.log(`🏠 Created default space ${space.space_id} for workspace ${workspaceId}`);
  }
  return space;
}

module.exports = {
  ensurePersonalSpace,
  ensureDefaultSpace,
  DEFAULT_SPACE_NAME,
  PERSONAL_SPACE_NAME
};
