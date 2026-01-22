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

  return await Eval('conversational-quality', {
    data: testCases,
    task: async (testCase) => {
      const response = await generateConversationalResponse(
        testCase.query,
        testCase.results,
        testCase.conversationHistory || []
      );
      return { output: response };
    },
    scores: [
      {
        name: 'includes_decision_ids',
        scorer: (args) => {
          const { output, expected } = args;
          const expectedIds = expected.decision_ids || [];

          if (expectedIds.length === 0) {
            return 1.0; // No decision IDs to check
          }

          const mentioned = expectedIds.filter(id =>
            output.includes(`#${id}`) ||
            output.includes(`Decision #${id}`) ||
            output.includes(`decision #${id}`)
          );

          return mentioned.length / expectedIds.length;
        }
      },
      {
        name: 'uses_first_person_plural',
        scorer: (args) => {
          const { output } = args;
          // Check for "we", "our", or "us" in the response
          return /\b(we|our|us)\b/i.test(output) ? 1.0 : 0.0;
        }
      },
      {
        name: 'no_structured_sections',
        scorer: (args) => {
          const { output } = args;
          // Should NOT contain structured sections like "High Relevance", "Medium Relevance", etc.
          const hasStructuredSections = /###?\s*(high|medium|low)\s*(relevance|similarity)/i.test(output);
          return hasStructuredSections ? 0.0 : 1.0;
        }
      },
      {
        name: 'appropriate_length',
        scorer: (args) => {
          const { output } = args;
          const wordCount = output.split(/\s+/).length;

          // Target: 50-200 words (conversational but informative)
          if (wordCount < 20) return 0.0; // Too short
          if (wordCount > 300) return 0.5; // Too long
          if (wordCount >= 50 && wordCount <= 200) return 1.0; // Perfect
          return 0.8; // Acceptable
        }
      },
      {
        name: 'llm_quality_judge',
        scorer: async (args) => {
          const { output, expected } = args;

          const prompt = `Rate this AI response for conversational quality (0-10):

Query: "${expected.query}"
Response: "${output}"

Criteria:
- Natural, human-like language (not robotic)
- Includes decision IDs for reference (#123 format)
- Uses "we" instead of passive voice
- Explains reasoning when available
- Warm and helpful tone
- No structured markdown sections

Score (0-10):`;

          try {
            const response = await anthropic.messages.create({
              model: 'claude-3-5-haiku-20241022',
              max_tokens: 10,
              temperature: 0.0,
              messages: [{ role: 'user', content: prompt }]
            });

            const scoreText = response.content[0].text.trim();
            const score = parseInt(scoreText);

            if (isNaN(score) || score < 0 || score > 10) {
              console.warn(`Invalid LLM judge score: ${scoreText}`);
              return 0.5; // Default to middle score if parsing fails
            }

            return score / 10;
          } catch (error) {
            console.error('LLM judge error:', error.message);
            return 0.5; // Default to middle score on error
          }
        }
      }
    ]
  });
}

module.exports = { runConversationalEval };
