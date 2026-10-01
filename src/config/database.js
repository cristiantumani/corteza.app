const { MongoClient } = require('mongodb');
const config = require('./environment');

let mongoClient = null;
let db = null;
let decisionsCollection = null;
let aiSuggestionsCollection = null;
let meetingTranscriptsCollection = null;
let aiFeedbackCollection = null;
let workspaceSettingsCollection = null;
let workspaceAdminsCollection = null;
let extensionInstallsCollection = null;
let workspaceSpacesCollection = null;
let spaceMembersCollection = null;
let workspaceInvitesCollection = null;
let workspaceMembersCollection = null;

/**
 * Connects to MongoDB and sets up indexes
 */
async function connectToMongoDB() {
  try {
    // Log outbound IP for debugging MongoDB allowlist issues (skipped in tests)
    if (process.env.NODE_ENV !== 'test') try {
      const https = require('https');
      https.get('https://api.ipify.org?format=json', (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => {
          const ip = JSON.parse(data).ip;
          console.log('🌐 Railway outbound IP:', ip);
          console.log('💡 Verify this IP is in MongoDB Atlas Network Access allowlist');
        });
      }).on('error', (err) => {
        console.log('⚠️  Could not detect outbound IP:', err.message);
      });
    } catch (ipError) {
      console.log('⚠️  IP detection skipped');
    }

    const client = new MongoClient(config.mongodb.uri);
    await client.connect();
    mongoClient = client;
    console.log('✅ Connected to MongoDB!');

    db = client.db(config.mongodb.dbName);
    decisionsCollection = db.collection('decisions');
    aiSuggestionsCollection = db.collection('ai_suggestions');
    meetingTranscriptsCollection = db.collection('meeting_transcripts');
    aiFeedbackCollection = db.collection('ai_feedback');
    workspaceSettingsCollection = db.collection('workspace_settings');
    workspaceAdminsCollection = db.collection('workspace_admins');
    extensionInstallsCollection = db.collection('extension_installs');
    workspaceSpacesCollection = db.collection('workspace_spaces');
    spaceMembersCollection = db.collection('space_members');
    workspaceInvitesCollection = db.collection('workspace_invites');
    workspaceMembersCollection = db.collection('workspace_members');

    // Create indexes for decisions collection
    await decisionsCollection.createIndex({ text: 'text', tags: 'text' });
    await decisionsCollection.createIndex({ timestamp: -1 });

    // Create indexes for AI suggestions collection
    await aiSuggestionsCollection.createIndex({ suggestion_id: 1 }, { unique: true });
    await aiSuggestionsCollection.createIndex({ meeting_transcript_id: 1 });
    await aiSuggestionsCollection.createIndex({ status: 1 });
    await aiSuggestionsCollection.createIndex({ created_at: -1 });
    await aiSuggestionsCollection.createIndex({ user_id: 1 });

    // Create indexes for meeting transcripts collection
    await meetingTranscriptsCollection.createIndex({ transcript_id: 1 }, { unique: true });
    await meetingTranscriptsCollection.createIndex({ uploaded_at: -1 });
    await meetingTranscriptsCollection.createIndex({ uploaded_by: 1 });

    // Create indexes for AI feedback collection
    await aiFeedbackCollection.createIndex({ feedback_id: 1 }, { unique: true });
    await aiFeedbackCollection.createIndex({ suggestion_id: 1 });
    await aiFeedbackCollection.createIndex({ action: 1 });
    await aiFeedbackCollection.createIndex({ created_at: -1 });

    // Workspace-scoped indexes for multi-tenancy
    await decisionsCollection.createIndex({ workspace_id: 1, id: 1 }, { unique: true });
    await decisionsCollection.createIndex({ workspace_id: 1, timestamp: -1 });
    await decisionsCollection.createIndex({ workspace_id: 1, type: 1 });
    await decisionsCollection.createIndex({ workspace_id: 1, epic_key: 1 });

    await aiSuggestionsCollection.createIndex({ workspace_id: 1, suggestion_id: 1 }, { unique: true });
    await aiSuggestionsCollection.createIndex({ workspace_id: 1, status: 1 });

    await meetingTranscriptsCollection.createIndex({ workspace_id: 1, transcript_id: 1 }, { unique: true });
    await meetingTranscriptsCollection.createIndex({ workspace_id: 1, uploaded_at: -1 });

    await aiFeedbackCollection.createIndex({ workspace_id: 1, feedback_id: 1 }, { unique: true });

    // Create indexes for workspace settings collection
    await workspaceSettingsCollection.createIndex({ workspace_id: 1 }, { unique: true });
    await workspaceSettingsCollection.createIndex({ 'jira.enabled': 1 });

    // Create indexes for workspace admins collection (role-based permissions)
    await workspaceAdminsCollection.createIndex({ workspace_id: 1, user_id: 1 }, { unique: true });
    await workspaceAdminsCollection.createIndex({ workspace_id: 1, role: 1 });
    await workspaceAdminsCollection.createIndex({ workspace_id: 1, deactivated_at: 1 });

    // Create indexes for extension installs collection
    await extensionInstallsCollection.createIndex({ install_id: 1 }, { unique: true });
    await extensionInstallsCollection.createIndex({ status: 1, email: 1, installed_at: -1 });
    await extensionInstallsCollection.createIndex({ reminder_sent_at: 1 });

    // Create indexes for workspace spaces collection (Spaces feature)
    await workspaceSpacesCollection.createIndex({ workspace_id: 1, space_id: 1 }, { unique: true });
    await workspaceSpacesCollection.createIndex({ workspace_id: 1, archived: 1, name: 1 });
    await workspaceSpacesCollection.createIndex({ workspace_id: 1, is_default: 1 });
    await workspaceSpacesCollection.createIndex({ workspace_id: 1, visibility: 1 });

    // Create indexes for space members collection (Spaces feature)
    await spaceMembersCollection.createIndex(
      { space_id: 1, user_id: 1, removed_at: 1 },
      {
        unique: true,
        partialFilterExpression: { removed_at: null }
      }
    );
    await spaceMembersCollection.createIndex({ workspace_id: 1, user_id: 1, removed_at: 1 });
    await spaceMembersCollection.createIndex({ space_id: 1, role: 1, removed_at: 1 });
    await spaceMembersCollection.createIndex({ workspace_id: 1, space_id: 1 });

    // Space-related indexes for decisions collection
    await decisionsCollection.createIndex({ workspace_id: 1, space_id: 1, timestamp: -1 });
    await decisionsCollection.createIndex({ workspace_id: 1, space_id: 1, type: 1 });
    await decisionsCollection.createIndex({ workspace_id: 1, space_id: 1, id: 1 });
    await decisionsCollection.createIndex({ space_id: 1, timestamp: -1 });

    // Create indexes for workspace invites collection
    await workspaceInvitesCollection.createIndex({ invite_id: 1 }, { unique: true });
    await workspaceInvitesCollection.createIndex({ workspace_id: 1, status: 1 });
    await workspaceInvitesCollection.createIndex({ workspace_id: 1, created_at: -1 });
    await workspaceInvitesCollection.createIndex({ expires_at: 1 });

    // Create indexes for workspace members collection
    await workspaceMembersCollection.createIndex(
      { workspace_id: 1, user_id: 1, removed_at: 1 },
      {
        unique: true,
        partialFilterExpression: { removed_at: null }
      }
    );
    await workspaceMembersCollection.createIndex({ workspace_id: 1, removed_at: 1 });
    await workspaceMembersCollection.createIndex({ user_id: 1, removed_at: 1 });
    await workspaceMembersCollection.createIndex({ invited_by: 1 });

    // Weekly digest: one run per workspace per week (claimed with a unique insert)
    // One personal space per member (services/spaces.js ensurePersonalSpace)
    await workspaceSpacesCollection.createIndex(
      { workspace_id: 1, personal_for: 1 },
      { name: 'one_personal_space_per_member', unique: true, partialFilterExpression: { personal_for: { $type: 'string' } } }
    );

    await db.collection('digest_runs').createIndex({ workspace_id: 1, week_start: 1 }, { unique: true });
    // Daily digest: one check per person per day (jobs/daily-digest.js); the latest check starts the next window
    await db.collection('daily_digests').createIndex({ workspace_id: 1, user_id: 1, day: 1 }, { unique: true });
    // AI usage per workspace, person and day (core/usage/ai-usage.js)
    await db.collection('ai_usage').createIndex({ workspace_id: 1, day: 1, user_id: 1 }, { unique: true });
    await db.collection('daily_digests').createIndex({ workspace_id: 1, user_id: 1, checked_at: -1 });

    // One default space per workspace (services/spaces.js). Kept separate so existing
    // duplicate defaults (if any) log a warning instead of blocking startup.
    try {
      await workspaceSpacesCollection.createIndex(
        { workspace_id: 1 },
        { name: 'one_default_space_per_workspace', unique: true, partialFilterExpression: { is_default: true } }
      );
    } catch (indexError) {
      console.warn('⚠️  Could not create unique default-space index (duplicate defaults?):', indexError.message);
    }

    // Workspaces and users (core/workspaces, core/users). One workspace per Google domain.
    await db.collection('workspaces').createIndex({ workspace_id: 1 }, { unique: true });
    await db.collection('workspaces').createIndex(
      { google_domain: 1 },
      { unique: true, partialFilterExpression: { google_domain: { $type: 'string' } } }
    );
    await db.collection('users').createIndex({ user_id: 1 }, { unique: true });
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex(
      { google_sub: 1 },
      { unique: true, partialFilterExpression: { google_sub: { $type: 'string' } } }
    );
    await workspaceMembersCollection.createIndex({ email: 1, removed_at: 1 });

    // Google Meet capture (integrations/google/connections, ingestion/pipeline)
    await db.collection('google_connections').createIndex({ workspace_id: 1, user_id: 1 }, { unique: true });
    await db.collection('google_connections').createIndex({ status: 1 });
    // One ingestion per person per meeting (colleagues in the same meeting each capture it).
    // The older per-workspace unique index would block the second person, so it's dropped.
    await db.collection('ingestions').dropIndex('workspace_id_1_source_1_external_id_1').catch(() => {});
    await db.collection('ingestions').createIndex({ workspace_id: 1, user_id: 1, source: 1, external_id: 1 }, { unique: true });
    await db.collection('ingestions').createIndex({ workspace_id: 1, source: 1, updated_at: -1 });
    await db.collection('meet_imports').createIndex({ import_id: 1 }, { unique: true });
    await db.collection('meet_imports').createIndex({ status: 1, lease_until: 1 });
    await db.collection('meet_imports').createIndex({ workspace_id: 1, user_id: 1, status: 1, created_at: -1 });

    // Action items (core/actions)
    await db.collection('action_items').createIndex({ item_id: 1 }, { unique: true });
    await db.collection('action_items').createIndex({ workspace_id: 1, status: 1, due_date: 1 });
    await db.collection('action_items').createIndex({ workspace_id: 1, owner_ids: 1, status: 1 });
    await db.collection('action_items').createIndex({ workspace_id: 1, decision_id: 1 });

    // Private beta approved list (core/beta): an email or a whole Google domain
    // Context the AI reads with every meeting (core/context): company (user_id null) and personal
    await db.collection('ai_context').createIndex({ workspace_id: 1, user_id: 1 }, { unique: true });
    await db.collection('beta_access').createIndex({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
    await db.collection('beta_access').createIndex({ domain: 1 }, { unique: true, partialFilterExpression: { domain: { $type: 'string' } } });

    console.log('✅ Database ready!');
    return { db, decisionsCollection };
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('⚠️  App will continue running but database features will be unavailable');
    console.error('⚠️  Please check MONGODB_URI environment variable and network connectivity');
    // Don't exit - let the app continue running so Railway health checks work
    // The health endpoint will show mongodb: "disconnected"
    return null;
  }
}

/**
 * Returns the decisions collection
 */
function getDecisionsCollection() {
  if (!decisionsCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return decisionsCollection;
}

/**
 * Returns the database instance
 */
function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return db;
}

/**
 * Returns the AI suggestions collection
 */
function getAISuggestionsCollection() {
  if (!aiSuggestionsCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return aiSuggestionsCollection;
}

/**
 * Returns the meeting transcripts collection
 */
function getMeetingTranscriptsCollection() {
  if (!meetingTranscriptsCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return meetingTranscriptsCollection;
}

/**
 * Returns the AI feedback collection
 */
function getAIFeedbackCollection() {
  if (!aiFeedbackCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return aiFeedbackCollection;
}

/**
 * Returns the workspace settings collection
 */
function getWorkspaceSettingsCollection() {
  if (!workspaceSettingsCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return workspaceSettingsCollection;
}

/**
 * Returns the workspace admins collection
 */
function getWorkspaceAdminsCollection() {
  if (!workspaceAdminsCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return workspaceAdminsCollection;
}

function getExtensionInstallsCollection() {
  if (!extensionInstallsCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return extensionInstallsCollection;
}

/**
 * Returns the workspace spaces collection
 */
function getWorkspaceSpacesCollection() {
  if (!workspaceSpacesCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return workspaceSpacesCollection;
}

/**
 * Returns the space members collection
 */
function getSpaceMembersCollection() {
  if (!spaceMembersCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return spaceMembersCollection;
}

/**
 * Returns the workspace invites collection
 */
function getWorkspaceInvitesCollection() {
  if (!workspaceInvitesCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return workspaceInvitesCollection;
}

/**
 * Returns the workspace members collection
 */
function getWorkspaceMembersCollection() {
  if (!workspaceMembersCollection) {
    throw new Error('Database not initialized. Call connectToMongoDB first.');
  }
  return workspaceMembersCollection;
}

/**
 * Closes the MongoDB connection (used by tests and scripts)
 */
async function closeMongoDB() {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    db = null;
  }
}

module.exports = {
  connectToMongoDB,
  closeMongoDB,
  getDecisionsCollection,
  getDatabase,
  getAISuggestionsCollection,
  getMeetingTranscriptsCollection,
  getAIFeedbackCollection,
  getWorkspaceSettingsCollection,
  getWorkspaceAdminsCollection,
  getExtensionInstallsCollection,
  getWorkspaceSpacesCollection,
  getSpaceMembersCollection,
  getWorkspaceInvitesCollection,
  getWorkspaceMembersCollection
};
