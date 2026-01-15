const { getDatabase } = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');

/**
 * Service for managing workspace-specific settings
 * Handles Jira configuration with encrypted API tokens
 */

/**
 * Get workspace settings collection
 * @returns {Collection} MongoDB collection
 */
function getWorkspaceSettingsCollection() {
  const db = getDatabase();
  return db.collection('workspace_settings');
}

/**
 * Get settings for a specific workspace
 * @param {string} workspaceId - Slack workspace/team ID
 * @returns {Promise<Object|null>} Workspace settings or null if not found
 */
async function getWorkspaceSettings(workspaceId) {
  try {
    const collection = getWorkspaceSettingsCollection();
    return await collection.findOne({ workspace_id: workspaceId });
  } catch (error) {
    console.error(`❌ Error fetching workspace settings for ${workspaceId}:`, error.message);
    return null;
  }
}

/**
 * Update Jira configuration for a workspace
 * @param {string} workspaceId - Slack workspace/team ID
 * @param {Object} jiraConfig - Jira configuration
 * @param {string} jiraConfig.url - Jira instance URL
 * @param {string} jiraConfig.email - Jira user email
 * @param {string} jiraConfig.apiToken - Jira API token (will be encrypted)
 * @param {string} userId - Slack user ID who configured
 * @param {string} userName - Slack user name who configured
 * @returns {Promise<Object>} Update result
 */
async function updateJiraSettings(workspaceId, jiraConfig, userId, userName) {
  try {
    const collection = getWorkspaceSettingsCollection();

    // Encrypt the API token
    const encryptedToken = encrypt(jiraConfig.apiToken);

    const update = {
      workspace_id: workspaceId,
      jira: {
        enabled: true,
        url: jiraConfig.url,
        email: jiraConfig.email,
        api_token_encrypted: encryptedToken,
        last_tested_at: new Date().toISOString(),
        last_test_success: true,
        last_test_error: null
      },
      configured_by: userId,
      configured_by_name: userName,
      updated_at: new Date().toISOString()
    };

    const result = await collection.updateOne(
      { workspace_id: workspaceId },
      {
        $set: update,
        $setOnInsert: { created_at: new Date().toISOString() }
      },
      { upsert: true }
    );

    console.log(`✅ Jira settings updated for workspace ${workspaceId}`);
    return result;
  } catch (error) {
    console.error(`❌ Error updating Jira settings for ${workspaceId}:`, error.message);
    throw error;
  }
}

/**
 * Disable Jira integration for a workspace
 * @param {string} workspaceId - Slack workspace/team ID
 * @returns {Promise<Object>} Update result
 */
async function disableJira(workspaceId) {
  try {
    const collection = getWorkspaceSettingsCollection();

    const result = await collection.updateOne(
      { workspace_id: workspaceId },
      {
        $set: {
          'jira.enabled': false,
          updated_at: new Date().toISOString()
        }
      }
    );

    console.log(`✅ Jira disabled for workspace ${workspaceId}`);
    return result;
  } catch (error) {
    console.error(`❌ Error disabling Jira for ${workspaceId}:`, error.message);
    throw error;
  }
}

/**
 * Get decrypted Jira credentials for a workspace
 * @param {string} workspaceId - Slack workspace/team ID
 * @returns {Promise<Object|null>} Decrypted Jira credentials or null
 */
async function getDecryptedJiraCredentials(workspaceId) {
  try {
    const settings = await getWorkspaceSettings(workspaceId);

    if (!settings || !settings.jira || !settings.jira.enabled) {
      return null;
    }

    // Decrypt the API token
    const apiToken = decrypt(settings.jira.api_token_encrypted);

    return {
      url: settings.jira.url,
      email: settings.jira.email,
      apiToken: apiToken,
      isConfigured: true
    };
  } catch (error) {
    console.error(`❌ Error decrypting Jira credentials for ${workspaceId}:`, error.message);
    // Return null on decryption failure (credentials may be corrupted)
    return null;
  }
}

/**
 * Mark test failure for Jira configuration
 * @param {string} workspaceId - Slack workspace/team ID
 * @param {string} errorMessage - Error message from test
 * @returns {Promise<Object>} Update result
 */
async function markJiraTestFailure(workspaceId, errorMessage) {
  try {
    const collection = getWorkspaceSettingsCollection();

    const result = await collection.updateOne(
      { workspace_id: workspaceId },
      {
        $set: {
          'jira.last_tested_at': new Date().toISOString(),
          'jira.last_test_success': false,
          'jira.last_test_error': errorMessage,
          updated_at: new Date().toISOString()
        }
      }
    );

    return result;
  } catch (error) {
    console.error(`❌ Error marking test failure for ${workspaceId}:`, error.message);
    throw error;
  }
}

module.exports = {
  getWorkspaceSettings,
  updateJiraSettings,
  disableJira,
  getDecryptedJiraCredentials,
  markJiraTestFailure
};
