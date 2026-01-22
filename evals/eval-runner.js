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
  // Transform test cases into Braintrust format
  const braintrustData = testCases.map(tc => ({
    input: {
      query: tc.query,
      limit: tc.limit
    },
    expected: tc.expected,
    metadata: {
      id: tc.id,
      rationale: tc.rationale
    }
  }));

  return await Eval('Corteza', {
    data: braintrustData,
    experimentName: 'search-quality',
    task: async (input) => {
      const result = await hybridSearch(input.query, {
        workspace_id: workspaceId,
        limit: input.limit || 10
      });

      return {
        output: result.results.all,
        searchMethod: result.searchMethod
      };
    },
    scores: [
      (args) => {
        const { output, expected } = args;
        const expectedIds = expected.decision_ids || [];

        if (expectedIds.length === 0) {
          // If no expected IDs, check if output is empty (for negative tests)
          return { name: 'contains_expected', score: output.length === 0 ? 1.0 : 0.0 };
        }

        const actualIds = output.map(d => d.id);
        const found = expectedIds.filter(id => actualIds.includes(id));
        return { name: 'contains_expected', score: found.length / expectedIds.length };
      },
      (args) => {
        const { output, expected } = args;
        const excludeIds = expected.exclude_ids || [];

        if (excludeIds.length === 0) {
          return { name: 'no_false_positives', score: 1.0 }; // No false positives to check
        }

        const actualIds = output.map(d => d.id);
        const falsePositives = actualIds.filter(id => excludeIds.includes(id));
        return { name: 'no_false_positives', score: falsePositives.length === 0 ? 1.0 : 0.0 };
      },
      (args) => {
        const { output, expected } = args;

        if (!expected.top_result_id) {
          return { name: 'top_result_correct', score: 1.0 }; // No top result to check
        }

        if (output.length === 0) {
          return { name: 'top_result_correct', score: 0.0 }; // Expected result but got none
        }

        return { name: 'top_result_correct', score: output[0].id === expected.top_result_id ? 1.0 : 0.0 };
      }
    ]
  });
}

module.exports = { runSearchEval };
