const { hybridSearch, generateConversationalResponse } = require('../services/semantic-search');
const { validateQueryParams } = require('../middleware/validation');

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
 *   "limit": 10 (optional),
 *   "conversational": true (optional, default true)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "query": "show me AEM decisions",
 *   "response": "I found 5 decisions about AEM...",
 *   "decisions": [...],
 *   "searchMethod": "semantic",
 *   "resultsCount": 5
 * }
 */
async function handleSemanticSearch(req, res) {
  try {
    // Parse request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);

        console.log('🔍 Semantic search request received:');
        console.log(`   - Query: "${requestData.query}"`);
        console.log(`   - Workspace ID: ${requestData.workspace_id}`);
        console.log(`   - Conversational: ${requestData.conversational !== false}`);

        // Validate required fields
        if (!requestData.query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Query is required'
          }));
          return;
        }

        if (!requestData.workspace_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'workspace_id is required'
          }));
          return;
        }

        // Build search options
        const searchOptions = {
          workspace_id: requestData.workspace_id,
          limit: requestData.limit || 10,
          minScore: requestData.minScore || 0.5  // Low threshold to get candidates; false positives filtered later
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
        const searchResult = await hybridSearch(requestData.query, searchOptions);

        console.log(`✅ Search completed:`);
        console.log(`   - Method: ${searchResult.searchMethod}`);
        console.log(`   - Results: ${searchResult.results.all.length}`);
        if (searchResult.results.all.length > 0) {
          console.log(`   - Top score: ${(searchResult.results.all[0].score * 100).toFixed(1)}%`);
        }

        // Generate conversational response (if requested)
        let conversationalResponse = null;
        if (requestData.conversational !== false) {
          conversationalResponse = await generateConversationalResponse(
            requestData.query,
            searchResult.results
          );
        }

        // Return results
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          query: requestData.query,
          response: conversationalResponse,
          decisions: searchResult.results.all,
          categorized: {
            highlyRelevant: searchResult.results.highlyRelevant,
            relevant: searchResult.results.relevant,
            somewhatRelevant: searchResult.results.somewhatRelevant
          },
          searchMethod: searchResult.searchMethod,
          resultsCount: searchResult.results.all.length,
          executedAt: new Date().toISOString()
        }));

      } catch (parseError) {
        console.error('Error parsing request:', parseError);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid JSON in request body'
        }));
      }
    });

  } catch (error) {
    console.error('Semantic search error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: error.message || 'Semantic search failed',
      hint: error.message.includes('index') ?
        'Vector search index not set up. See setup-vector-search.md' : undefined
    }));
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
