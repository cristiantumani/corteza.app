const { MongoClient } = require('mongodb');
const config = require('./environment');

let db = null;
let decisionsCollection = null;
let aiSuggestionsCollection = null;
let meetingTranscriptsCollection = null;
let aiFeedbackCollection = null;
let workspaceSettingsCollection = null;
let workspaceAdminsCollection = null;

/**
 * Connects to MongoDB and sets up indexes
 */
async function connectToMongoDB() {
  try {
    // Log outbound IP for debugging MongoDB allowlist issues
    try {
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
    console.log('✅ Connected to MongoDB!');

    db = client.db(config.mongodb.dbName);
    decisionsCollection = db.collection('decisions');
    aiSuggestionsCollection = db.collection('ai_suggestions');
    meetingTranscriptsCollection = db.collection('meeting_transcripts');
    aiFeedbackCollection = db.collection('ai_feedback');
    workspaceSettingsCollection = db.collection('workspace_settings');
    workspaceAdminsCollection = db.collection('workspace_admins');

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

    // Analytics performance indexes
    await decisionsCollection.createIndex({ workspace_id: 1, creator: 1 }); // Top contributors
    await decisionsCollection.createIndex({ workspace_id: 1, channel_id: 1 }); // Channel activity
    await decisionsCollection.createIndex({ tags: 1 }); // Tag cloud aggregation

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

module.exports = {
  connectToMongoDB,
  getDecisionsCollection,
  getDatabase,
  getAISuggestionsCollection,
  getMeetingTranscriptsCollection,
  getAIFeedbackCollection,
  getWorkspaceSettingsCollection,
  getWorkspaceAdminsCollection
};
