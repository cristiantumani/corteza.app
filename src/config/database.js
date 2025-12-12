const { MongoClient } = require('mongodb');
const config = require('./environment');

let db = null;
let decisionsCollection = null;
let aiSuggestionsCollection = null;
let meetingTranscriptsCollection = null;
let aiFeedbackCollection = null;

/**
 * Connects to MongoDB and sets up indexes
 */
async function connectToMongoDB() {
  try {
    const client = new MongoClient(config.mongodb.uri);
    await client.connect();
    console.log('✅ Connected to MongoDB!');

    db = client.db(config.mongodb.dbName);
    decisionsCollection = db.collection('decisions');
    aiSuggestionsCollection = db.collection('ai_suggestions');
    meetingTranscriptsCollection = db.collection('meeting_transcripts');
    aiFeedbackCollection = db.collection('ai_feedback');

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

    console.log('✅ Database ready!');
    return { db, decisionsCollection };
  } catch (error) {
    console.error('❌ MongoDB error:', error);
    process.exit(1);
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

module.exports = {
  connectToMongoDB,
  getDecisionsCollection,
  getDatabase,
  getAISuggestionsCollection,
  getMeetingTranscriptsCollection,
  getAIFeedbackCollection
};
