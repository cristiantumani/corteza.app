const { getDecisionsCollection, getDatabase } = require('../config/database');
const { generateQueryEmbedding, isEmbeddingsEnabled } = require('./embeddings');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/environment');

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

    const results = await decisionsCollection.aggregate(pipeline).toArray();

    console.log(`🔍 Vector search completed:`);
    console.log(`   - Query: "${query}"`);
    console.log(`   - Workspace: ${workspace_id}`);
    console.log(`   - Min score: ${minScore}`);
    console.log(`   - Raw results: ${results.length}`);

    if (results.length > 0) {
      console.log(`   - Top score: ${(results[0].score * 100).toFixed(1)}%`);
      console.log(`   - Lowest score: ${(results[results.length - 1].score * 100).toFixed(1)}%`);
    }

    // Categorize results by relevance
    const categorized = {
      highlyRelevant: results.filter(r => r.score >= 0.85),
      relevant: results.filter(r => r.score >= 0.70 && r.score < 0.85),
      somewhatRelevant: results.filter(r => r.score >= 0.60 && r.score < 0.70),
      all: results
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
 * Generate conversational response for search results using Claude
 *
 * @param {string} query - User's original query
 * @param {Array} results - Search results with scores
 * @param {Object} metadata - Additional context
 * @returns {Promise<string>} - Conversational response
 */
async function generateConversationalResponse(query, results, metadata = {}) {
  if (!config.claude.isConfigured) {
    // Fallback to simple formatting if Claude not available
    return formatResultsSimple(query, results);
  }

  const anthropic = new Anthropic({ apiKey: config.claude.apiKey });

  // Build context from search results
  const resultsContext = results.all.map((r, idx) => {
    return `Decision #${r.id} (${(r.score * 100).toFixed(0)}% match):
- Text: "${r.text}"
- Type: ${r.type}
- Creator: ${r.creator}
- Date: ${new Date(r.timestamp).toLocaleDateString()}
${r.tags && r.tags.length > 0 ? `- Tags: ${r.tags.join(', ')}` : ''}
${r.epic_key ? `- Epic: ${r.epic_key}` : ''}`;
  }).join('\n\n');

  const prompt = `You are a helpful assistant for a decision tracking system. A user asked: "${query}"

I found ${results.all.length} relevant decisions:

${resultsContext}

Generate a friendly, conversational response that:
1. Summarizes what was found
2. Groups results by relevance (highly relevant 85%+, relevant 70-84%, somewhat relevant 60-69%)
3. Highlights the most relevant decisions first
4. Keeps it concise but informative
5. Ends with offering to show more details if needed

Format using markdown for readability. Keep it under 400 words.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022', // Use Haiku 3.5 for speed and cost
      max_tokens: 800,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    return response.content[0].text;

  } catch (error) {
    console.error('❌ Error generating conversational response:', error.message);
    // Fallback to simple formatting
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
