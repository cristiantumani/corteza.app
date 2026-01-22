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

// Test case imports
const searchAccuracyTests = require('./test-cases/search-accuracy.json');
const conversationalTests = require('./test-cases/conversational-quality.json');
const edgeCaseTests = require('./test-cases/edge-cases.json');

async function main() {
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

      const avgScore = searchResults.summary.scores.reduce((acc, s) => acc + s.score, 0) / searchResults.summary.scores.length;
      const passed = searchResults.summary.scores.filter(s => s.score >= 0.95).length;
      const total = searchResults.summary.scores.length;

      results.search = {
        passed,
        total,
        avgScore,
        passRate: passed / total
      };

      console.log(`   ✅ Tests: ${passed}/${total} passed`);
      console.log(`   📈 Average score: ${(avgScore * 100).toFixed(1)}%`);

      if (avgScore < 0.95) {
        allTestsPassed = false;
        console.log(`   ⚠️  Below target (95%+)\n`);
      } else {
        console.log(`   🎉 Above target!\n`);
      }
    }

    // Run conversational quality evals
    if (!searchOnly) {
      console.log('💬 Running Conversational Quality Evals...');

      const conversationalResults = await runConversationalEval(conversationalTests.test_cases);

      const avgScore = conversationalResults.summary.scores.reduce((acc, s) => acc + s.score, 0) / conversationalResults.summary.scores.length;
      const passed = conversationalResults.summary.scores.filter(s => s.score >= 0.80).length;
      const total = conversationalResults.summary.scores.length;

      results.conversational = {
        passed,
        total,
        avgScore,
        passRate: passed / total
      };

      console.log(`   ✅ Tests: ${passed}/${total} passed`);
      console.log(`   📈 Average score: ${(avgScore * 100).toFixed(1)}%`);

      if (avgScore < 0.80) {
        allTestsPassed = false;
        console.log(`   ⚠️  Below target (80%+)\n`);
      } else {
        console.log(`   🎉 Above target!\n`);
      }
    }

    // Summary
    console.log('📋 Summary:');

    if (results.search) {
      console.log(`   Search Accuracy: ${(results.search.passRate * 100).toFixed(1)}% (${results.search.passed}/${results.search.total})`);
    }

    if (results.conversational) {
      console.log(`   Conversational: ${(results.conversational.passRate * 100).toFixed(1)}% (${results.conversational.passed}/${results.conversational.total})`);
    }

    console.log(`\n🔗 View detailed results: https://braintrustdata.com`);

    if (allTestsPassed) {
      console.log('\n✅ All evals passed! Ship it! 🚀\n');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some evals below target. Review and improve.\n');
      process.exit(1);
    }

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
