/**
 * Fix OAuth Installation Database
 * Removes corrupted installation records with null team.id
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

    // Find and delete records with null team_id
    console.log('\n🔍 Looking for corrupted records (team_id: null)...');
    const corruptedRecords = await collection.find({ team_id: null }).toArray();

    if (corruptedRecords.length === 0) {
      console.log('✅ No corrupted records found!');
    } else {
      console.log(`⚠️  Found ${corruptedRecords.length} corrupted record(s)`);

      const result = await collection.deleteMany({ team_id: null });
      console.log(`✅ Deleted ${result.deletedCount} corrupted record(s)`);
    }

    // Show all installations
    console.log('\n📋 Current installations:');
    const allInstallations = await collection.find({}).toArray();

    if (allInstallations.length === 0) {
      console.log('   (No installations found - database is clean)');
    } else {
      allInstallations.forEach(install => {
        console.log(`   - Team: ${install.team_name || 'Unknown'} (${install.team_id || 'null'})`);
        console.log(`     Installed: ${install.installed_at || 'Unknown'}`);
      });
    }

    console.log('\n✅ Database cleanup complete!');
    console.log('\n🔄 Next step: Reinstall the app via OAuth:');
    console.log('   Visit: https://YOUR-RAILWAY-URL/slack/install');

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
