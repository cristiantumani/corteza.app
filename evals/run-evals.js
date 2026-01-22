#!/usr/bin/env node

/**
 * Corteza AI Evaluation Runner
 *
 * Runs all AI quality evaluations including search accuracy and conversational quality.
 * Results are tracked in Braintrust for monitoring over time.
 *
 * Usage:
 *   npm run eval
 *   npm run eval -- --search-only
 *   npm run eval -- --conversational-only
 */

require('dotenv').config();
const { runSearchEval } = require('./eval-runner');
const { runConversationalEval } = require('./conversational-eval');
const { connectToMongoDB } = require('../src/config/database');

// Test case imports
const searchAccuracyTests = require('./test-cases/search-accuracy.json');
const conversationalTests = require('./test-cases/conversational-quality.json');
const edgeCaseTests = require('./test-cases/edge-cases.json');

async function main() {
  // Initialize database connection
  await connectToMongoDB();
  // Parse command line arguments
  const args = process.argv.slice(2);
  const searchOnly = args.includes('--search-only');
  const conversationalOnly = args.includes('--conversational-only');

  // Get workspace ID from environment
  const workspaceId = process.env.TEST_WORKSPACE_ID;

  if (!workspaceId) {
    console.error('❌ Error: TEST_WORKSPACE_ID environment variable is required');
    console.error('   Set it in your .env file or pass it as an environment variable');
    process.exit(1);
  }

  if (!process.env.BRAINTRUST_API_KEY) {
    console.error('❌ Error: BRAINTRUST_API_KEY environment variable is required');
    console.error('   Get your API key from https://braintrustdata.com');
    process.exit(1);
  }

  console.log('🧪 Running Corteza AI Evaluations...\n');
  console.log(`   Workspace ID: ${workspaceId}`);
  console.log(`   Mode: ${searchOnly ? 'Search Only' : conversationalOnly ? 'Conversational Only' : 'All Tests'}\n`);

  let allTestsPassed = true;
  const results = {};

  try {
    // Run search accuracy evals
    if (!conversationalOnly) {
      console.log('📊 Running Search Accuracy Evals...');

      const searchTests = [
        ...searchAccuracyTests.test_cases,
        ...edgeCaseTests.test_cases
      ];

      const searchResults = await runSearchEval(searchTests, workspaceId);

      // Braintrust returns summary with aggregated metrics
      const summary = searchResults.summary;

      results.search = {
        total: summary.testCount || searchTests.length,
        url: summary.projectUrl || 'https://www.braintrust.dev'
      };

      console.log(`   ✅ Tests run: ${results.search.total}`);
      console.log(`   🔗 View results: ${results.search.url}\n`);
    }

    // Run conversational quality evals
    if (!searchOnly) {
      console.log('💬 Running Conversational Quality Evals...');

      const conversationalResults = await runConversationalEval(conversationalTests.test_cases);

      // Braintrust returns summary with aggregated metrics
      const summary = conversationalResults.summary;

      results.conversational = {
        total: summary.testCount || conversationalTests.test_cases.length,
        url: summary.projectUrl || 'https://www.braintrust.dev'
      };

      console.log(`   ✅ Tests run: ${results.conversational.total}`);
      console.log(`   🔗 View results: ${results.conversational.url}\n`);
    }

    // Summary
    console.log('📋 Summary:');

    if (results.search) {
      console.log(`   Search Accuracy: ${results.search.total} tests run`);
    }

    if (results.conversational) {
      console.log(`   Conversational: ${results.conversational.total} tests run`);
    }

    console.log('\n🔗 View detailed results and scores at: https://www.braintrust.dev/app/corteza-ai-evals');
    console.log('\n✅ Evals completed! Check Braintrust dashboard for detailed scores.\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error running evals:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };
