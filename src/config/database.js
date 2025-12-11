const { MongoClient } = require('mongodb');
const config = require('./environment');

let db = null;
let decisionsCollection = null;

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

    // Create indexes (using background option for production)
    await decisionsCollection.createIndex({ text: 'text', tags: 'text' });
    await decisionsCollection.createIndex({ timestamp: -1 });

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

module.exports = {
  connectToMongoDB,
  getDecisionsCollection,
  getDatabase
};
