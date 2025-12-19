/**
 * Check workspace IDs in database
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const config = require('../src/config/environment');

async function checkWorkspaces() {
  console.log('🔍 Checking workspace IDs in database...\n');

  const client = new MongoClient(config.mongodb.uri);

  try {
    await client.connect();
    const db = client.db(config.mongodb.dbName);
    const decisionsCollection = db.collection('decisions');

    // Get distinct workspace IDs
    const workspaceIds = await decisionsCollection.distinct('workspace_id');

    console.log(`📊 Found ${workspaceIds.length} distinct workspace(s):\n`);

    for (const workspaceId of workspaceIds) {
      const count = await decisionsCollection.countDocuments({ workspace_id: workspaceId });
      const withEmbeddings = await decisionsCollection.countDocuments({
        workspace_id: workspaceId,
        embedding: { $exists: true, $ne: null }
      });

      console.log(`Workspace: ${workspaceId || '(null)'}`);
      console.log(`  - Total decisions: ${count}`);
      console.log(`  - With embeddings: ${withEmbeddings}`);

      // Show a sample decision
      const sample = await decisionsCollection.findOne({ workspace_id: workspaceId });
      if (sample) {
        console.log(`  - Sample: "${sample.text.substring(0, 60)}..."`);
        console.log(`  - Type: ${sample.type}`);
      }
      console.log();
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

checkWorkspaces();
