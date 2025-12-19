/**
 * Quick script to check if decisions have embeddings
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const config = require('../src/config/environment');

async function checkEmbeddings() {
  console.log('🔍 Checking for embeddings in MongoDB...\n');

  const client = new MongoClient(config.mongodb.uri);

  try {
    await client.connect();
    const db = client.db(config.mongodb.dbName);
    const decisionsCollection = db.collection('decisions');

    // Count total decisions
    const total = await decisionsCollection.countDocuments();
    console.log(`📊 Total decisions: ${total}`);

    // Count decisions WITH embeddings
    const withEmbeddings = await decisionsCollection.countDocuments({
      embedding: { $exists: true, $ne: null }
    });
    console.log(`✅ Decisions with embeddings: ${withEmbeddings}`);

    // Count decisions WITHOUT embeddings
    const withoutEmbeddings = total - withEmbeddings;
    console.log(`❌ Decisions without embeddings: ${withoutEmbeddings}\n`);

    // Show sample decision
    if (total > 0) {
      const sample = await decisionsCollection.findOne({});
      console.log('📝 Sample decision:');
      console.log(`   ID: ${sample.id}`);
      console.log(`   Text: ${sample.text.substring(0, 60)}...`);
      console.log(`   Has embedding: ${sample.embedding ? 'YES ✅' : 'NO ❌'}`);
      if (sample.embedding) {
        console.log(`   Embedding dimensions: ${sample.embedding.length}`);
      }
      console.log();
    }

    // Check if vector search index exists
    console.log('🔍 Checking vector search index...');
    const indexes = await decisionsCollection.indexes();
    const hasVectorIndex = indexes.some(idx =>
      idx.name && idx.name.includes('vector')
    );
    console.log(`   Vector index visible from app: ${hasVectorIndex ? 'YES ✅' : 'NO ❌'}`);
    console.log('   (Note: Atlas Vector Search indexes may not show in regular index list)\n');

    if (withoutEmbeddings > 0) {
      console.log('⚠️  ACTION NEEDED: Run migration script again with proper OpenAI billing');
      console.log('   Command: node scripts/migrate-embeddings.js\n');
    } else {
      console.log('✅ All decisions have embeddings! Semantic search should work.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

checkEmbeddings();
