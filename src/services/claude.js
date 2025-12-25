const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/environment');
const { validateAISuggestion, sanitizeTranscriptText } = require('../middleware/ai-validation');
const { getAIFeedbackCollection } = require('../config/database');

/**
 * Checks if Claude API is configured
 * @returns {boolean}
 */
function isClaudeConfigured() {
  return config.claude.isConfigured;
}

/**
 * Fetches approved feedback examples for few-shot learning
 * @param {string} workspace_id - Workspace ID to filter examples
 * @param {number} limit - Maximum number of examples to fetch
 * @returns {Promise<Array>} Array of approved feedback examples
 */
async function getApprovedExamples(workspace_id, limit = 5) {
  try {
    const feedbackCollection = getAIFeedbackCollection();
    const examples = await feedbackCollection
      .find({
        workspace_id: workspace_id,
        action: { $in: ['approved', 'edited_approved'] }
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    return examples;
  } catch (error) {
    console.error('Error fetching approved examples:', error.message);
    return [];
  }
}

/**
 * Fetches rejected feedback examples for few-shot learning
 * @param {string} workspace_id - Workspace ID to filter examples
 * @param {number} limit - Maximum number of examples to fetch
 * @returns {Promise<Array>} Array of rejected feedback examples
 */
async function getRejectedExamples(workspace_id, limit = 5) {
  try {
    const feedbackCollection = getAIFeedbackCollection();
    const examples = await feedbackCollection
      .find({
        workspace_id: workspace_id,
        action: 'rejected'
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    return examples;
  } catch (error) {
    console.error('Error fetching rejected examples:', error.message);
    return [];
  }
}

/**
 * Builds the prompt for Claude API to extract decisions from transcript
 * @param {string} transcriptText - The meeting transcript text
 * @param {Array} approvedExamples - Recent approved decision examples from this workspace
 * @param {Array} rejectedExamples - Recent rejected decision examples from this workspace
 * @returns {string} The formatted prompt
 */
function buildDecisionExtractionPrompt(transcriptText, approvedExamples = [], rejectedExamples = []) {
  let examplesSection = '';

  // Add few-shot learning examples if available
  if (approvedExamples.length > 0 || rejectedExamples.length > 0) {
    examplesSection = '\n\nLEARNING FROM YOUR PAST FEEDBACK:\n\n';

    if (approvedExamples.length > 0) {
      examplesSection += '✅ CORRECTLY IDENTIFIED DECISIONS FROM YOUR MEETINGS:\n';
      approvedExamples.forEach((ex, idx) => {
        const decision = ex.final_version || ex.original_suggestion;
        examplesSection += `${idx + 1}. "${decision.decision_text}" (${decision.decision_type})\n`;
        if (ex.transcript_context) {
          examplesSection += `   Context: "${ex.transcript_context.substring(0, 150)}..."\n`;
        }
      });
      examplesSection += '\n';
    }

    if (rejectedExamples.length > 0) {
      examplesSection += '❌ INCORRECTLY IDENTIFIED (NOT DECISIONS) FROM YOUR MEETINGS:\n';
      rejectedExamples.forEach((ex, idx) => {
        examplesSection += `${idx + 1}. "${ex.original_suggestion.decision_text}"`;
        if (ex.rejection_reason) {
          examplesSection += ` - Reason: ${ex.rejection_reason}`;
        }
        examplesSection += '\n';
      });
      examplesSection += '\n';
    }

    examplesSection += 'Use these examples to better understand what this workspace considers a decision vs just discussion.\n\n';
  }

  return `${examplesSection}Analyze the following meeting transcript and extract all decisions as a JSON array:

---
${transcriptText}
---`;
}

/**
 * System message for Claude API (cached for efficiency)
 * This stays the same across requests, so Claude caches it
 */
const DECISION_EXTRACTION_SYSTEM_MESSAGE = [
  {
    type: 'text',
    text: `You are an expert at analyzing meeting transcripts and extracting important information for team memory.

WHAT TO EXTRACT (3 TYPES):

1. **DECISIONS** - When someone explicitly chose, agreed, or committed to something specific
   Look for: "We decided to...", "We have agreed...", "Let's go with...", "We'll use...", "Agreed, we will...", "The decision is to..."
   ✅ Extract when you see: conclusions, commitments, agreements, chosen directions
   ✅ Examples: "We'll use React for the frontend", "We have agreed that meetings are not only about decisions", "We decided not to implement bidirectional sync"

2. **EXPLANATIONS** - When someone explains how something works, technical details, or system behavior
   Look for: "This works by...", "The way it functions is...", "Technically speaking...", "Here's how...", "...by using...", "...through..."
   ✅ Extract when you see: technical mechanisms, how things operate, process descriptions
   ✅ Examples: "React works by using a virtual DOM that updates efficiently", "The AEM API works by sending a webhook to our endpoint", "Authentication happens through OAuth2 flow"

3. **CONTEXT** - Important background information, clarifications, constraints, or relevant details
   Look for: "To clarify...", "Background: ...", "The reason is...", "Keep in mind...", "...was approved...", "...has been...", "We started..."
   ✅ Extract when you see: background info, timelines, approvals, constraints, history, relevant facts
   ✅ Examples: "The budget was approved for Q2", "We can't do bidirectional sync because AEM doesn't support webhooks", "We started this App 3 weeks ago"

BE COMPREHENSIVE - Extract ALL relevant items, not just the most obvious ones.

DO NOT EXTRACT:
  ❌ Vague discussions ("We should probably think about...")
  ❌ Questions without answers ("What if we used GraphQL?")
  ❌ Speculation without commitment ("Maybe we could try...")

FOR EACH ITEM, EXTRACT:
1. **decision_text**: A clear, concise statement (1-2 sentences max)
2. **decision_type**: Classify as "decision", "explanation", or "context"
3. **epic_key**: If a Jira key is mentioned nearby (format: ABC-123 or ABC-1234), extract it. Otherwise null.
4. **tags**: Extract 2-5 relevant tags/keywords (lowercase, single words or short phrases)
5. **confidence**: Your confidence (0.0 to 1.0, where 0.9+ is very confident, 0.6-0.8 is moderate, below 0.6 is uncertain)
6. **context**: The exact surrounding text from the transcript (up to 200 chars before and after)

OUTPUT FORMAT:
Return ONLY a valid JSON array. Do not include any explanatory text before or after the JSON.

Example format:
\`\`\`json
[
  {
    "decision_text": "We will use Claude API for AI-powered extraction",
    "decision_type": "decision",
    "epic_key": "LOK-456",
    "tags": ["ai", "claude", "automation"],
    "confidence": 0.95,
    "context": "After discussing options, we decided that we will use Claude API..."
  },
  {
    "decision_text": "The Claude API works by sending the transcript as a prompt and parsing the JSON response",
    "decision_type": "explanation",
    "epic_key": null,
    "tags": ["claude", "api", "technical"],
    "confidence": 0.9,
    "context": "John explained: The Claude API works by sending the transcript as a prompt..."
  },
  {
    "decision_text": "Budget has been approved for Q2 implementation",
    "decision_type": "context",
    "epic_key": null,
    "tags": ["budget", "q2", "timeline"],
    "confidence": 0.85,
    "context": "Sarah mentioned that budget has been approved for Q2 implementation..."
  }
]
\`\`\`

If nothing relevant is found, return an empty array: []

IMPORTANT GUIDELINES:
- Extract all 3 types: decisions, explanations, and context
- Be conservative with confidence scores - only use 0.9+ when absolutely certain
- Tags should be relevant keywords from the context
- Context should help the reader understand the item`,
    cache_control: { type: 'ephemeral' }
  }
];

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
      system: DECISION_EXTRACTION_SYSTEM_MESSAGE,
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
      // Retry once with same configuration (system message will be cached)
      const retryResponse = await anthropic.messages.create({
        model: config.claude.model,
        max_tokens: config.claude.maxTokens,
        temperature: 0.2,
        system: DECISION_EXTRACTION_SYSTEM_MESSAGE,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      return retryResponse;
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
 * Extracts decisions from meeting transcript using Claude API with few-shot learning
 * @param {string} transcriptText - The meeting transcript content
 * @param {string} workspace_id - Workspace ID for fetching relevant feedback examples
 * @returns {Promise<Object>} { decisions: Array, processingTime: number, model: string, usedExamples: boolean }
 */
async function extractDecisionsFromTranscript(transcriptText, workspace_id) {
  const startTime = Date.now();

  // Sanitize the transcript text
  const sanitized = sanitizeTranscriptText(transcriptText);

  // Fetch recent feedback examples from this workspace (few-shot learning)
  let approvedExamples = [];
  let rejectedExamples = [];
  if (workspace_id) {
    try {
      [approvedExamples, rejectedExamples] = await Promise.all([
        getApprovedExamples(workspace_id, 5),
        getRejectedExamples(workspace_id, 5)
      ]);

      if (approvedExamples.length > 0 || rejectedExamples.length > 0) {
        console.log(`🎯 Using ${approvedExamples.length} approved + ${rejectedExamples.length} rejected examples for few-shot learning`);
      }
    } catch (error) {
      console.warn('⚠️  Could not fetch feedback examples, proceeding without few-shot learning:', error.message);
    }
  }

  // Build the prompt with examples
  const prompt = buildDecisionExtractionPrompt(sanitized, approvedExamples, rejectedExamples);

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
    model: response.model,
    usedExamples: approvedExamples.length > 0 || rejectedExamples.length > 0
  };
}

module.exports = {
  extractDecisionsFromTranscript,
  isClaudeConfigured,
  buildDecisionExtractionPrompt,
  callClaudeAPI,
  parseDecisionResponse
};
