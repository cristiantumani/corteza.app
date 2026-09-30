const { getWorkspaceMembersCollection } = require('../../config/database');

/**
 * First-run onboarding (the "How Corteza works" steps on Home).
 * Whether a person has seen it is kept on their membership (`workspace_members.onboarding_seen_at`),
 * so it shows once per person and workspace, on any device.
 */

/**
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<boolean>} true once they finished or skipped it
 */
async function hasSeenOnboarding(workspaceId, userId) {
  const member = await getWorkspaceMembersCollection().findOne(
    { workspace_id: workspaceId, user_id: userId },
    { projection: { onboarding_seen_at: 1 } }
  );
  return !!(member && member.onboarding_seen_at);
}

/**
 * Records that a person finished or skipped the onboarding (the first time only)
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function markOnboardingSeen(workspaceId, userId) {
  await getWorkspaceMembersCollection().updateOne(
    { workspace_id: workspaceId, user_id: userId, onboarding_seen_at: null },
    { $set: { onboarding_seen_at: new Date() } }
  );
}

module.exports = { hasSeenOnboarding, markOnboardingSeen };
