const { MongoClient } = require('mongodb');
require('dotenv').config();

async function listCollections() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('❌ MONGODB_URI not found in environment');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db();
    const collections = await db.listCollections().toArray();

    console.log(`\n📊 Database: ${db.databaseName}`);
    console.log(`📁 Found ${collections.length} collections:\n`);

    for (const collection of collections) {
      const coll = db.collection(collection.name);
      const count = await coll.countDocuments({});
      console.log(`   ${collection.name}: ${count} documents`);
    }

    console.log('');

  } catch (error) {
    console.error('❌ Failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

listCollections().catch(console.error);
