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
 * @returns {Promise<WebClient>} Authenticated Slack Web API client
 * @throws {Error} if installation not found or OAuth not configured
 */
async function getSlackClient(workspaceId) {
  // If using OAuth, fetch installation from store
  if (config.slack.useOAuth) {
    const store = await getInstallationStore();
    const installation = await store.fetchInstallation({
      teamId: workspaceId,
      isEnterpriseInstall: false
    });

    if (!installation) {
      throw new Error(`No installation found for workspace ${workspaceId}`);
    }

    // Return the bot client from the installation
    const { WebClient } = require('@slack/web-api');
    return new WebClient(installation.bot.token);
  }

  // If single-workspace mode, use the global bot token
  if (config.slack.token) {
    const { WebClient } = require('@slack/web-api');
    return new WebClient(config.slack.token);
  }

  throw new Error('No Slack client available. OAuth not configured and no bot token provided.');
}

module.exports = {
  getSlackClient
};
