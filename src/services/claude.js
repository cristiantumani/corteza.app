const { Anthropic } = require('@anthropic-ai/sdk');
const config = require('../config/environment');
const { trackAiGeneration } = require('../integrations/posthog/client');
const { recordAiUsage } = require('../core/usage/ai-usage');
const { validateAISuggestion, sanitizeTranscriptText } = require('../middleware/ai-validation');
const { getAIFeedbackCollection } = require('../config/database');
const { LANGUAGE_CODES, detectLanguage, spokenText, languageName } = require('../core/language/detect');

/**
 * Checks if Claude API is configured
 * @returns {boolean}
 */
function isClaudeConfigured() {
  return config.claude.isConfigured;
}

/**
 * Fetches approved feedback examples for few-shot learning
 *
 * CREDIT OPTIMIZATION: Reduced default limit from 5 to 3
 * - Fewer examples = fewer input tokens per request
 * - 3 examples provide sufficient learning signal
 * - Saves ~200-400 tokens per request with examples
 *
 * @param {string} workspace_id - Workspace ID to filter examples
 * @param {number} limit - Maximum number of examples to fetch (default: 3)
 * @param {string|null} [userId] - only this person's feedback
 * @returns {Promise<Array>} Array of approved feedback examples
 */
async function getApprovedExamples(workspace_id, limit = 3, userId = null) {
  try {
    const feedbackCollection = getAIFeedbackCollection();
    const examples = await feedbackCollection
      .find({
        workspace_id: workspace_id,
        ...(userId ? { user_id: userId } : {}),
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
 *
 * CREDIT OPTIMIZATION: Reduced default limit from 5 to 2
 * - Negative examples are less critical than positive ones
 * - 2 examples sufficient to show what NOT to extract
 * - Saves ~150-300 tokens per request with examples
 *
 * @param {string} workspace_id - Workspace ID to filter examples
 * @param {number} limit - Maximum number of examples to fetch (default: 2)
 * @param {string|null} [userId] - only this person's feedback
 * @returns {Promise<Array>} Array of rejected feedback examples
 */
async function getRejectedExamples(workspace_id, limit = 2, userId = null) {
  try {
    const feedbackCollection = getAIFeedbackCollection();
    const examples = await feedbackCollection
      .find({
        workspace_id: workspace_id,
        ...(userId ? { user_id: userId } : {}),
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
 *
 * CREDIT OPTIMIZATION: Shortened few-shot example format
 * - Removed verbose headers and formatting
 * - Truncated context to 100 chars (was 150)
 * - Removed redundant instruction text
 * - Saves ~100-200 tokens when examples are present
 *
 * @param {string} transcriptText - The meeting transcript text
 * @param {Array} approvedExamples - Recent approved decision examples from this workspace
 * @param {Array} rejectedExamples - Recent rejected decision examples from this workspace
 * @param {string|null} [language] - output language code
 * @param {string} [contextBlock] - company and personal context (core/context formatContextBlock)
 * @returns {string} The formatted prompt
 */
function buildDecisionExtractionPrompt(transcriptText, approvedExamples = [], rejectedExamples = [], language = null, contextBlock = '') {
  let examplesSection = '';

  // Add few-shot learning examples if available (compact format to save tokens)
  if (approvedExamples.length > 0 || rejectedExamples.length > 0) {
    examplesSection = '\nPAST FEEDBACK:\n';

    if (approvedExamples.length > 0) {
      examplesSection += 'GOOD:';
      approvedExamples.forEach((ex) => {
        const d = ex.final_version || ex.original_suggestion;
        examplesSection += `\n- "${d.decision_text}" [${d.decision_type}]`;
      });
      examplesSection += '\n';
    }

    if (rejectedExamples.length > 0) {
      examplesSection += 'BAD:';
      rejectedExamples.forEach((ex) => {
        examplesSection += `\n- "${ex.original_suggestion.decision_text}"${ex.rejection_reason ? ` (${ex.rejection_reason})` : ''}`;
      });
      examplesSection += '\n';
    }
  }

  // CREDIT OPTIMIZATION: Removed redundant "Analyze..." instruction (already in system message)
  const languageLine = languageName(language) ? `OUTPUT LANGUAGE: ${languageName(language)}\n` : '';
  const contextSection = contextBlock ? `CONTEXT (background about the company and the person whose meeting this is; not part of the meeting):\n${contextBlock}\n\n` : '';
  return `${contextSection}${examplesSection}
${languageLine}TRANSCRIPT:
${transcriptText}`;
}

/**
 * Language to save outcomes in: the one chosen in settings, else the one spoken in the meeting
 * @param {string} text - extraction text
 * @param {string|null} [preferred] - 'es' | 'en' | 'pt' | 'auto' | null
 * @returns {string|null} language code, or null to let Claude follow the meeting
 */
function outputLanguage(text, preferred) {
  if (LANGUAGE_CODES.includes(preferred)) return preferred;
  return detectLanguage(spokenText(text));
}

/**
 * System message for extraction (v2). Cached by the API across requests.
 *
 * Output: a JSON array of items. Types:
 * - decision: a choice the group committed to
 * - action_item: a person committed to do something (owner / due date when stated)
 * - open_question: raised and left unresolved, needs a decision later
 * - risk: a concern or blocker that could change the outcome
 * Each item carries evidence (a verbatim quote) so people can trust auto-saved data.
 * Legacy fields (decision_text, decision_type, context) keep older callers working.
 */
const DECISION_EXTRACTION_SYSTEM_MESSAGE = [
  {
    type: 'text',
    text: `You extract the outcomes of a meeting from its transcript and/or meeting notes so a team can track them afterwards. People will see every item you return without reviewing it first, so only return items that are clearly supported by what was said.

Item types:
- decision: a choice the participants committed to ("we'll launch on the 15th", "we're dropping plan B"). Not proposals that were still being debated, and not status updates.
- action_item: a specific person or team committed to do something ("Ana will send the pricing deck by Friday"). Use the name as spoken for the owner.
- open_question: a question that was raised, matters for the work, and was explicitly left unresolved.
- risk: a concern, dependency or blocker raised that could affect a decision or deadline.

Only business outcomes. The log is for decisions and commitments about the work itself: strategy, customers, sales, product, pricing, finances and budgets, metrics, hiring, compensation and team, operations, legal, partners and deliverables. Ask: would a manager who missed this meeting want this in the team's decision log a month from now? If not, leave it out. Leave out:
- Meeting logistics: scheduling, rescheduling, moving, shortening or ending this or another meeting, who joins, agendas, sharing the screen or the deck ("se decide reprogramar la reunión para las 15:45", "nos juntamos el jueves para seguir"). A follow-up meeting is only worth an action item when it is a working session with a stated business purpose AND a deadline matters, and even then describe the work, not the calendar invite.
- Problems with the meeting itself or someone's equipment: audio, connection, a computer restarting, a tool not loading, moving files to a new laptop, installing software ("fallas técnicas interrumpieron el análisis", "José traspasa la base de datos al nuevo computador"). These are never risks or action items unless the equipment is itself a business project (for example migrating the company's CRM).
- Personal errands, small talk, jokes, greetings, and anything said about the meeting's own flow ("seguimos después", "vamos rápido").
- Background explanations, how-things-work descriptions, status updates with no commitment, and hypotheticals.
A risk is a threat to a business result (revenue, customers, a launch, a deadline for a deliverable, compliance, the team), not to the meeting. When the same outcome is mentioned several times, return it once with the clearest wording. Prefer a few meaningful items over many small ones; [] is a valid answer for a meeting with no business outcomes. Meeting notes may already list "next steps"; treat them as evidence, but still apply these rules.

Fields for each item:
- decision_type: "decision" | "action_item" | "open_question" | "risk"
- decision_text: one or two sentences that make sense on their own to someone who missed the meeting, in the output language (see "Language" below). State the outcome itself, the way it would read in a decision log, not a narration of the conversation. Write "Se decide comenzar una investigación técnica sobre cómo implementar una experiencia interactiva con IA y Excel", not "Se propuso iniciar una investigación…" or "Cristian propuso…"; write "Launch moves to October 22", not "The team discussed moving the launch". Who proposed or said what belongs in evidence_quote. For action items, name the owner and the task ("Ana envía el deck de precios antes del viernes"). If something was only proposed and not agreed, it is not a decision.
- owner_names: the people responsible, as named in the meeting (for example ["Martín Marchant", "Felipe Silva"]); [] if nobody was named
- raised_by: for an open_question or a risk, the person who raised it, as named in the meeting; null if it isn't clear who did, and null for other types
- due_date: "YYYY-MM-DD" if a deadline was stated; resolve relative dates ("next Friday") from the meeting date given in the header; otherwise null
- rationale: why this was decided or needed, in one or two sentences. Include context from anywhere in the meeting that led to it, such as a strategy, goal, problem or constraint presented earlier ("A raíz de la nueva estrategia presentada…"), even if it was not said in the same sentence. null if the meeting gives no reason.
- evidence_quote: a short verbatim quote (under 200 characters) from the transcript or notes that supports the item
- supersedes_hint: if the speakers say this changes or reverses an earlier decision, a short description of what it replaces, otherwise null
- decision_ref: for an action_item that carries out a decision in your list, the 0-based position of that decision in the array you return; otherwise null. When a decision needs work to happen ("se decide comenzar una investigación técnica, a cargo de Martín y Felipe"), return the decision and an action_item for the work, linked with decision_ref.
- topic: a short label (2 to 6 words, in the output language) for the subject the item is about. Items about the same subject get exactly the same topic, so a team can follow it as one thread: for example an open question "¿Conviene certificarnos en ISO 27001?", the risk "Sin la certificación podemos perder clientes enterprise" and the action item "Cristian investiga los requisitos de ISO 27001" all get the topic "Certificación ISO 27001". Use a different topic for each distinct subject.
- epic_key: a Jira-style key like "ABC-123" if one was mentioned, otherwise null
- tags: 2-5 lowercase keywords
- confidence: 0.0-1.0; use 0.9 or above only when the commitment is explicit
- business_relevance: "high" (strategy, money, customers, people, a deliverable), "medium" (useful team context or a smaller work commitment) or "low" (logistics, meeting or equipment issues, housekeeping). Items you would label "low" should normally not be returned at all; if you return one anyway, label it "low" and it will be discarded.

Context: a CONTEXT section may come before the transcript, with what the company does, a glossary (names, acronyms, customers, products), reference documents, and the role and focus of the person whose meeting this is. Use it to judge what matters to this business, to spell names and terms correctly (transcripts often mangle acronyms and names), and to recognize who owners are. Never return items taken from the context itself; every item must come from the meeting.

Language: write decision_text, rationale and tags in the OUTPUT LANGUAGE given before the transcript. If none is given, use the language the participants spoke. Meeting notes (for example Gemini notes) may be in another language than the conversation; still write in the output language. Keep evidence_quote verbatim, in its original language.

Respond with only a JSON array of items, with no other text. Respond with [] if there are no outcomes.`,
    cache_control: { type: 'ephemeral' }
  }
];

/** Models before these no longer accept sampling parameters (temperature) */
const SAMPLING_MODELS = /^claude-(3|[a-z]+-4-[0-6](\b|-))/;
/** Models that support server-side refusal fallbacks */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5)/;

/** Anthropic client for extraction calls (the SDK retries 429/5xx itself) */
function createClient() {
  if (!isClaudeConfigured()) {
    throw new Error('Claude API not configured. Set ANTHROPIC_API_KEY in environment.');
  }
  return new Anthropic({ apiKey: config.claude.apiKey, timeout: 5 * 60 * 1000, maxRetries: 2 });
}

/**
 * The Messages API request for one extraction (the same one live and in a batch)
 * @param {string} prompt - from buildDecisionExtractionPrompt
 * @returns {any} params for messages.create (untyped: newer fields than this SDK's types)
 */
function buildExtractionParams(prompt) {
  const model = config.claude.model;
  /** @type {any} */
  const request = {
    model,
    max_tokens: config.claude.maxTokens,
    system: DECISION_EXTRACTION_SYSTEM_MESSAGE,
    messages: [{ role: 'user', content: prompt }]
  };
  if (SAMPLING_MODELS.test(model)) request.temperature = 0.2;
  return request;
}

/**
 * Throws on a refusal and warns when the item list was cut off
 * @param {any} response - Message
 */
function checkResponse(response) {
  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined to process this transcript${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`);
  }
  if (response.stop_reason === 'max_tokens') {
    console.warn('⚠️  Claude response hit max_tokens; the item list may be incomplete. Raise CLAUDE_MAX_TOKENS.');
  }
}

/**
 * Calls Claude for extraction. Streams (long transcripts can take a while) and
 * returns the final message.
 * @param {string} prompt - The prompt to send
 * @returns {Promise<Object>} Claude API response (Message)
 */
async function callClaudeAPI(prompt) {
  const anthropic = createClient();
  const request = buildExtractionParams(prompt);
  const model = request.model;

  console.log(`🤖 Calling Claude API (${model})...`);
  try {
    /** @type {any} */
    let response;
    if (FALLBACK_MODELS.test(model)) {
      try {
        // On a safety decline, the API re-runs the request on a fallback model
        response = await anthropic.beta.messages.stream({
          ...request,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default'
        }).finalMessage();
      } catch (error) {
        if (!(error instanceof Anthropic.BadRequestError)) throw error;
        console.warn('⚠️  Claude request with fallbacks was rejected, retrying without:', error.message);
        response = await anthropic.messages.stream(request).finalMessage();
      }
    } else {
      response = await anthropic.messages.stream(request).finalMessage();
    }

    checkResponse(response);
    console.log('✅ Claude API response received');
    return response;
  } catch (error) {
    console.error('❌ Claude API error:', error.message);
    throw error;
  }
}

/** Text of a Claude response (skips thinking and other non-text blocks) */
function responseText(response) {
  return (response.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
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
      } else {
        // A response cut off at max_tokens opens a code block but never closes it
        jsonString = claudeResponse.replace(/^\s*```(?:json)?\s*\n/, '');
      }
    }

    // Parse JSON (Claude sometimes adds an explanation after the array)
    const decisions = parseLeadingJsonArray(jsonString.trim());

    // Validate structure
    if (!Array.isArray(decisions)) {
      console.error('❌ Claude response is not an array');
      return [];
    }

    // Validate and filter each decision
    const validDecisions = keepItems(decisions.map(normalizeItem), d => {
      const isValid = validateAISuggestion(d);
      if (!isValid) {
        console.log(`⚠️  Skipping invalid suggestion (${d && d.type})`);
        return false;
      }
      if (d.business_relevance === 'low') {
        console.log(`🧹 Skipping low-relevance item (${d.type})`);
        return false;
      }
      return true;
    });

    console.log(`✅ Parsed ${validDecisions.length} valid decisions from Claude response`);
    return validDecisions;
  } catch (error) {
    console.error('❌ Failed to parse Claude response:', error.message);
    console.error(`   Response was ${claudeResponse.length} chars`);
    return [];
  }
}

/**
 * Keeps the items that pass `keep`, fixing each action item's decision_ref (a position
 * in the list) so it still points at the same decision; a link to a dropped item is removed
 * @param {Object[]} items - normalized items, in Claude's order
 * @param {Function} keep - (item) => boolean
 * @returns {Object[]}
 */
function keepItems(items, keep) {
  const newIndex = new Map();
  const kept = [];
  items.forEach((item, index) => {
    if (!keep(item)) return;
    newIndex.set(index, kept.length);
    kept.push(item);
  });
  return kept.map(item => (item && Number.isInteger(item.decision_ref)
    ? { ...item, decision_ref: newIndex.has(item.decision_ref) ? newIndex.get(item.decision_ref) : null }
    : item));
}

/** Trims an optional string field to a max length, or null */
function optionalText(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Normalizes one extracted item (v2 fields, plus legacy fields older callers read)
 * @param {Object} item
 * @returns {Object}
 */
function normalizeItem(item) {
  if (!item || typeof item !== 'object') return item;
  const evidence = optionalText(item.evidence_quote, 300);
  const ownerNames = (Array.isArray(item.owner_names) ? item.owner_names : [item.owner_name])
    .map(name => optionalText(name, 100))
    .filter(Boolean)
    .slice(0, 10);
  return {
    ...item,
    owner_names: ownerNames,
    owner_name: ownerNames[0] || null,
    raised_by: ['open_question', 'risk'].includes(item.decision_type) ? optionalText(item.raised_by, 100) : null,
    decision_ref: Number.isInteger(item.decision_ref) && item.decision_ref >= 0 ? item.decision_ref : null,
    business_relevance: ['high', 'medium', 'low'].includes(item.business_relevance) ? item.business_relevance : null,
    due_date: typeof item.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date) ? item.due_date : null,
    rationale: optionalText(item.rationale, 500),
    evidence_quote: evidence,
    supersedes_hint: optionalText(item.supersedes_hint, 300),
    topic: optionalText(item.topic, 80),
    context: item.context || evidence || ''
  };
}

/**
 * Parses JSON text, or the first complete JSON array in it when Claude added
 * prose before or after (e.g. "[]\n\nThe transcript appears to be...").
 * When the array was cut off (the response hit max_tokens), returns the items
 * that were complete, so a long meeting doesn't lose all of its outcomes.
 * @param {string} text
 * @returns {*} parsed value
 */
function parseLeadingJsonArray(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf('[');
    if (start === -1) throw error;
    let depth = 0;
    let inString = false;
    let lastItemEnd = -1;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (char === '\\') i++;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === '[' || char === '{') {
        depth++;
      } else if (char === ']' || char === '}') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
        if (depth === 1 && char === '}') lastItemEnd = i;
      }
    }
    if (depth > 0 && lastItemEnd !== -1) {
      const items = JSON.parse(`${text.slice(start, lastItemEnd + 1)}]`);
      console.warn(`⚠️  Claude response was cut off; kept the ${items.length} complete item(s)`);
      return items;
    }
    throw error;
  }
}

/**
 * Everything an extraction sends to Claude, before calling it: the prompt (with the person's
 * review examples and AI context) and the output language
 * @param {string} transcriptText - The meeting transcript content
 * @param {string} workspace_id - Workspace ID for fetching relevant feedback examples
 * @param {Object} [options]
 * @param {string} [options.language] - 'es' | 'en' | 'pt' to force the language outcomes are written in;
 *   otherwise the language spoken in the meeting (detected from the transcript, not the notes)
 * @param {string|null} [options.userId] - whose context and review examples to use
 * @param {string|null} [options.personName] - that person's name, for their personal context
 * @param {string} [options.context] - a ready context block (the eval), instead of loading it
 * @returns {Promise<{ prompt: string, language: string|null, usedExamples: boolean }>}
 */
async function prepareExtraction(transcriptText, workspace_id, options = {}) {
  // Sanitize the transcript text
  const sanitized = sanitizeTranscriptText(transcriptText);

  // Fetch recent feedback examples from this workspace (few-shot learning)
  let approvedExamples = [];
  let rejectedExamples = [];
  if (workspace_id) {
    try {
      [approvedExamples, rejectedExamples] = await Promise.all([
        // A person's own reviews (Confirm / Dismiss on their outcomes): colleagues' outcomes never reach their prompt
        getApprovedExamples(workspace_id, 5, options.userId || null),
        getRejectedExamples(workspace_id, 5, options.userId || null)
      ]);

      if (approvedExamples.length > 0 || rejectedExamples.length > 0) {
        console.log(`🎯 Using ${approvedExamples.length} approved + ${rejectedExamples.length} rejected examples for few-shot learning`);
      }
    } catch (error) {
      console.warn('⚠️  Could not fetch feedback examples, proceeding without few-shot learning:', error.message);
    }
  }

  // Company and personal context (Settings → Context for the AI); a caller can pass it ready-made (eval)
  let contextBlock = typeof options.context === 'string' ? options.context : '';
  if (!contextBlock && workspace_id) {
    try {
      const { buildContextBlock } = require('../core/context/context-service');
      contextBlock = await buildContextBlock(workspace_id, options.userId || null, options.personName || null);
    } catch (error) {
      console.warn('⚠️  Could not load the AI context, proceeding without it:', error.message);
    }
  }
  if (contextBlock) console.log(`🧭 Using ${contextBlock.length} characters of company/personal context`);

  // Build the prompt with examples
  const language = outputLanguage(sanitized, options.language);
  if (language) console.log(`🌐 Outcomes will be written in ${languageName(language)}`);
  const prompt = buildDecisionExtractionPrompt(sanitized, approvedExamples, rejectedExamples, language, contextBlock);
  return { prompt, language, usedExamples: approvedExamples.length > 0 || rejectedExamples.length > 0 };
}

/**
 * Turns Claude's reply into extracted items, and records the call (analytics, AI usage)
 * @param {any} response - Message, from a live call or a batch result
 * @param {Object} meta
 * @param {string|null} meta.workspaceId
 * @param {string|null} [meta.userId]
 * @param {string|null} [meta.language]
 * @param {boolean} [meta.usedExamples]
 * @param {number} [meta.latencyMs]
 * @param {boolean} [meta.batch] - came from the Message Batches API (half price)
 * @returns {Promise<{ decisions: Object[], language: string|null, model: string, usedExamples: boolean }>}
 */
async function finishExtraction(response, { workspaceId, userId = null, language = null, usedExamples = false, latencyMs = 0, batch = false }) {
  checkResponse(response);
  const decisions = parseDecisionResponse(responseText(response));
  trackAiGeneration({
    feature: 'extraction',
    response,
    latencyMs,
    distinctId: userId || null,
    properties: { item_count: decisions.length, truncated: response.stop_reason === 'max_tokens', workspace_id: workspaceId || null, batch }
  });
  await recordAiUsage({ workspaceId: workspaceId || null, userId: userId || null, feature: batch ? 'extraction_batch' : 'extraction', response });
  return { decisions, language, model: response.model, usedExamples };
}

/**
 * Extracts outcomes from a transcript with one live Claude call (imports can use
 * ingestion/batch-extraction.js instead, at half the price)
 * @param {string} transcriptText - The meeting transcript content
 * @param {string} workspace_id - Workspace ID for fetching relevant feedback examples
 * @param {Object} [options] - see prepareExtraction
 * @returns {Promise<Object>} { decisions: Array, processingTime: number, model: string, usedExamples: boolean, language }
 */
async function extractDecisionsFromTranscript(transcriptText, workspace_id, options = {}) {
  const startTime = Date.now();
  const { prompt, language, usedExamples } = await prepareExtraction(transcriptText, workspace_id, options);

  const callStart = Date.now();
  const response = await callClaudeAPI(prompt);
  const result = await finishExtraction(response, {
    workspaceId: workspace_id || null, userId: options.userId || null, language, usedExamples, latencyMs: Date.now() - callStart
  });

  const processingTime = Date.now() - startTime;
  console.log(`⏱️  Processing took ${processingTime}ms`);
  return { ...result, processingTime };
}

module.exports = {
  extractDecisionsFromTranscript,
  prepareExtraction,
  finishExtraction,
  buildExtractionParams,
  createClient,
  getApprovedExamples,
  getRejectedExamples,
  isClaudeConfigured,
  buildDecisionExtractionPrompt,
  outputLanguage,
  callClaudeAPI,
  parseDecisionResponse,
  parseLeadingJsonArray,
  normalizeItem,
  keepItems,
  responseText,
  SAMPLING_MODELS
};
