const { App } = require('@slack/bolt');
const MongoInstallationStore = require('./installationStore');
const config = require('./environment');

/**
 * Get an authenticated Slack client for a specific workspace
 * Used for making Slack API calls (e.g., checking admin status)
 */

let installationStore = null;

/**
 * Initialize the installation store
 * @returns {Promise<MongoInstallationStore>}
 */
async function getInstallationStore() {
  if (!installationStore && config.slack.useOAuth) {
    installationStore = new MongoInstallationStore(config.mongodb.uri);
    await installationStore.connect();
  }
  return installationStore;
}

/**
 * Get Slack Web API client for a workspace
 * @param {string} workspaceId - Slack team/workspace ID
 * @returns {Promise<WebClient|null>} Authenticated Slack Web API client or null if not available
 */
async function getSlackClient(workspaceId) {
  // If using OAuth, fetch installation from store
  if (config.slack.useOAuth) {
    try {
      const store = await getInstallationStore();
      const installation = await store.fetchInstallation({
        teamId: workspaceId,
        isEnterpriseInstall: false
      });

      if (!installation) {
        // Email-authenticated workspace without Slack - return null gracefully
        return null;
      }

      // Return the bot client from the installation
      const { WebClient } = require('@slack/web-api');
      return new WebClient(installation.bot.token);
    } catch (error) {
      // Installation not found or error fetching - return null for email-authenticated workspaces
      console.log(`ℹ️  No Slack installation for workspace ${workspaceId} (likely email-authenticated)`);
      return null;
    }
  }

  // If single-workspace mode, use the global bot token
  if (config.slack.token) {
    const { WebClient } = require('@slack/web-api');
    return new WebClient(config.slack.token);
  }

  // No Slack client available - return null for email-authenticated workspaces
  return null;
}

module.exports = {
  getSlackClient
};
