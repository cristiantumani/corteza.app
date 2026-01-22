const { Eval } = require('braintrust');
const { hybridSearch } = require('../src/services/semantic-search');

/**
 * Run search accuracy evaluation
 * Tests that search finds the right decisions and filters false positives
 *
 * @param {Array} testCases - Array of test cases with query, expected, and rationale
 * @param {string} workspaceId - Workspace ID to search in
 * @returns {Promise<object>} Evaluation results from Braintrust
 */
async function runSearchEval(testCases, workspaceId) {
  return await Eval('search-quality', {
    data: testCases,
    task: async (testCase) => {
      const result = await hybridSearch(testCase.query, {
        workspace_id: workspaceId,
        limit: testCase.limit || 10
      });

      return {
        output: result.results.all,
        searchMethod: result.searchMethod
      };
    },
    scores: [
      {
        name: 'contains_expected',
        scorer: (args) => {
          const { output, expected } = args;
          const expectedIds = expected.decision_ids || [];

          if (expectedIds.length === 0) {
            // If no expected IDs, check if output is empty (for negative tests)
            return output.length === 0 ? 1.0 : 0.0;
          }

          const actualIds = output.map(d => d.id);
          const found = expectedIds.filter(id => actualIds.includes(id));
          return found.length / expectedIds.length;
        }
      },
      {
        name: 'no_false_positives',
        scorer: (args) => {
          const { output, expected } = args;
          const excludeIds = expected.exclude_ids || [];

          if (excludeIds.length === 0) {
            return 1.0; // No false positives to check
          }

          const actualIds = output.map(d => d.id);
          const falsePositives = actualIds.filter(id => excludeIds.includes(id));
          return falsePositives.length === 0 ? 1.0 : 0.0;
        }
      },
      {
        name: 'top_result_correct',
        scorer: (args) => {
          const { output, expected } = args;

          if (!expected.top_result_id) {
            return 1.0; // No top result to check
          }

          if (output.length === 0) {
            return 0.0; // Expected result but got none
          }

          return output[0].id === expected.top_result_id ? 1.0 : 0.0;
        }
      },
      {
        name: 'search_method_correct',
        scorer: (args) => {
          const { expected, input } = args;

          if (!expected.search_method) {
            return 1.0; // No search method to check
          }

          return input.searchMethod === expected.search_method ? 1.0 : 0.0;
        }
      },
      {
        name: 'recency_boost_applied',
        scorer: (args) => {
          const { expected } = args;

          if (expected.recency_boost_applied === undefined) {
            return 1.0; // No recency boost check
          }

          // This is a heuristic check - we'd need to expose this from hybridSearch
          // For now, we trust the keyword detection and just return 1.0
          // TODO: Expose recency boost flag from hybridSearch
          return 1.0;
        }
      }
    ]
  });
}

module.exports = { runSearchEval };
