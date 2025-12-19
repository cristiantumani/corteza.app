/**
 * Test semantic search with different workspace IDs
 */

require('dotenv').config();
const { connectToMongoDB } = require('../src/config/database');
const { initializeEmbeddings } = require('../src/services/embeddings');
const { hybridSearch } = require('../src/services/semantic-search');

async function testWorkspaceSearch() {
  console.log('🧪 Testing Semantic Search with Different Workspaces\n');

  await connectToMongoDB();
  initializeEmbeddings();

  const workspaces = ['T0A3HLH3ATE', 'T0WKH1NGL'];
  const query = 'show me all technical decisions';

  for (const workspace_id of workspaces) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Workspace: ${workspace_id}`);
    console.log('='.repeat(60));

    try {
      const result = await hybridSearch(query, {
        workspace_id,
        limit: 5,
        minScore: 0.5
      });

      console.log(`\n📊 Results:`);
      console.log(`   - Method: ${result.searchMethod}`);
      console.log(`   - Total: ${result.results.all.length}`);
      console.log(`   - Highly relevant: ${result.results.highlyRelevant.length}`);
      console.log(`   - Relevant: ${result.results.relevant.length}`);
      console.log(`   - Somewhat relevant: ${result.results.somewhatRelevant.length}`);

      if (result.results.all.length > 0) {
        console.log(`\n✅ Top results:`);
        result.results.all.slice(0, 3).forEach((r, i) => {
          console.log(`   ${i + 1}. "${r.text.substring(0, 60)}..."`);
          console.log(`      Score: ${(r.score * 100).toFixed(1)}%, Type: ${r.type}`);
        });
      } else {
        console.log(`\n❌ No results found for this workspace`);
      }

    } catch (error) {
      console.error(`\n❌ Error: ${error.message}`);
    }
  }

  process.exit(0);
}

testWorkspaceSearch();
