const crypto = require('crypto');
const { getWorkspaceSpacesCollection } = require('../config/database');

/**
 * Space helpers shared by routes, Slack handlers and scripts.
 *
 * Every workspace has exactly one default space ("General", public). Decisions
 * that arrive without an explicit space (Slack, API, AI extraction) go there,
 * so they always show up in the dashboard, which filters by space.
 * A partial unique index (config/database.js) guarantees one default per workspace.
 */

const DEFAULT_SPACE_NAME = 'General';

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
          space_id: `sp_${crypto.randomBytes(12).toString('hex')}`,
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
  ensureDefaultSpace,
  DEFAULT_SPACE_NAME
};
