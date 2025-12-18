/**
 * Migration Script: Generate Embeddings for Existing Decisions
 *
 * This script generates vector embeddings for all existing decisions
 * in the database to enable semantic search.
 *
 * Usage:
 *   node scripts/migrate-embeddings.js [options]
 *
 * Options:
 *   --workspace-id=XXX   Only migrate decisions from specific workspace
 *   --batch-size=N       Process N decisions at a time (default: 100)
 *   --dry-run           Show what would be done without making changes
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { batchGenerateEmbeddings, isEmbeddingsEnabled, initializeEmbeddings } = require('../src/services/embeddings');
const config = require('../src/config/environment');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  workspaceId: null,
  batchSize: 100,
  dryRun: false
};

args.forEach(arg => {
  if (arg.startsWith('--workspace-id=')) {
    options.workspaceId = arg.split('=')[1];
  } else if (arg.startsWith('--batch-size=')) {
    options.batchSize = parseInt(arg.split('=')[1]);
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  }
});

async function migrateEmbeddings() {
  console.log('🚀 Starting embedding migration...\n');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  // Initialize embeddings service
  initializeEmbeddings();

  if (!isEmbeddingsEnabled()) {
    console.error('❌ Embeddings not enabled. Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  let client;

  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    client = new MongoClient(config.mongodb.uri);
    await client.connect();
    const db = client.db(config.mongodb.dbName);
    const decisionsCollection = db.collection('decisions');
    console.log('✅ Connected to MongoDB\n');

    // Build filter
    const filter = {};
    if (options.workspaceId) {
      filter.workspace_id = options.workspaceId;
      console.log(`🔍 Filtering by workspace: ${options.workspaceId}\n`);
    }

    // Count total decisions
    const totalCount = await decisionsCollection.countDocuments(filter);
    console.log(`📊 Total decisions to process: ${totalCount}\n`);

    if (totalCount === 0) {
      console.log('✅ No decisions found. Nothing to do.');
      return;
    }

    // Find decisions without embeddings
    const decisionsWithoutEmbeddings = await decisionsCollection.countDocuments({
      ...filter,
      embedding: { $exists: false }
    });

    const decisionsWithEmbeddings = totalCount - decisionsWithoutEmbeddings;

    console.log(`✅ Already have embeddings: ${decisionsWithEmbeddings}`);
    console.log(`📝 Need embeddings: ${decisionsWithoutEmbeddings}\n`);

    if (decisionsWithoutEmbeddings === 0) {
      console.log('✅ All decisions already have embeddings!');
      return;
    }

    if (options.dryRun) {
      console.log(`\n🎯 DRY RUN COMPLETE: Would generate ${decisionsWithoutEmbeddings} embeddings`);
      return;
    }

    // Fetch decisions without embeddings
    console.log('🔄 Fetching decisions without embeddings...');
    const decisions = await decisionsCollection.find({
      ...filter,
      embedding: { $exists: false }
    }).toArray();

    // Process in batches
    let processed = 0;
    let failed = 0;

    for (let i = 0; i < decisions.length; i += options.batchSize) {
      const batch = decisions.slice(i, i + options.batchSize);
      const batchNum = Math.floor(i / options.batchSize) + 1;
      const totalBatches = Math.ceil(decisions.length / options.batchSize);

      console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} decisions)...`);

      try {
        // Generate embeddings for this batch
        const decisionsWithEmbeddings = await batchGenerateEmbeddings(batch);

        // Update each decision in the database
        for (const decision of decisionsWithEmbeddings) {
          try {
            await decisionsCollection.updateOne(
              { _id: decision._id },
              { $set: { embedding: decision.embedding } }
            );
            processed++;
          } catch (updateError) {
            console.error(`❌ Failed to update decision ${decision.id}:`, updateError.message);
            failed++;
          }
        }

        console.log(`✅ Batch ${batchNum} complete: ${batch.length} decisions embedded`);

        // Rate limiting: wait 1 second between batches to avoid OpenAI rate limits
        if (i + options.batchSize < decisions.length) {
          console.log('⏱️  Waiting 1s before next batch...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (batchError) {
        console.error(`❌ Batch ${batchNum} failed:`, batchError.message);
        failed += batch.length;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ MIGRATION COMPLETE!');
    console.log('='.repeat(60));
    console.log(`✅ Successfully processed: ${processed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total: ${processed + failed} / ${decisionsWithoutEmbeddings}`);

    if (processed > 0) {
      console.log('\n🎉 Semantic search is now enabled for these decisions!');
      console.log('💡 You can now use the chat interface to search by meaning, not just keywords.');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);

  } finally {
    if (client) {
      await client.close();
      console.log('\n📡 Disconnected from MongoDB');
    }
  }
}

// Run migration
console.log('🔧 Decision Logger - Embedding Migration Tool');
console.log('='.repeat(60));
console.log(`Batch size: ${options.batchSize}`);
console.log(`Workspace filter: ${options.workspaceId || 'All workspaces'}`);
console.log(`Dry run: ${options.dryRun ? 'Yes' : 'No'}`);
console.log('='.repeat(60) + '\n');

migrateEmbeddings()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
