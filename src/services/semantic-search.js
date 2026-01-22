const { getDecisionsCollection, getDatabase } = require('../config/database');
const { generateQueryEmbedding, isEmbeddingsEnabled } = require('./embeddings');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/environment');

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
 * Extract meaningful keywords from query (removes stop words, temporal keywords)
 */
function extractKeywords(query) {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
    'could', 'can', 'may', 'might', 'must', 'about', 'of', 'for', 'with',
    'what', 'show', 'me', 'find', 'search', 'look', 'get', 'all', 'any',
    'decisions', 'decision', 'we', 'made', 'have', 'latest', 'recent'
  ]);

  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  return [...new Set(words)]; // Remove duplicates
}

/**
 * Apply keyword boost to scores when query terms appear in decision text
 * Boosts score when exact keyword matches found
 */
function applyKeywordBoost(results, query) {
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    console.log('   ⚠️  No meaningful keywords extracted, skipping keyword boost');
    return results;
  }

  console.log(`   🔑 Extracted keywords for boosting: [${keywords.join(', ')}]`);

  return results.map(result => {
    const decisionText = (result.text || '').toLowerCase();
    const tags = (result.tags || []).map(t => t.toLowerCase()).join(' ');
    const searchableText = `${decisionText} ${tags}`;

    let keywordMatchCount = 0;
    let exactMatchBoost = 0;

    keywords.forEach(keyword => {
      // Count how many times keyword appears
      const regex = new RegExp(keyword, 'gi');
      const matches = searchableText.match(regex);
      if (matches) {
        keywordMatchCount += matches.length;
        // Each keyword match adds 0.05, max 0.15 total
        exactMatchBoost += Math.min(0.15, matches.length * 0.05);
      }
    });

    if (keywordMatchCount > 0) {
      const originalScore = result.score;
      const boostedScore = Math.min(1.0, result.score + exactMatchBoost);

      console.log(`   🔑 Decision #${result.id}: ${originalScore.toFixed(3)} → ${boostedScore.toFixed(3)} (+${exactMatchBoost.toFixed(2)} keyword boost, ${keywordMatchCount} matches)`);

      return {
        ...result,
        score: boostedScore,
        keywordBoost: exactMatchBoost,
        keywordMatches: keywordMatchCount
      };
    }

    return result;
  });
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
    type,
    category,
    dateFrom,
    dateTo,
    limit = 10,
    minScore = 0.7
  } = options;

  if (!workspace_id) {
    throw new Error('workspace_id is required for semantic search');
  }

  try {
    // Generate embedding for the search query
    console.log(`🔍 Semantic search: "${query}"`);
    const queryEmbedding = await generateQueryEmbedding(query);

    // Detect if query is looking for recent decisions
    const queryHasTemporalContext = hasTemporalContext(query);
    if (queryHasTemporalContext) {
      console.log(`   ⏰ Temporal context detected - will boost recent decisions`);
    }

    // Build filter for pre-filtering before vector search
    const preFilter = { workspace_id };

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
    const db = getDatabase();
    const decisionsCollection = db.collection('decisions');

    const pipeline = [
      {
        $vectorSearch: {
          index: 'vector_search_index',  // Must match the index name in Atlas
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: Math.max(limit * 10, 100), // Over-fetch for better results
          limit: limit * 2,  // Get more results before score filtering
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
      {
        $limit: limit
      },
      {
        $project: {
          _id: 0,
          id: 1,
          text: 1,
          type: 1,
          epic_key: 1,
          jira_data: 1,
          tags: 1,
          alternatives: 1,
          creator: 1,
          user_id: 1,
          channel_id: 1,
          timestamp: 1,
          workspace_id: 1,
          score: 1
        }
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
    }

    // Apply keyword boost (always - boosts exact keyword matches)
    results = applyKeywordBoost(results, query);

    // Apply recency boost if temporal context detected
    results = applyRecencyBoost(results, queryHasTemporalContext);

    // Re-sort by boosted scores
    results.sort((a, b) => b.score - a.score);

    if (results.length > 0) {
      console.log(`   ✅ After all boosts - Top score: ${(results[0].score * 100).toFixed(1)}%`);
    }

    // Categorize results by relevance (using boosted scores)
    const categorized = {
      highlyRelevant: results.filter(r => r.score >= 0.85),
      relevant: results.filter(r => r.score >= 0.70 && r.score < 0.85),
      somewhatRelevant: results.filter(r => r.score >= 0.60 && r.score < 0.70),
      all: results,
      temporalBoostApplied: queryHasTemporalContext,
      keywordBoostApplied: results.some(r => r.keywordBoost > 0)
    };

    console.log(`   ✅ Categorized: ${categorized.highlyRelevant.length} highly relevant, ${categorized.relevant.length} relevant, ${categorized.somewhatRelevant.length} somewhat relevant`);

    return categorized;

  } catch (error) {
    console.error('❌ Semantic search error:', error.message);
    console.error('   Full error:', error);

    // If vector search index doesn't exist, provide helpful error
    if (error.message.includes('index') || error.code === 291) {
      throw new Error(
        'Vector search index not found. Please create the index in MongoDB Atlas. ' +
        'See setup-vector-search.md for instructions.'
      );
    }

    throw error;
  }
}

/**
 * CREDIT OPTIMIZATION: In-memory cache for conversational responses
 * Key: hash of query + results, Value: { response, timestamp }
 * Entries expire after 5 minutes to balance freshness vs cost savings
 */
const responseCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate conversational response for search results using Claude
 *
 * CREDIT OPTIMIZATION: Multiple optimizations applied
 * - Reduced prompt from ~400 to ~150 tokens (~60% reduction)
 * - Added response caching (5 min TTL) to avoid duplicate API calls
 * - Reduced max_tokens from 800 to 500
 * - Compact result format saves tokens in context
 *
 * @param {string} query - User's original query
 * @param {Array} results - Search results with scores
 * @param {Object} metadata - Additional context
 * @returns {Promise<string>} - Conversational response
 */
async function generateConversationalResponse(query, results, metadata = {}) {
  if (!config.claude.isConfigured) {
    return formatResultsSimple(query, results);
  }

  // CREDIT OPTIMIZATION: Check cache first
  const cacheKey = `${query}_${results.all.map(r => r.id).join(',')}`;
  const cached = responseCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log('♻️  CREDIT SAVED: Using cached conversational response');
    return cached.response;
  }

  const anthropic = new Anthropic({ apiKey: config.claude.apiKey });

  // CREDIT OPTIMIZATION: Compact result format (saves ~50% tokens vs verbose format)
  // Include timestamp and boost indicators for better context
  const resultsContext = results.all.map(r => {
    const daysAgo = Math.floor((Date.now() - new Date(r.timestamp).getTime()) / (24 * 60 * 60 * 1000));
    const timeContext = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;

    const boosts = [];
    if (r.keywordBoost) boosts.push('🎯 exact match');
    if (r.recencyBoost) boosts.push('🔥 recent');
    const boostIndicator = boosts.length > 0 ? ` (${boosts.join(', ')})` : '';

    return `#${r.id} [${(r.score * 100).toFixed(0)}%]${boostIndicator} ${r.type}: "${r.text}" (${r.creator}, ${timeContext})`;
  }).join('\n');

  // CREDIT OPTIMIZATION: Shortened prompt (~60% reduction)
  const notes = [];
  if (results.temporalBoostApplied) {
    notes.push('Recent decisions boosted due to temporal query context.');
  }
  if (results.all.some(r => r.keywordBoost)) {
    notes.push('Exact keyword matches boosted for relevance.');
  }
  const notesText = notes.length > 0 ? `\nNote: ${notes.join(' ')}` : '';

  const prompt = `Query: "${query}"
Results (${results.all.length}):
${resultsContext}${notesText}

Summarize findings in markdown. Group by relevance (85%+ high, 70-84% medium, 60-69% low). Highlight exact matches and recent decisions. Be concise (<200 words).`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,  // CREDIT OPTIMIZATION: Reduced from 800
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = response.content[0].text;

    // Cache the response
    responseCache.set(cacheKey, { response: responseText, timestamp: Date.now() });

    // CREDIT OPTIMIZATION: Cleanup old cache entries periodically
    if (responseCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of responseCache.entries()) {
        if (now - value.timestamp > CACHE_TTL_MS) {
          responseCache.delete(key);
        }
      }
    }

    return responseText;

  } catch (error) {
    console.error('❌ Error generating conversational response:', error.message);
    return formatResultsSimple(query, results);
  }
}

/**
 * Simple fallback formatting (no Claude required)
 */
function formatResultsSimple(query, results) {
  if (results.all.length === 0) {
    return `I couldn't find any decisions matching "${query}". Try different keywords or check the decision type filter.`;
  }

  let response = `🔍 Found **${results.all.length} decision${results.all.length === 1 ? '' : 's'}** matching "${query}":\n\n`;

  if (results.highlyRelevant.length > 0) {
    response += `**📌 Highly Relevant** (85%+ match):\n\n`;
    results.highlyRelevant.forEach(r => {
      response += `- **Decision #${r.id}**: ${r.text}\n`;
      response += `  _${r.type} • ${r.creator} • ${new Date(r.timestamp).toLocaleDateString()}_\n\n`;
    });
  }

  if (results.relevant.length > 0) {
    response += `**📍 Relevant** (70-84% match):\n\n`;
    results.relevant.forEach(r => {
      response += `- **Decision #${r.id}**: ${r.text}\n`;
      response += `  _${r.type} • ${r.creator}_\n\n`;
    });
  }

  if (results.somewhatRelevant.length > 0) {
    response += `**💡 Related Decisions** (60-69% match):\n\n`;
    results.somewhatRelevant.forEach(r => {
      response += `- **Decision #${r.id}**: ${r.text.substring(0, 80)}${r.text.length > 80 ? '...' : ''}\n`;
    });
  }

  response += `\nWould you like more details about any of these decisions?`;

  return response;
}

/**
 * Hybrid search: Combines semantic search with traditional keyword search
 * Falls back to keyword if semantic search fails or returns no results
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Object>} - Search results with metadata
 */
async function hybridSearch(query, options = {}) {
  let searchMethod = 'semantic';
  let results = null;

  console.log(`🔍 Hybrid search starting...`);
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

  return {
    results,
    searchMethod,
    query,
    options
  };
}

/**
 * Traditional keyword-based search (fallback)
 */
async function keywordSearch(query, options = {}) {
  const {
    workspace_id,
    type,
    dateFrom,
    dateTo,
    limit = 10
  } = options;

  if (!workspace_id) {
    throw new Error('workspace_id is required for search');
  }

  const decisionsCollection = getDecisionsCollection();

  const filter = {
    workspace_id,
    $or: [
      { text: { $regex: query, $options: 'i' } },
      { tags: { $regex: query, $options: 'i' } },
      { epic_key: { $regex: query, $options: 'i' } }
    ]
  };

  if (type) {
    filter.type = type;
  }

  if (dateFrom || dateTo) {
    filter.timestamp = {};
    if (dateFrom) {
      filter.timestamp.$gte = dateFrom.toISOString();
    }
    if (dateTo) {
      filter.timestamp.$lte = dateTo.toISOString();
    }
  }

  const results = await decisionsCollection
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  // Format as categorized results (all are "relevant" for keyword search)
  return {
    highlyRelevant: [],
    relevant: results.map(r => ({ ...r, score: 0.75 })), // Fake score for consistency
    somewhatRelevant: [],
    all: results.map(r => ({ ...r, score: 0.75 }))
  };
}

module.exports = {
  semanticSearch,
  generateConversationalResponse,
  hybridSearch,
  keywordSearch
};
