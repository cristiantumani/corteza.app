const { MongoClient } = require('mongodb');

/**
 * MongoDB-based installation store for Slack OAuth tokens
 * Stores bot tokens, user tokens, and installation data per workspace
 */
class MongoInstallationStore {
  constructor(mongoUri) {
    this.mongoUri = mongoUri;
    this.client = null;
    this.db = null;
    this.collection = null;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    if (!this.client) {
      this.client = new MongoClient(this.mongoUri);
      await this.client.connect();
      this.db = this.client.db('decision-logger');
      this.collection = this.db.collection('slack_installations');

      // Create index on team_id for fast lookups
      await this.collection.createIndex({ 'team.id': 1 }, { unique: true });

      console.log('✅ Installation store connected to MongoDB');
    }
  }

  /**
   * Store installation data (called after successful OAuth)
   * @param {Object} installation - Installation object from Slack
   */
  async storeInstallation(installation) {
    await this.connect();

    const installationData = {
      team_id: installation.team.id,
      team_name: installation.team.name,
      enterprise_id: installation.enterprise?.id || null,
      bot_token: installation.bot.token,
      bot_id: installation.bot.id,
      bot_user_id: installation.bot.userId,
      user_token: installation.user?.token || null,
      user_id: installation.user?.id || null,
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      raw_installation: installation // Store full installation for reference
    };

    await this.collection.updateOne(
      { team_id: installation.team.id },
      { $set: installationData },
      { upsert: true }
    );

    console.log(`✅ Stored installation for workspace: ${installation.team.name} (${installation.team.id})`);
    return;
  }

  /**
   * Fetch installation data for a workspace
   * @param {Object} query - Query object with teamId, enterpriseId, etc.
   */
  async fetchInstallation(query) {
    await this.connect();

    const teamId = query.teamId;
    const enterpriseId = query.enterpriseId;

    // Build MongoDB query
    const dbQuery = { team_id: teamId };
    if (enterpriseId) {
      dbQuery.enterprise_id = enterpriseId;
    }

    const result = await this.collection.findOne(dbQuery);

    if (!result) {
      throw new Error(`No installation found for team ${teamId}`);
    }

    // Return in the format Slack Bolt expects
    return result.raw_installation;
  }

  /**
   * Delete installation (when app is uninstalled)
   * @param {Object} query - Query object with teamId, enterpriseId, etc.
   */
  async deleteInstallation(query) {
    await this.connect();

    const teamId = query.teamId;
    const enterpriseId = query.enterpriseId;

    const dbQuery = { team_id: teamId };
    if (enterpriseId) {
      dbQuery.enterprise_id = enterpriseId;
    }

    await this.collection.deleteOne(dbQuery);
    console.log(`🗑️  Deleted installation for team ${teamId}`);
    return;
  }
}

module.exports = MongoInstallationStore;
