/**
 * Fix OAuth Installation Database
 * Removes corrupted installation records and rebuilds indexes
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function fixOAuthDatabase() {
  console.log('🔧 Connecting to MongoDB...');

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('decision-logger');
    const collection = db.collection('slack_installations');

    // Step 1: Drop the problematic unique index
    console.log('\n🗑️  Dropping unique index on team.id...');
    try {
      await collection.dropIndex('team.id_1');
      console.log('✅ Dropped index team.id_1');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️  Index team.id_1 does not exist (already dropped)');
      } else {
        console.warn('⚠️  Could not drop index:', error.message);
      }
    }

    // Step 2: Delete all corrupted records
    console.log('\n🧹 Cleaning up corrupted records...');

    // Delete records with null team_id
    const nullResult = await collection.deleteMany({ team_id: null });
    console.log(`   Deleted ${nullResult.deletedCount} records with team_id: null`);

    // Delete records with missing team_id field
    const missingResult = await collection.deleteMany({ team_id: { $exists: false } });
    console.log(`   Deleted ${missingResult.deletedCount} records with missing team_id`);

    // Step 3: Show remaining installations
    console.log('\n📋 Remaining installations:');
    const allInstallations = await collection.find({}).toArray();

    if (allInstallations.length === 0) {
      console.log('   (No installations found - database is clean)');
    } else {
      allInstallations.forEach(install => {
        console.log(`   - Team: ${install.team_name || 'Unknown'} (${install.team_id || 'MISSING'})`);
        console.log(`     Installed: ${install.installed_at || 'Unknown'}`);
      });
    }

    // Step 4: Recreate the unique index (but make team.id required)
    console.log('\n🔨 Recreating unique index on team.id...');
    try {
      await collection.createIndex(
        { team_id: 1 },
        {
          unique: true,
          partialFilterExpression: { team_id: { $exists: true, $type: 'string' } }
        }
      );
      console.log('✅ Created unique index on team_id (nulls excluded)');
    } catch (error) {
      console.warn('⚠️  Could not create index:', error.message);
    }

    console.log('\n✅ Database cleanup complete!');
    console.log('\n🔄 Next steps:');
    console.log('   1. Restart your app (if running locally) or wait for Railway redeploy');
    console.log('   2. Visit: https://YOUR-RAILWAY-URL/slack/install');
    console.log('   3. Complete the OAuth installation');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run the fix
fixOAuthDatabase();
