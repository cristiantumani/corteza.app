/**
 * Demo routes — "Try Demo" experience
 *
 * GET  /demo                → sets a demo session, redirects to /demo/dashboard
 * GET  /demo/dashboard      → serves the demo dashboard (no auth required)
 * GET  /demo/api/decisions  → returns demo decisions (filtered/paginated)
 * GET  /demo/api/stats      → returns demo stats
 * POST /demo/api/search     → keyword search over demo decisions (no embeddings needed)
 */

const fs = require('fs');
const path = require('path');
const { DEMO_WORKSPACE_ID, DEMO_WORKSPACE_NAME, DEMO_DECISIONS } = require('../data/demo-decisions');

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Simple in-memory keyword search over demo decisions.
 * Scores each decision by how many query words appear in the searchable fields.
 * Falls back gracefully when semantic search / OpenAI is not available.
 */
function keywordSearch(query, decisions, limit = 10) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return decisions.slice(0, limit);

  const scored = decisions.map(d => {
    const haystack = [
      d.text,
      d.alternatives || '',
      (d.tags || []).join(' '),
      d.category || '',
      d.type,
      d.creator,
      d.epic_key || ''
    ].join(' ').toLowerCase();

    const score = words.reduce((acc, w) => {
      const re = new RegExp(escapeRegex(w), 'g');
      const matches = (haystack.match(re) || []).length;
      return acc + matches;
    }, 0);

    return { ...d, _score: score };
  });

  return scored
    .filter(d => d._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...d }) => ({ ...d, score: Math.min(_score / 5, 1) }));
}

/**
 * Generates a plain-language summary for demo search results.
 * No Claude API call needed — keeps the demo fast and free.
 */
function summarizeResults(query, results) {
  if (results.length === 0) {
    return `I didn't find anything specifically about "${query}" in the Clearpath team's memory. Try searching for "onboarding," "checkout," "pricing," "mobile," or "search."`;
  }

  const typeCount = results.reduce((acc, d) => {
    acc[d.type] = (acc[d.type] || 0) + 1;
    return acc;
  }, {});

  const parts = Object.entries(typeCount).map(([type, count]) => {
    const label = type === 'decision' ? 'decision' : type === 'explanation' ? 'explanation' : 'piece of context';
    return `${count} ${label}${count > 1 ? 's' : ''}`;
  });

  const topResult = results[0];
  return `I found ${results.length} item${results.length > 1 ? 's' : ''} related to "${query}" — ${parts.join(', ')}. The most relevant one: "${topResult.text.slice(0, 120)}${topResult.text.length > 120 ? '…' : ''}"`;
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * GET /demo
 * Sets a demo session flag and redirects to the demo dashboard.
 */
function handleDemoEntry(req, res) {
  req.session.isDemo = true;
  req.session.user = {
    user_id: 'demo_visitor',
    user_name: 'Demo User',
    workspace_id: DEMO_WORKSPACE_ID,
    workspace_name: DEMO_WORKSPACE_NAME,
    is_demo: true
  };

  req.session.save((err) => {
    if (err) {
      console.error('❌ Demo session save failed:', err);
    }
    res.redirect('/demo/dashboard');
  });
}

/**
 * GET /demo/dashboard
 * Serves the demo-specific dashboard HTML.
 */
const demoDashboardHTML = fs.readFileSync(
  path.join(__dirname, '../views/demo-dashboard.html'),
  'utf8'
);

function handleDemoDashboard(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(demoDashboardHTML);
}

/**
 * GET /demo/api/decisions
 * Returns demo decisions, supporting the same query params as the real API.
 * Supports: type, category, search, page, limit
 */
function handleDemoDecisions(req, res) {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const params = Object.fromEntries(urlObj.searchParams.entries());

    let results = [...DEMO_DECISIONS];

    // Filter by type
    if (params.type) {
      results = results.filter(d => d.type === params.type);
    }

    // Filter by category
    if (params.category) {
      results = results.filter(d => d.category === params.category);
    }

    // Keyword search
    if (params.search && params.search.trim()) {
      const needle = params.search.trim().toLowerCase();
      results = results.filter(d => {
        const haystack = [d.text, d.alternatives || '', (d.tags || []).join(' '), d.creator].join(' ').toLowerCase();
        return haystack.includes(needle);
      });
    }

    // Sort newest first
    results = results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const page = Math.max(1, parseInt(params.page || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(params.limit || '20')));
    const total = results.length;
    const paginated = results.slice((page - 1) * limit, page * limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      decisions: paginated,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch demo decisions' }));
  }
}

/**
 * GET /demo/api/stats
 * Returns stats computed from the demo dataset.
 */
function handleDemoStats(req, res) {
  const total = DEMO_DECISIONS.length;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const byType = DEMO_DECISIONS.reduce((acc, d) => {
    acc[d.type] = (acc[d.type] || 0) + 1;
    return acc;
  }, {});

  const byCategory = DEMO_DECISIONS.reduce((acc, d) => {
    if (d.category) acc[d.category] = (acc[d.category] || 0) + 1;
    return acc;
  }, {});

  const lastWeek = DEMO_DECISIONS.filter(d => d.timestamp >= oneWeekAgo).length;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ total, byType, byCategory, lastWeek }));
}

/**
 * POST /demo/api/search
 * Keyword-based search with a plain-language summary.
 * Mirrors the shape of the real /api/semantic-search response.
 */
function handleDemoSearch(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try {
      const { query, type, limit } = JSON.parse(body || '{}');

      if (!query || !query.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Query is required' }));
        return;
      }

      let pool = [...DEMO_DECISIONS];
      if (type) pool = pool.filter(d => d.type === type);

      const results = keywordSearch(query.trim(), pool, limit || 10);
      const response = summarizeResults(query.trim(), results);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        query: query.trim(),
        response,
        decisions: results,
        categorized: {
          highlyRelevant: results.filter(d => (d.score || 0) >= 0.7),
          relevant: results.filter(d => (d.score || 0) >= 0.4 && (d.score || 0) < 0.7),
          somewhatRelevant: results.filter(d => (d.score || 0) < 0.4)
        },
        searchMethod: 'keyword',
        resultsCount: results.length,
        isDemo: true
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Search failed' }));
    }
  });
}

module.exports = {
  handleDemoEntry,
  handleDemoDashboard,
  handleDemoDecisions,
  handleDemoStats,
  handleDemoSearch
};
