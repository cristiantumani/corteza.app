const crypto = require('crypto');
const { getDatabase } = require('../../config/database');
const { ensureDefaultSpace } = require('../../services/spaces');

/**
 * Workspaces (the `workspaces` collection).
 *
 * A company's Google Workspace domain maps to exactly one Corteza workspace
 * (`google_domain`, unique). People without a Workspace domain (gmail.com and
 * other consumer accounts) get a personal workspace with no domain.
 *
 * Older workspaces (Slack team IDs like "T0…", or "W<NAME>" from magic links)
 * keep their workspace_id; they get a row here the first time it's needed.
 */

function collection() {
  return getDatabase().collection('workspaces');
}

/**
 * @param {string} domain - Google hosted domain (the `hd` claim), e.g. "ninjaexcel.com"
 * @returns {Promise<Object|null>}
 */
async function findByGoogleDomain(domain) {
  if (!domain) return null;
  return collection().findOne({ google_domain: domain.toLowerCase() });
}

async function findById(workspaceId) {
  return collection().findOne({ workspace_id: workspaceId });
}

/**
 * Creates a workspace and its default space.
 * @param {Object} params
 * @param {string} params.name
 * @param {string|null} [params.googleDomain] - unique; a duplicate throws a MongoDB 11000 error
 * @param {Object} params.createdBy - { user_id, user_name }
 * @returns {Promise<Object>} The workspace document
 */
async function createWorkspace({ name, googleDomain = null, createdBy }) {
  const workspace = {
    workspace_id: `ws_${crypto.randomBytes(8).toString('hex')}`,
    name,
    google_domain: googleDomain ? googleDomain.toLowerCase() : null,
    slack_team_id: null,
    created_by: createdBy.user_id,
    created_at: new Date()
  };
  await collection().insertOne(workspace);
  await ensureDefaultSpace(workspace.workspace_id, createdBy.user_id, createdBy.user_name);
  console.log(`🏢 Created workspace ${workspace.workspace_id} (${name})${workspace.google_domain ? ` for ${workspace.google_domain}` : ''}`);
  return workspace;
}

/**
 * Makes sure an existing (legacy) workspace has a row in `workspaces`
 * @returns {Promise<Object>} The workspace document
 */
async function ensureWorkspaceRecord(workspaceId, name) {
  await collection().updateOne(
    { workspace_id: workspaceId },
    {
      $setOnInsert: {
        workspace_id: workspaceId,
        name: name || workspaceId,
        google_domain: null,
        slack_team_id: /^T[A-Z0-9]+$/.test(workspaceId) ? workspaceId : null,
        created_at: new Date()
      }
    },
    { upsert: true }
  );
  return findById(workspaceId);
}

/**
 * Links a Google domain to a workspace so colleagues on that domain join it.
 * Only succeeds if the workspace has no domain yet and no other workspace owns it.
 * @returns {Promise<boolean>} true if the domain was claimed
 */
async function claimGoogleDomain(workspaceId, domain) {
  if (!domain) return false;
  const normalized = domain.toLowerCase();
  if (await findByGoogleDomain(normalized)) return false;

  try {
    const result = await collection().updateOne(
      { workspace_id: workspaceId, google_domain: null },
      { $set: { google_domain: normalized, google_domain_claimed_at: new Date() } }
    );
    if (result.modifiedCount === 1) {
      console.log(`🔗 Workspace ${workspaceId} claimed Google domain ${normalized}`);
      return true;
    }
    return false;
  } catch (error) {
    if (error.code === 11000) return false; // claimed by another workspace at the same moment
    throw error;
  }
}

module.exports = {
  findByGoogleDomain,
  findById,
  createWorkspace,
  ensureWorkspaceRecord,
  claimGoogleDomain
};
