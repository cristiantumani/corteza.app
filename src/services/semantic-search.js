const crypto = require('crypto');
const { getDecisionsCollection, getDatabase } = require('../config/database');
const { generateQueryEmbedding, isEmbeddingsEnabled } = require('./embeddings');
const Anthropic = require('@anthropic-ai/sdk');
const { Anthropic: PostHogAnthropic } = require('@posthog/ai/anthropic');
const config = require('../config/environment');
const { posthog } = require('./posthog');
const { extractKeywords, matchedKeywords, requiredMatches, accentInsensitivePattern } = require('../core/search/relevance');
const { SAMPLING_MODELS } = require('./claude');

// Fields a search result carries (never `embedding`): enough to show the full source in Search
const RESULT_PROJECTION = {
  _id: 0, id: 1, text: 1, type: 1, category: 1, epic_key: 1, jira_data: 1, tags: 1, alternatives: 1,
  rationale: 1, owner_name: 1, owner_user_id: 1, due_date: 1, evidence_quote: 1, source_details: 1,
  capture: 1, confidence: 1, creator: 1, user_id: 1, channel_id: 1, timestamp: 1, workspace_id: 1,
  space_id: 1, space_name: 1
};

/**
 * Detect if query has temporal context (looking for recent/latest decisions)
 */
function hasTemporalContext(query) {
  const temporalKeywords = [
    'latest', 'recent', 'newest', 'last', 'current',
    'today', 'yesterday', 'this week', 'this month',
    'new', 'just', 'recently made'
  ];
  const lowerQuery = query.toLowerCase();
  return temporalKeywords.some(keyword => lowerQuery.includes(keyword));
}

/**
 * Apply keyword boost to scores when query terms appear in decision text
 * Boosts score when exact keyword matches found
 * Returns object with boosted results AND hasKeywordMatch flag for filtering
 */
function applyKeywordBoost(results, query) {
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    console.log('   ⚠️  No meaningful keywords extracted, skipping keyword boost');
    return results.map(r => ({ ...r, keywordMatches: 0, keywordBoost: 0 }));
  }

  console.log(`   🔑 Extracted keywords for boosting: [${keywords.join(', ')}]`);

  return results.map(result => {
    const matches = matchedKeywords(result, keywords);
    if (matches.length === 0) {
      return { ...result, keywordMatches: 0, keywordBoost: 0, hasKeywordMatch: false };
    }
    // Each matched keyword adds 0.05, max 0.15
    const keywordBoost = Math.min(0.15, matches.length * 0.05);
    return {
      ...result,
      score: Math.min(1.0, result.score + keywordBoost),
      keywordBoost,
      keywordMatches: matches.length,
      hasKeywordMatch: matches.length >= requiredMatches(keywords.length)
    };
  });
}

/**
 * Filter out false positives - results that don't contain query keywords
 * AND have low semantic scores (likely irrelevant despite vector similarity)
 */
function filterFalsePositives(results, query) {
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    // No keywords to filter by, keep all results
    return results;
  }

  const filtered = results.filter(result => {
    // Keep if:
    // 1. High score (>= 0.80) - trust the vector search
    if (result.score >= 0.80) return true;

    // 2. Has keyword match (regardless of score)
    if (result.hasKeywordMatch) return true;

    // 3. Otherwise, it's a false positive - filter it out
    console.log(`   🚫 Filtering out Decision #${result.id} (score: ${(result.score * 100).toFixed(1)}%, no keyword match)`);
    return false;
  });

  const filteredCount = results.length - filtered.length;
  if (filteredCount > 0) {
    console.log(`   ✂️  Filtered out ${filteredCount} false positives (no keyword match + score < 80%)`);
  }

  return filtered;
}

/**
 * Apply recency boost to scores based on how recent the decision is
 * Recent decisions get higher boost (max 0.15 for decisions < 7 days old)
 */
function applyRecencyBoost(results, applyBoost = false) {
  if (!applyBoost) return results;

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;
  const ONE_MONTH = 30 * ONE_DAY;

  return results.map(result => {
    const age = now - new Date(result.timestamp).getTime();
    let recencyBoost = 0;

    if (age < ONE_WEEK) {
      // Very recent: boost by 0.15 (15%)
      recencyBoost = 0.15;
    } else if (age < ONE_MONTH) {
      // Recent: boost by 0.10 (10%)
      recencyBoost = 0.10;
    } else if (age < 3 * ONE_MONTH) {
      // Somewhat recent: boost by 0.05 (5%)
      recencyBoost = 0.05;
    }

    const originalScore = result.score;
    const boostedScore = Math.min(1.0, result.score + recencyBoost);

    console.log(`   📅 Decision #${result.id}: ${originalScore.toFixed(3)} → ${boostedScore.toFixed(3)} (+${recencyBoost.toFixed(2)} recency boost, ${Math.floor(age / ONE_DAY)} days old)`);

    return {
      ...result,
      score: boostedScore,
      originalScore,
      recencyBoost
    };
  });
}

/**
 * Perform semantic search on decisions using vector similarity
 *
 * @param {string} query - Natural language search query
 * @param {Object} options - Search options
 * @param {string} options.workspace_id - Required workspace ID for multi-tenancy
 * @param {string} options.type - Optional type filter (decision/explanation/context)
 * @param {string} options.category - Optional category filter (product/ux/technical)
 * @param {Date} options.dateFrom - Optional start date filter
 * @param {Date} options.dateTo - Optional end date filter
 * @param {number} options.limit - Max results to return (default 10)
 * @param {number} options.minScore - Minimum similarity score 0-1 (default 0.7)
 * @returns {Promise<Array>} - Array of decisions with similarity scores
 */
async function semanticSearch(query, options = {}) {
  if (!isEmbeddingsEnabled()) {
    throw new Error('Semantic search not enabled. Set OPENAI_API_KEY.');
  }

  const {
    workspace_id,
    space_id,
    type,
    category,
    dateFrom,
    dateTo,
    limit = 10,
    minScore = 0.7,
    excludeIds = [],
    aiContext
  } = options;

  if (!workspace_id) {
    throw new Error('workspace_id is required for semantic search');
  }

  if (!space_id) {
    throw new Error('space_id is required for semantic search');
  }

  try {
    // Generate embedding for the search query
    console.log(`🔍 Semantic search: "${query}"`);
    console.log(`   🏢 Workspace ID: ${workspace_id}`);
    console.log(`   📁 Space ID: ${space_id}`);

    const decisionsCollection = getDatabase().collection('decisions');

    const queryEmbedding = await generateQueryEmbedding(query, aiContext);

    // Detect if query is looking for recent decisions
    const queryHasTemporalContext = hasTemporalContext(query);
    if (queryHasTemporalContext) {
      console.log(`   ⏰ Temporal context detected - will boost recent decisions`);
    }

    // Build filter for pre-filtering before vector search
    const preFilter = {
      workspace_id,
      space_id  // SECURITY FIX: Filter search by space
    };

    if (type) {
      preFilter.type = type;
    }

    if (category) {
      preFilter.category = category;
    }

    if (dateFrom || dateTo) {
      preFilter.timestamp = {};
      if (dateFrom) {
        preFilter.timestamp.$gte = dateFrom.toISOString();
      }
      if (dateTo) {
        preFilter.timestamp.$lte = dateTo.toISOString();
      }
    }

    // MongoDB Atlas Vector Search aggregation pipeline
    const pipeline = [
      {
        $vectorSearch: {
          index: 'vector_search_index',  // Must match the index name in Atlas
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: Math.max(limit * 10, 100), // Over-fetch for better results
          limit: (limit + excludeIds.length) * 2,  // Get more results before score filtering
          filter: preFilter
        }
      },
      {
        $addFields: {
          score: { $meta: 'vectorSearchScore' }
        }
      },
      {
        $match: {
          score: { $gte: minScore }  // Filter by minimum similarity score
        }
      },
      ...(excludeIds.length ? [{ $match: { id: { $nin: excludeIds } } }] : []), // sources the user marked unrelated
      {
        $limit: limit
      },
      {
        $project: { ...RESULT_PROJECTION, score: 1 }
      }
    ];

    let results = await decisionsCollection.aggregate(pipeline).toArray();

    console.log(`🔍 Vector search completed:`);
    console.log(`   - Query: "${query}"`);
    console.log(`   - Workspace: ${workspace_id}`);
    console.log(`   - Min score: ${minScore}`);
    console.log(`   - Raw results: ${results.length}`);

    if (results.length > 0) {
      console.log(`   - Top score: ${(results[0].score * 100).toFixed(1)}%`);
      console.log(`   - Lowest score: ${(results[results.length - 1].score * 100).toFixed(1)}%`);
      console.log(`   - Sample results:`);
      results.slice(0, 3).forEach(r => {
        console.log(`     • Decision #${r.id}: ${(r.score * 100).toFixed(1)}% - "${r.text.substring(0, 60)}..."`);
      });
    }

    // Apply keyword boost (always - boosts exact keyword matches)
    results = applyKeywordBoost(results, query);

    // Filter false positives (no keyword match + low score = likely irrelevant)
    const beforeFilterCount = results.length;
    results = filterFalsePositives(results, query);
    console.log(`   📊 After false positive filter: ${results.length} results (removed ${beforeFilterCount - results.length})`);

    // Apply recency boost if temporal context detected
    results = applyRecencyBoost(results, queryHasTemporalContext);

    // Re-sort by boosted scores
    results.sort((a, b) => b.score - a.score);

    if (results.length > 0) {
      console.log(`   ✅ After all boosts - Top score: ${(results[0].score * 100).toFixed(1)}%`);
    }

    // Categorize results by relevance (using boosted scores)
    // NOTE: We only return High (85%+) and Medium (70-84%) relevance
    // Low relevance (60-69%) is excluded to avoid showing irrelevant results
    const lowRelevanceCount = results.filter(r => r.score < 0.70).length;
    const lowRelevanceSample = results.filter(r => r.score < 0.70).slice(0, 2);

    if (lowRelevanceCount > 0) {
      console.log(`   ⚠️  FILTERING OUT ${lowRelevanceCount} results below 70% threshold:`);
      lowRelevanceSample.forEach(r => {
        console.log(`     • Decision #${r.id}: ${(r.score * 100).toFixed(1)}% - "${r.text.substring(0, 60)}..." (has keyword: ${r.hasKeywordMatch})`);
      });
    }

    const categorized = {
      highlyRelevant: results.filter(r => r.score >= 0.85),
      relevant: results.filter(r => r.score >= 0.70 && r.score < 0.85),
      somewhatRelevant: [], // Intentionally empty - we don't show low relevance results
      all: results.filter(r => r.score >= 0.70), // Only include 70%+ results
      temporalBoostApplied: queryHasTemporalContext,
      keywordBoostApplied: results.some(r => r.keywordBoost > 0),
      falsePositivesFiltered: beforeFilterCount - results.length
    };

    console.log(`   ✅ Categorized: ${categorized.highlyRelevant.length} highly relevant, ${categorized.relevant.length} relevant`);
    console.log(`   ℹ️  Excluded ${lowRelevanceCount} low-relevance results (< 70%)`);

    return categorized;

  } catch (error) {
    console.error('❌ Semantic search error:', error.message);
    console.error('   Full error:', error);

    // If vector search index doesn't exist, provide helpful error
    if (error.message.includes('index') || error.code === 291) {
      throw new Error(
        'Vector search index not found. Please create the index in MongoDB Atlas. ' +
        'See docs/setup-vector-search.md for instructions.'
      );
    }

    throw error;
  }
}

/**
 * CREDIT OPTIMIZATION: In-memory cache for conversational responses
 * Key: hash of query + results + version, Value: { response, timestamp }
 * Entries expire after 5 minutes to balance freshness vs cost savings
 *
 * CACHE_VERSION: Increment this when you change the prompt to bust old cached responses
 */
const responseCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_VERSION = 5; // v5: open action items are part of the answer

/**
 * Answers the question from the search results with Claude, and says which results it used.
 *
 * Claude returns JSON { "answer": "...", "used_ids": [12, 45] }: Search shows the
 * sources it used first, and the rest as "other matches". Answers in the language of
 * the question. Cached for 5 minutes per query + result set.
 *
 * @param {string} query - User's question
 * @param {Object} results - Search results ({ all: [...] })
 * @param {Array} conversationHistory - Previous turns [{ role, content }] or [{ query, response }]
 * @returns {Promise<{ text: string, usedIds: number[] }>}
 */
async function generateConversationalResponse(query, results, conversationHistory = [], actionItems = [], aiContext = {}) {
  const allIds = results.all.map(r => r.id);
  // Without Claude, only real matches can be listed (not the latest outcomes added as candidates)
  const matchedOnly = { ...results, all: results.all.filter(r => r.matched !== false) };
  const fallback = () => (matchedOnly.all.length === 0 && actionItems.length > 0
    ? { text: `${actionItems.length} open action item${actionItems.length === 1 ? '' : 's'} match your question. They're listed below.`, usedIds: [] }
    : { text: formatResultsSimple(query, matchedOnly), usedIds: matchedOnly.all.slice(0, 3).map(r => r.id) });
  if (!config.claude.isConfigured || (results.all.length === 0 && actionItems.length === 0)) return fallback();

  const cacheKey = `v${CACHE_VERSION}_${query}_${allIds.join(',')}_${actionItems.map(item => item.item_id).join(',')}`;
  const cached = responseCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log('♻️  CREDIT SAVED: Using cached conversational response (v' + CACHE_VERSION + ')');
    return cached.response;
  }

  const anthropic = posthog
    ? new PostHogAnthropic({ apiKey: config.claude.apiKey, posthog })
    : new Anthropic({ apiKey: config.claude.apiKey });
  const sources = results.all.map(r => describeSource(r)).join('\n\n') || '(none)';
  const history = formatHistory(conversationHistory);
  const actions = actionItems.length
    ? `\n\nOpen action items (pending work) that may relate to the question:\n${actionItems.map(describeActionItem).join('\n')}`
    : '';

  const prompt = `You answer questions about a team's meeting outcomes (decisions, open questions, risks and context captured from their meetings).${history}

Question: "${query}"

Sources (search matches; some may be unrelated to the question):

${sources}${actions}

Instructions:
- Answer in the same language as the question.
- Sources may be written in another language than the question ("directorio" = "board", "octubre" = "October").
- Use only sources that actually help answer the question. Ignore the others, even if they share words with it.
- Start with the direct answer, then the why and context. Mention sources by number, like "(#74)". 60 to 150 words, plain text, no headings or lists unless steps are needed.
- If no source answers the question, say so briefly and suggest what to search instead. Don't invent anything that isn't in the sources.
- If the question is about pending work (action items, "pendientes", what someone still owes), answer from the open action items: who has to do what, and by when (say which are overdue). A short list is fine here. They're shown to the user below the answer, so don't cite them by number.

Reply with JSON only: {"answer": "...", "used_ids": [the numbers of the sources you used]}`;

  try {
    const model = config.claude.model;
    const request = { model, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] };
    if (posthog) {
      request.posthogTraceId = aiContext.traceId || crypto.randomUUID();
      request.posthogProperties = {
        $ai_session_id: aiContext.sessionId || `semantic-search-process-${process.pid}`
      };
      if (aiContext.distinctId) request.posthogDistinctId = aiContext.distinctId;
    }
    if (SAMPLING_MODELS.test(model)) request.temperature = 0.3; // newer models don't take sampling parameters
    const response = await anthropic.messages.create(request);
    const parsed = parseAnswer(
      (response.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n'),
      allIds
    );
    if (!parsed) throw new Error('Unreadable answer');

    responseCache.set(cacheKey, { response: parsed, timestamp: Date.now() });
    if (responseCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of responseCache.entries()) {
        if (now - value.timestamp > CACHE_TTL_MS) responseCache.delete(key);
      }
    }
    return parsed;
  } catch (error) {
    console.error('❌ Error generating conversational response:', error.message);
    return fallback();
  }
}

/** One source for the answer prompt: number, type, date, text, why, who, meeting */
function describeSource(r) {
  const date = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 10) : 'unknown date';
  const lines = [`#${r.id} (${r.type || 'decision'}, ${date}${r.source_details && r.source_details.title ? `, meeting "${r.source_details.title}"` : ''}): ${r.text}`];
  if (r.rationale) lines.push(`  Why: ${r.rationale}`);
  if (r.owner_name) lines.push(`  Accountable: ${r.owner_name}`);
  if (typeof r.alternatives === 'string' && r.alternatives) lines.push(`  Notes: ${r.alternatives.slice(0, r.matched === false ? 200 : 600)}`);
  if (Array.isArray(r.tags) && r.tags.length) lines.push(`  Tags: ${r.tags.join(', ')}`);
  return lines.join('\n');
}

/** One open action item for the answer prompt: what, who, when, from which meeting */
function describeActionItem(item) {
  const today = new Date().toISOString().slice(0, 10);
  const owners = (item.owners || []).map(owner => owner.name).filter(Boolean).join(', ') || 'no owner';
  const due = item.due_date ? `due ${item.due_date}${item.due_date < today ? ' (overdue)' : ''}` : 'no due date';
  const meeting = item.source && item.source.title ? ` · from meeting "${item.source.title}"` : '';
  return `- ${item.text} · owner: ${owners} · ${due}${meeting}`;
}

/** The last two turns, in either shape the page sends */
function formatHistory(conversationHistory) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) return '';
  const turns = conversationHistory.slice(-4).map(turn => {
    if (turn.role) return `${turn.role === 'user' ? 'User' : 'You'}: ${String(turn.content || '').slice(0, 800)}`;
    return `User: ${turn.query}\nYou: ${turn.response}`;
  });
  return `\n\nConversation so far:\n${turns.join('\n')}`;
}

/**
 * Reads Claude's { answer, used_ids } reply; used_ids is limited to the sources given
 * @param {string} text
 * @param {number[]} allowedIds
 * @returns {{ text: string, usedIds: number[] }|null}
 */
function parseAnswer(text, allowedIds) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    if (typeof data.answer !== 'string' || !data.answer.trim()) return null;
    const allowed = new Set(allowedIds);
    const usedIds = [...new Set((Array.isArray(data.used_ids) ? data.used_ids : []).map(Number))].filter(id => allowed.has(id));
    return { text: data.answer.trim(), usedIds };
  } catch (error) {
    return null;
  }
}

/**
 * Simple fallback formatting (no Claude required) - CONVERSATIONAL, not robotic
 * This is used when Claude API fails, so it should still sound human
 */
function formatResultsSimple(query, results) {
  if (results.all.length === 0) {
    return `Hmm, I don't see anything in our team memory about "${query}". Try rephrasing or using different keywords - I might have it logged under a different term!`;
  }

  // Be conversational, not robotic - don't say "I found X things"
  const topResults = results.all.slice(0, 3);

  // Build a natural response based on the results
  let response = '';

  if (results.all.length === 1) {
    const r = results.all[0];
    const daysAgo = Math.floor((Date.now() - new Date(r.timestamp).getTime()) / (24 * 60 * 60 * 1000));
    const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : daysAgo < 7 ? `${daysAgo} days ago` : `${Math.floor(daysAgo / 7)} weeks ago`;

    response = `We logged this about "${query}" ${when} (Decision #${r.id}): ${r.text}`;
  } else {
    // Multiple results - synthesize naturally
    const recent = topResults[0];
    const daysAgo = Math.floor((Date.now() - new Date(recent.timestamp).getTime()) / (24 * 60 * 60 * 1000));
    const when = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : daysAgo < 7 ? `${daysAgo} days ago` : `a couple weeks ago`;

    response = `Looking at our decisions about "${query}", the most recent was ${when} (Decision #${recent.id}): "${recent.text}"\n\n`;

    if (topResults.length > 1) {
      response += `We also decided:\n`;
      topResults.slice(1).forEach(r => {
        response += `• Decision #${r.id}: ${r.text.substring(0, 100)}${r.text.length > 100 ? '...' : ''}\n`;
      });
    }

    if (results.all.length > 3) {
      response += `\n...plus ${results.all.length - 3} more related decisions. Want details on any specific one?`;
    }
  }

  return response;
}

/**
 * Detect if query is asking for a specific decision by ID
 * Examples: "decision 123", "decision #45", "show me #12", "tell me about decision 5"
 */
function extractDecisionId(query) {
  const patterns = [
    /decision\s*#?(\d+)/i,
    /#(\d+)/,
    /\bid\s*#?(\d+)/i,
    /number\s*#?(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      return parseInt(match[1]);
    }
  }

  return null;
}

/**
 * Fetch a specific decision by ID
 */
async function fetchDecisionById(decisionId, workspaceId, spaceId) {
  const decisionsCollection = getDecisionsCollection();

  const decision = await decisionsCollection.findOne({
    id: decisionId,
    workspace_id: workspaceId,
    space_id: spaceId  // SECURITY FIX: Ensure decision is in user's current space
  }, { projection: RESULT_PROJECTION });

  if (!decision) {
    return null;
  }

  // Format as categorized results for consistency
  return {
    highlyRelevant: [{ ...decision, score: 1.0, hasKeywordMatch: true }],
    relevant: [],
    somewhatRelevant: [],
    all: [{ ...decision, score: 1.0, hasKeywordMatch: true }],
    searchMethod: 'id_lookup'
  };
}

/**
 * Hybrid search: Combines semantic search with traditional keyword search
 * Falls back to keyword if semantic search fails or returns no results
 * Also supports direct ID lookup (e.g., "show me decision #123")
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Object>} - Search results with metadata
 */
async function hybridSearch(query, options = {}) {
  let searchMethod = 'semantic';
  let results = null;

  console.log(`🔍 Hybrid search starting...`);

  // Check if user is asking for a specific decision by ID
  const decisionId = extractDecisionId(query);
  if (decisionId) {
    console.log(`   🎯 Decision ID detected: #${decisionId}`);
    const idResult = await fetchDecisionById(decisionId, options.workspace_id, options.space_id);

    if (idResult) {
      return {
        results: idResult,
        searchMethod: 'id_lookup',
        query,
        options
      };
    } else {
      console.log(`   ⚠️  Decision #${decisionId} not found, falling back to semantic search`);
    }
  }

  console.log(`   - Embeddings enabled: ${isEmbeddingsEnabled()}`);

  // Try semantic search first
  if (isEmbeddingsEnabled()) {
    try {
      results = await semanticSearch(query, options);

      // If no semantic results, fall back to keyword
      if (results.all.length === 0) {
        console.log('⚠️  No semantic results, falling back to keyword search');
        searchMethod = 'keyword_fallback';
        results = await keywordSearch(query, options);
      }
    } catch (error) {
      console.error('⚠️  Semantic search failed, falling back to keyword:', error.message);
      searchMethod = 'keyword_fallback';
      results = await keywordSearch(query, options);
    }
  } else {
    // Semantic search not enabled, use keyword
    searchMethod = 'keyword';
    results = await keywordSearch(query, options);
  }

  // Few or no matches (semantic search off, or the question and the sources are in different
  // languages: "directorio en octubre" vs "Board meeting on October 22"): let Claude read the
  // space's latest outcomes too and pick the ones that answer the question
  if (results.all.length < MIN_MATCHES_BEFORE_SCAN && config.claude.isConfigured) {
    const matchedIds = new Set(results.all.map(r => r.id));
    const recent = (await recentOutcomes(options)).filter(r => !matchedIds.has(r.id));
    console.log(`   📚 Only ${results.all.length} match(es): adding the ${recent.length} latest outcomes for Claude to choose from`);
    results = {
      ...results,
      all: [...results.all.map(r => ({ ...r, matched: true })), ...recent.map(r => ({ ...r, score: 0, matched: false }))]
    };
    searchMethod = `${searchMethod}+recent_scan`;
  } else {
    results = { ...results, all: results.all.map(r => ({ ...r, matched: true })) };
  }

  return {
    results,
    searchMethod,
    query,
    options
  };
}

// Below this many matches, the latest outcomes of the space are added for Claude to choose from
const MIN_MATCHES_BEFORE_SCAN = 3;
const RECENT_SCAN_LIMIT = 60;

/**
 * The space's latest outcomes (candidates when search finds too little)
 * @param {Object} options - { workspace_id, space_id, excludeIds }
 * @returns {Promise<Object[]>}
 */
async function recentOutcomes({ workspace_id, space_id, excludeIds = [] }) {
  const filter = { workspace_id, space_id };
  if (excludeIds.length) filter.id = { $nin: excludeIds };
  return getDecisionsCollection()
    .find(filter, { projection: RESULT_PROJECTION })
    .sort({ timestamp: -1 })
    .limit(RECENT_SCAN_LIMIT)
    .toArray();
}

/**
 * Sources to show on the page: the ones the answer used (in its order), then the other
 * search matches; outcomes that were only read as candidates are left out unless used
 * @param {Object[]} all - results.all, with `matched` from hybridSearch
 * @param {number[]} usedIds
 * @returns {Object[]}
 */
function visibleSources(all, usedIds) {
  const used = usedIds.map(id => all.find(r => r.id === id)).filter(Boolean);
  const others = all.filter(r => r.matched !== false && !usedIds.includes(r.id));
  return [...used, ...others];
}

/**
 * Keyword search (fallback when semantic search is off or finds nothing).
 * Candidates contain a keyword at the start of a word (accents ignored); a source counts
 * only if it contains enough of the query's keywords (requiredMatches). Scored by the share
 * of keywords it contains (0.5–1.0), then by date.
 */
async function keywordSearch(query, options = {}) {
  const {
    workspace_id,
    space_id,
    type,
    dateFrom,
    dateTo,
    limit = 10,
    excludeIds = []
  } = options;

  if (!workspace_id) {
    throw new Error('workspace_id is required for search');
  }

  if (!space_id) {
    throw new Error('space_id is required for search');
  }

  const keywords = extractKeywords(query);
  console.log(`🔍 Keyword search: keywords [${keywords.join(', ')}]`);
  const empty = { highlyRelevant: [], relevant: [], somewhatRelevant: [], all: [] };
  if (keywords.length === 0) return empty;

  const orConditions = keywords.flatMap(keyword => {
    const pattern = accentInsensitivePattern(keyword);
    return [
      { text: { $regex: pattern, $options: 'i' } },
      { tags: { $regex: pattern, $options: 'i' } },
      { rationale: { $regex: pattern, $options: 'i' } },
      { 'source_details.title': { $regex: pattern, $options: 'i' } },
      { epic_key: { $regex: pattern, $options: 'i' } }
    ];
  });

  const filter = {
    workspace_id,
    space_id,  // SECURITY FIX: Filter search by space
    $or: orConditions
  };
  if (excludeIds.length) filter.id = { $nin: excludeIds };
  if (type) filter.type = type;
  if (dateFrom || dateTo) {
    filter.timestamp = {};
    if (dateFrom) filter.timestamp.$gte = dateFrom.toISOString();
    if (dateTo) filter.timestamp.$lte = dateTo.toISOString();
  }

  const candidates = await getDecisionsCollection()
    .find(filter, { projection: RESULT_PROJECTION })
    .sort({ timestamp: -1 })
    .limit(200)
    .toArray();

  const needed = requiredMatches(keywords.length);
  const results = candidates
    .map(doc => ({ doc, matches: matchedKeywords(doc, keywords).length }))
    .filter(({ matches }) => matches >= needed)
    .sort((a, b) => b.matches - a.matches) // stable: newest first among equals
    .slice(0, limit)
    .map(({ doc, matches }) => ({ ...doc, score: 0.5 + 0.5 * (matches / keywords.length), keywordMatches: matches }));

  return {
    highlyRelevant: results.filter(r => r.score >= 0.85),
    relevant: results.filter(r => r.score < 0.85),
    somewhatRelevant: [],
    all: results
  };
}

module.exports = {
  parseAnswer,
  visibleSources,
  recentOutcomes,
  describeSource,
  semanticSearch,
  generateConversationalResponse,
  hybridSearch,
  keywordSearch
};
