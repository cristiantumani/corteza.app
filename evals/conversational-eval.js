const { Eval } = require('braintrust');
const { generateConversationalResponse } = require('../src/services/semantic-search');
const Anthropic = require('@anthropic-ai/sdk');

/**
 * Run conversational quality evaluation
 * Tests that AI responses are natural, warm, and include key information
 *
 * @param {Array} testCases - Array of test cases with query, results, and expected
 * @returns {Promise<object>} Evaluation results from Braintrust
 */
async function runConversationalEval(testCases) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Transform test cases into Braintrust format
  const braintrustData = testCases.map(tc => ({
    input: {
      query: tc.query,
      results: tc.results,
      conversationHistory: tc.conversationHistory
    },
    expected: tc.expected,
    metadata: {
      id: tc.id,
      rationale: tc.rationale
    }
  }));

  return await Eval('Corteza', {
    data: braintrustData,
    experimentName: 'conversational-quality',
    task: async (input) => {
      const response = await generateConversationalResponse(
        input.query,
        input.results,
        input.conversationHistory || []
      );
      return response;
    },
    scores: [
      (args) => {
        const { output, expected } = args;
        const expectedIds = expected.decision_ids || [];

        if (expectedIds.length === 0) {
          return { name: 'includes_decision_ids', score: 1.0 }; // No decision IDs to check
        }

        const mentioned = expectedIds.filter(id =>
          output.includes(`#${id}`) ||
          output.includes(`Decision #${id}`) ||
          output.includes(`decision #${id}`)
        );

        return { name: 'includes_decision_ids', score: mentioned.length / expectedIds.length };
      },
      (args) => {
        const { output } = args;
        // Check for "we", "our", or "us" in the response
        const hasFirstPerson = /\b(we|our|us)\b/i.test(output);
        return { name: 'uses_first_person_plural', score: hasFirstPerson ? 1.0 : 0.0 };
      },
      (args) => {
        const { output } = args;
        // Should NOT contain structured sections like "High Relevance", "Medium Relevance", etc.
        const hasStructuredSections = /###?\s*(high|medium|low)\s*(relevance|similarity)/i.test(output);
        return { name: 'no_structured_sections', score: hasStructuredSections ? 0.0 : 1.0 };
      },
      (args) => {
        const { output } = args;
        const wordCount = output.split(/\s+/).length;

        // Target: 50-200 words (conversational but informative)
        let score = 0.8; // Default acceptable
        if (wordCount < 20) score = 0.0; // Too short
        else if (wordCount > 300) score = 0.5; // Too long
        else if (wordCount >= 50 && wordCount <= 200) score = 1.0; // Perfect

        return { name: 'appropriate_length', score };
      }
    ]
  });
}

module.exports = { runConversationalEval };
