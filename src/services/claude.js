const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/environment');
const { validateAISuggestion, sanitizeTranscriptText } = require('../middleware/ai-validation');

/**
 * Checks if Claude API is configured
 * @returns {boolean}
 */
function isClaudeConfigured() {
  return config.claude.isConfigured;
}

/**
 * Builds the prompt for Claude API to extract decisions from transcript
 * @param {string} transcriptText - The meeting transcript text
 * @returns {string} The formatted prompt
 */
function buildDecisionExtractionPrompt(transcriptText) {
  return `You are an expert at analyzing meeting transcripts and identifying decisions that were made.

TASK: Analyze the following meeting transcript and extract ALL decisions that were made.

DEFINITION OF A DECISION:
A decision is when someone explicitly says they chose, agreed, or committed to something specific.

Look for phrases like:
- "We decided to..."
- "Let's go with..."
- "We'll use..."
- "Agreed, we will..."
- "The decision is to..."
- "We're choosing..."

Examples of DECISIONS:
  ✅ "We'll use React for the frontend"
  ✅ "We decided not to implement bidirectional sync"
  ✅ "Let's go with PostgreSQL"
  ✅ "Agreed, we will launch in Q2"

Examples of NOT decisions (just discussion):
  ❌ "We should probably think about performance" (too vague, no commitment)
  ❌ "What if we used GraphQL?" (just a question)
  ❌ "Maybe we could try..." (no commitment)

FOR EACH DECISION, EXTRACT:
1. **decision_text**: A clear, concise statement of the decision (1-2 sentences max)
2. **decision_type**: Classify as "product", "ux", or "technical"
   - product: Features, roadmap, business decisions
   - ux: User experience, design, interaction decisions
   - technical: Architecture, technology choices, implementation decisions
3. **epic_key**: If a Jira key is mentioned nearby (format: ABC-123 or ABC-1234), extract it. Otherwise null.
4. **tags**: Extract 2-5 relevant tags/keywords (lowercase, single words or short phrases)
5. **confidence**: Your confidence this is truly a decision (0.0 to 1.0, where 0.9+ is very confident, 0.6-0.8 is moderate, below 0.6 is uncertain)
6. **context**: The exact surrounding text from the transcript (up to 200 chars before and after the decision)

OUTPUT FORMAT:
Return ONLY a valid JSON array of decision objects. Do not include any explanatory text before or after the JSON.

Example format:
\`\`\`json
[
  {
    "decision_text": "We will use Claude API for AI-powered decision extraction",
    "decision_type": "technical",
    "epic_key": "LOK-456",
    "tags": ["ai", "claude", "automation"],
    "confidence": 0.95,
    "context": "After discussing options, we decided that we will use Claude API for AI-powered decision extraction since it has the best accuracy. This will be part of LOK-456 for the next sprint."
  }
]
\`\`\`

If no decisions are found, return an empty array: []

IMPORTANT GUIDELINES:
- Only extract actual decisions, not discussions or ideas
- Be conservative with confidence scores - only use 0.9+ when absolutely certain
- Tags should be relevant keywords from the context
- Context should help the reader understand why this was identified as a decision

TRANSCRIPT:
---
${transcriptText}
---

Now analyze this transcript and extract all decisions as JSON:`;
}

/**
 * Calls Claude API with retry logic
 * @param {string} prompt - The prompt to send
 * @returns {Promise<Object>} Claude API response
 */
async function callClaudeAPI(prompt) {
  if (!isClaudeConfigured()) {
    throw new Error('Claude API not configured. Set ANTHROPIC_API_KEY in environment.');
  }

  const anthropic = new Anthropic({
    apiKey: config.claude.apiKey
  });

  try {
    console.log('🤖 Calling Claude API...');

    const response = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: config.claude.maxTokens,
      temperature: 0.2, // Lower temperature for more consistent extraction
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    console.log('✅ Claude API response received');
    return response;
  } catch (error) {
    // Handle rate limiting
    if (error.status === 429) {
      console.log('⚠️  Claude API rate limit, retrying in 5s...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      // Retry once
      return anthropic.messages.create({
        model: config.claude.model,
        max_tokens: config.claude.maxTokens,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
    }

    // Log and re-throw other errors
    console.error('❌ Claude API error:', error.message);
    throw error;
  }
}

/**
 * Parses Claude's response into structured decision objects
 * @param {string} claudeResponse - The text response from Claude
 * @returns {Array<Object>} Array of decision objects
 */
function parseDecisionResponse(claudeResponse) {
  try {
    // Claude might return JSON in code blocks, so extract it
    let jsonString = claudeResponse;

    // Try to extract from markdown code block
    const jsonMatch = claudeResponse.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    } else {
      // Try to extract from generic code block
      const codeMatch = claudeResponse.match(/```\n([\s\S]*?)\n```/);
      if (codeMatch) {
        jsonString = codeMatch[1];
      }
    }

    // Parse JSON
    const decisions = JSON.parse(jsonString.trim());

    // Validate structure
    if (!Array.isArray(decisions)) {
      console.error('❌ Claude response is not an array');
      return [];
    }

    // Validate and filter each decision
    const validDecisions = decisions.filter(d => {
      const isValid = validateAISuggestion(d);
      if (!isValid) {
        console.log(`⚠️  Skipping invalid suggestion:`, d);
      }
      return isValid;
    });

    console.log(`✅ Parsed ${validDecisions.length} valid decisions from Claude response`);
    return validDecisions;
  } catch (error) {
    console.error('❌ Failed to parse Claude response:', error.message);
    console.error('Response was:', claudeResponse.substring(0, 500));
    return [];
  }
}

/**
 * Extracts decisions from meeting transcript using Claude API
 * @param {string} transcriptText - The meeting transcript content
 * @returns {Promise<Object>} { decisions: Array, processingTime: number, model: string }
 */
async function extractDecisionsFromTranscript(transcriptText) {
  const startTime = Date.now();

  // Sanitize the transcript text
  const sanitized = sanitizeTranscriptText(transcriptText);

  // Build the prompt
  const prompt = buildDecisionExtractionPrompt(sanitized);

  // Call Claude API
  const response = await callClaudeAPI(prompt);

  // Extract text from response
  const responseText = response.content[0].text;

  // Parse the response
  const decisions = parseDecisionResponse(responseText);

  const processingTime = Date.now() - startTime;

  console.log(`⏱️  Processing took ${processingTime}ms`);

  return {
    decisions,
    processingTime,
    model: response.model
  };
}

module.exports = {
  extractDecisionsFromTranscript,
  isClaudeConfigured,
  buildDecisionExtractionPrompt,
  callClaudeAPI,
  parseDecisionResponse
};
