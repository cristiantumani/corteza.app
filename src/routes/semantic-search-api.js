const { hybridSearch, generateConversationalResponse, visibleSources } = require('../services/semantic-search');
const { validateQueryParams } = require('../middleware/validation');
const { canAccessSpace } = require('../services/permissions');
const { getSlackClient } = require('../config/slack-client');

/**
 * Parse query parameters from URL
 */
function parseQueryParams(url) {
  const urlObj = new URL(url, 'http://localhost');
  const params = {};
  urlObj.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * POST /api/semantic-search - Conversational semantic search endpoint
 *
 * Request body:
 * {
 *   "query": "show me AEM decisions",
 *   "workspace_id": "T123ABC",
 *   "type": "technical" (optional),
 *   "dateFrom": "2024-01-01" (optional),
 *   "dateTo": "2024-12-31" (optional),
 *   "limit": 8 (optional, max 20),
 *   "exclude_ids": [12, 45] (optional: sources the user marked as unrelated),
 *   "conversational": true (optional, default true)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "query": "show me AEM decisions",
 *   "response": "We moved AEM to ... (#12)",
 *   "used_ids": [12],            (sources the answer is based on)
 *   "decisions": [...],
 *   "searchMethod": "semantic",
 *   "resultsCount": 5
 * }
 */
async function handleSemanticSearch(req, res) {
  console.log('🔍 [ENTRY] handleSemanticSearch called');
  console.log('   - Request method:', req.method);
  console.log('   - Request URL:', req.url);
  console.log('   - Has session:', !!req.session);
  console.log('   - User ID:', req.session?.user_id);
  console.log('   - Request body:', req.body);

  try {
    // Workspace comes from the session, never from the request body
    const requestData = { ...(req.body || {}), workspace_id: req.session?.user?.workspace_id };

    console.log('🔍 Semantic search request received:');
    console.log(`   - Query: "${requestData.query}"`);
    console.log(`   - Workspace ID: ${requestData.workspace_id}`);
    console.log(`   - Conversational: ${requestData.conversational !== false}`);
    console.log(`   - Timestamp: ${new Date().toISOString()}`);

    // Validate required fields
    if (!requestData.query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }

    if (!requestData.workspace_id) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // Space-first architecture: space_id is REQUIRED
    if (!requestData.space_id) {
      return res.status(400).json({
        success: false,
        error: 'space_id is required for search',
        message: 'You must select a space to perform a search'
      });
    }

    // Validate user has access to this space
    const userId = req.session?.user?.user_id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    try {
      const client = await getSlackClient(requestData.workspace_id);
      const hasAccess = await canAccessSpace(client, requestData.workspace_id, requestData.space_id, userId);

      if (!hasAccess) {
        console.log(`⚠️  User ${userId} attempted to search space ${requestData.space_id} without permission`);
        return res.status(403).json({
          success: false,
          error: 'Access denied to this space',
          message: 'You do not have permission to search in this space'
        });
      }
    } catch (accessError) {
      console.error('❌ Error validating space access:', accessError);
      return res.status(500).json({
        success: false,
        error: 'Failed to validate space access'
      });
    }

    // Build search options
    const searchOptions = {
      workspace_id: requestData.workspace_id,
      space_id: requestData.space_id,  // SECURITY FIX: Filter search by space
      limit: Math.min(Math.max(parseInt(requestData.limit, 10) || 8, 1), 20),
      minScore: requestData.minScore || 0.5,  // Low threshold to get candidates; false positives filtered later
      excludeIds: (Array.isArray(requestData.exclude_ids) ? requestData.exclude_ids : [])
        .map(Number).filter(Number.isInteger).slice(0, 50)
    };

    if (requestData.type) {
      searchOptions.type = requestData.type;
    }

    if (requestData.dateFrom) {
      searchOptions.dateFrom = new Date(requestData.dateFrom);
    }

    if (requestData.dateTo) {
      searchOptions.dateTo = new Date(requestData.dateTo);
    }

    // Perform hybrid search
    console.log('   📊 Starting hybrid search...');
    let searchResult;
    try {
      searchResult = await hybridSearch(requestData.query, searchOptions);
      console.log('   ✅ Hybrid search completed');
    } catch (searchError) {
      console.error('❌ Hybrid search failed:', searchError);
      return res.status(500).json({
        success: false,
        error: 'Search failed',
        details: searchError.message
      });
    }

    console.log(`✅ Search completed:`);
    console.log(`   - Method: ${searchResult.searchMethod}`);
    console.log(`   - Results: ${searchResult.results.all.length}`);
    if (searchResult.results.all.length > 0) {
      console.log(`   - Top score: ${(searchResult.results.all[0].score * 100).toFixed(1)}%`);
    }

    // Generate conversational response (if requested)
    let conversationalResponse = null;
    let usedIds = searchResult.results.all.filter(r => r.matched !== false).map(r => r.id);
    if (requestData.conversational !== false) {
      console.log('   🤖 Generating conversational response...');
      try {
        // Pass conversation history for context-aware responses
        const conversationHistory = requestData.conversationHistory || [];
        const answer = await generateConversationalResponse(
          requestData.query,
          searchResult.results,
          conversationHistory
        );
        conversationalResponse = answer.text;
        usedIds = answer.usedIds;
        console.log('   ✅ Conversational response generated');
      } catch (aiError) {
        console.error('⚠️ AI response generation failed, continuing without conversational response:', aiError.message);
        // Continue without conversational response rather than failing entirely
        conversationalResponse = `Found ${searchResult.results.all.length} relevant decision${searchResult.results.all.length !== 1 ? 's' : ''}`;
      }
    }

    // Without an AI answer, every match counts as used
    if (requestData.conversational === false) usedIds = searchResult.results.all.filter(r => r.matched !== false).map(r => r.id);
    const shown = visibleSources(searchResult.results.all, usedIds);

    // Return results
    console.log('   📤 Sending response to client...');
    return res.status(200).json({
      success: true,
      query: requestData.query,
      response: conversationalResponse,
      used_ids: usedIds,
      excluded_ids: searchOptions.excludeIds,
      // Used sources first, then other matches; outcomes Claude only read as candidates are left out
      decisions: shown,
      categorized: {
        highlyRelevant: shown.filter(r => usedIds.includes(r.id)),
        relevant: shown.filter(r => !usedIds.includes(r.id)),
        somewhatRelevant: []
      },
      searchMethod: searchResult.searchMethod,
      resultsCount: shown.length,
      executedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Semantic search error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Semantic search failed',
      hint: error.message?.includes('index') ?
        'Vector search index not set up. See docs/setup-vector-search.md' : undefined
    });
  }
}

/**
 * GET /api/search-suggestions - Get search suggestions based on query
 * Helps autocomplete for common searches
 *
 * Query params:
 * - q: partial query
 * - workspace_id: required
 * - limit: max suggestions (default 5)
 */
async function handleSearchSuggestions(req, res) {
  try {
    const query = parseQueryParams(req.url);

    if (!query.q || !query.workspace_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'q and workspace_id required'
      }));
      return;
    }

    const { getDecisionsCollection } = require('../config/database');
    const decisionsCollection = getDecisionsCollection();

    // Get unique tags and epic keys that match
    const [tags, epics] = await Promise.all([
      decisionsCollection.distinct('tags', {
        workspace_id: query.workspace_id,
        tags: { $regex: query.q, $options: 'i' }
      }),
      decisionsCollection.distinct('epic_key', {
        workspace_id: query.workspace_id,
        epic_key: { $regex: query.q, $options: 'i' }
      })
    ]);

    const suggestions = [
      ...tags.map(t => ({ type: 'tag', value: t })),
      ...epics.filter(e => e).map(e => ({ type: 'epic', value: e }))
    ].slice(0, parseInt(query.limit || '5'));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      suggestions
    }));

  } catch (error) {
    console.error('Search suggestions error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to get suggestions'
    }));
  }
}

module.exports = {
  handleSemanticSearch,
  handleSearchSuggestions
};
