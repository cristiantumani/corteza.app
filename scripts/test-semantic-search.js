/**
 * Test semantic search locally before deploying
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const config = require('../src/config/environment');
const { initializeEmbeddings, isEmbeddingsEnabled } = require('../src/services/embeddings');
const { hybridSearch } = require('../src/services/semantic-search');

async function testSemanticSearch() {
  console.log('🧪 Testing Semantic Search\n');

  // Initialize
  initializeEmbeddings();

  if (!isEmbeddingsEnabled()) {
    console.error('❌ Embeddings not enabled. Check OPENAI_API_KEY');
    process.exit(1);
  }

  const client = new MongoClient(config.mongodb.uri);

  try {
    await client.connect();
    const db = client.db(config.mongodb.dbName);
    const decisionsCollection = db.collection('decisions');

    // Get a sample decision to get workspace_id
    const sampleDecision = await decisionsCollection.findOne({});

    if (!sampleDecision) {
      console.error('❌ No decisions found in database');
      process.exit(1);
    }

    console.log(`📊 Testing with workspace: ${sampleDecision.workspace_id}`);
    console.log(`📝 Sample decision: "${sampleDecision.text.substring(0, 60)}..."\n`);

    // Test queries
    const testQueries = [
      'show me all technical decisions',
      'what did we decide about spaces',
      'recent decisions',
      sampleDecision.text.split(' ').slice(0, 3).join(' ') // First 3 words of a real decision
    ];

    for (const query of testQueries) {
      console.log(`🔍 Query: "${query}"`);

      try {
        const result = await hybridSearch(query, {
          workspace_id: sampleDecision.workspace_id,
          limit: 5
        });

        console.log(`   Method: ${result.searchMethod}`);
        console.log(`   Results: ${result.results.all.length}`);

        if (result.results.all.length > 0) {
          console.log(`   ✅ Top result: "${result.results.all[0].text.substring(0, 60)}..."`);
          if (result.results.all[0].score) {
            console.log(`   📊 Score: ${(result.results.all[0].score * 100).toFixed(1)}%`);
          }
        } else {
          console.log(`   ❌ No results found`);
        }
        console.log();

      } catch (error) {
        console.error(`   ❌ Error: ${error.message}\n`);
      }
    }

    console.log('✅ Test complete!\n');
    console.log('💡 If semantic search is working above, it should work in production too.');
    console.log('   Make sure OPENAI_API_KEY is set in Railway environment variables.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
  }
}

testSemanticSearch();
