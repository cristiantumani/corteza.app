/**
 * Check OAuth Installation Status
 * Verifies if workspace is properly installed in the database
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function checkOAuthStatus() {
  console.log('🔍 Checking OAuth installation status...\n');

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db('decision-logger');
    const collection = db.collection('slack_installations');

    // Get all installations
    const installations = await collection.find({}).toArray();

    console.log(`📋 Total installations: ${installations.length}\n`);

    if (installations.length === 0) {
      console.log('❌ No installations found!');
      console.log('   You need to install the app via OAuth.\n');
      console.log('🔗 Visit: https://YOUR-RAILWAY-URL/slack/install\n');
    } else {
      installations.forEach((install, index) => {
        console.log(`\n--- Installation ${index + 1} ---`);
        console.log(`Team ID: ${install.team_id || 'MISSING'}`);
        console.log(`Team Name: ${install.team_name || 'Unknown'}`);
        console.log(`Bot ID: ${install.bot_id || 'Unknown'}`);
        console.log(`Installed: ${install.installed_at || 'Unknown'}`);
        console.log(`Updated: ${install.updated_at || 'Unknown'}`);

        // Check for corrupted records
        if (!install.team_id) {
          console.log('⚠️  WARNING: This record has no team_id (corrupted)');
        }
        if (!install.bot_token) {
          console.log('⚠️  WARNING: This record has no bot_token');
        }
      });
    }

    // Check indexes
    console.log('\n\n📊 Indexes:');
    const indexes = await collection.indexes();
    indexes.forEach(idx => {
      console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n\n👋 Disconnected from MongoDB');
  }
}

// Run the check
checkOAuthStatus();
