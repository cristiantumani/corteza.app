/**
 * One-time script to clear all existing data before implementing multi-tenancy
 * Run this with: node clear-database.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function clearDatabase() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    console.log('✅ Connected!');

    const db = client.db('decision-logger');

    const decisions = db.collection('decisions');
    const aiSuggestions = db.collection('ai_suggestions');
    const meetingTranscripts = db.collection('meeting_transcripts');
    const aiFeedback = db.collection('ai_feedback');

    console.log('\n🗑️  Deleting all data...\n');

    const [decisionsResult, suggestionsResult, transcriptsResult, feedbackResult] = await Promise.all([
      decisions.deleteMany({}),
      aiSuggestions.deleteMany({}),
      meetingTranscripts.deleteMany({}),
      aiFeedback.deleteMany({})
    ]);

    console.log(`✅ Deleted ${decisionsResult.deletedCount} decisions`);
    console.log(`✅ Deleted ${suggestionsResult.deletedCount} AI suggestions`);
    console.log(`✅ Deleted ${transcriptsResult.deletedCount} meeting transcripts`);
    console.log(`✅ Deleted ${feedbackResult.deletedCount} AI feedback entries`);

    console.log('\n🎉 Database cleared successfully!');
    console.log('Ready for multi-tenancy implementation.\n');

  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

clearDatabase();
