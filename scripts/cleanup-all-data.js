const { MongoClient } = require('mongodb');
require('dotenv').config();

/**
 * DANGER: This script deletes ALL data from the database
 * Use only for development/testing cleanup
 */

async function cleanupAllData() {
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

    // Collections to clean up
    const collections = [
      'decisions',
      'workspace_members',
      'workspace_spaces',
      'space_members',
      'slack_installations',
      'feedback',
      'api_keys',
      'workspace_invites',
      'extension_installs',
      'workspace_settings'
    ];

    console.log('\n🗑️  Starting cleanup...\n');

    for (const collectionName of collections) {
      try {
        const collection = db.collection(collectionName);
        const count = await collection.countDocuments({});

        if (count > 0) {
          const result = await collection.deleteMany({});
          console.log(`✅ ${collectionName}: Deleted ${result.deletedCount} documents`);
        } else {
          console.log(`⚪ ${collectionName}: Already empty`);
        }
      } catch (error) {
        if (error.message.includes('ns not found')) {
          console.log(`⚪ ${collectionName}: Collection doesn't exist`);
        } else {
          console.error(`❌ ${collectionName}: Error - ${error.message}`);
        }
      }
    }

    console.log('\n✅ Cleanup complete! Database is now empty.\n');
    console.log('📝 Next steps:');
    console.log('   1. Reinstall the Slack app (if using OAuth)');
    console.log('   2. Create a new workspace via /auth/login');
    console.log('   3. Create your first space in Settings\n');

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Confirmation prompt
console.log('\n⚠️  WARNING: This will DELETE ALL DATA from the database!\n');
console.log('Collections that will be cleared:');
console.log('  - decisions');
console.log('  - workspace_members');
console.log('  - workspace_spaces');
console.log('  - space_members');
console.log('  - slack_installations');
console.log('  - feedback');
console.log('  - api_keys');
console.log('  - workspace_invites');
console.log('  - extension_installs');
console.log('  - workspace_settings\n');

// Check for --confirm flag
if (process.argv.includes('--confirm')) {
  cleanupAllData().catch(console.error);
} else {
  console.log('❌ Aborted. Run with --confirm flag to proceed:');
  console.log('   node scripts/cleanup-all-data.js --confirm\n');
  process.exit(0);
}
