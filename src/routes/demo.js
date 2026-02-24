/**
 * Demo routes — "Try Demo" experience
 *
 * GET  /demo                → sets a demo session, redirects to /demo/dashboard
 * GET  /demo/dashboard      → serves the demo dashboard (no auth required)
 * GET  /demo/api/decisions  → returns demo decisions (filtered/paginated)
 * GET  /demo/api/stats      → returns demo stats
 * POST /demo/api/search     → keyword search + Claude conversational response
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/environment');
const { DEMO_WORKSPACE_ID, DEMO_WORKSPACE_NAME, DEMO_DECISIONS } = require('../data/demo-decisions');

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Simple in-memory keyword search over demo decisions.
 * Scores each decision by how many query words appear in the searchable fields.
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
 * Generate a conversational response using Claude.
 * Uses the same prompt approach as the real product — sounds like a teammate
 * recalling from memory, not a database dump.
 * Falls back to a plain-text summary if Claude is not configured.
 */
async function generateDemoResponse(query, results, conversationHistory = []) {
  // Plain-text fallback (no Claude available)
  if (!config.claude.isConfigured || results.length === 0) {
    if (results.length === 0) {
      return `Hmm, I don't see anything in Clearpath's team memory about "${query}". Try searching for "onboarding," "checkout," "pricing," "mobile," or "guest users."`;
    }
    const top = results[0];
    const rest = results.slice(1, 3);
    let reply = `On "${query}" — the clearest thing we have logged is Decision #${top.id}: "${top.text}"`;
    if (rest.length > 0) {
      reply += `\n\nRelated: ${rest.map(r => `#${r.id}: ${r.text.slice(0, 80)}…`).join('\n')}`;
    }
    return reply;
  }

  // Format results as context for the prompt — same approach as the real product
  const resultsContext = results.map(r => {
    const daysAgo = Math.floor((Date.now() - new Date(r.timestamp).getTime()) / (24 * 60 * 60 * 1000));
    const timeContext = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' :
                        daysAgo < 7 ? `${daysAgo} days ago` :
                        daysAgo < 30 ? `${Math.floor(daysAgo / 7)} weeks ago` :
                        `${Math.floor(daysAgo / 30)} months ago`;

    const alternatives = r.alternatives
      ? ` Alternatives considered / context: ${r.alternatives}`
      : '';
    const tags = (r.tags || []).length > 0
      ? ` Tags: ${r.tags.join(', ')}.`
      : '';

    return `[#${r.id}, ${r.type}, ${timeContext}] ${r.creator}: "${r.text}"${alternatives}${tags}`;
  }).join('\n\n');

  const conversationContext = conversationHistory && conversationHistory.length > 0
    ? `\n\nPrevious conversation:\n${conversationHistory.slice(-2).map(t =>
        `User: ${t.query}\nYou: ${t.response}`
      ).join('\n\n')}\n\n`
    : '';

  const prompt = `You are a knowledgeable team member at Clearpath (a B2B SaaS project management company) with perfect memory of every decision, context, and explanation your team has logged. Someone asks you a question, and you recall relevant information to answer them naturally.${conversationContext}

Question: "${query}"

What you remember:

${resultsContext}

Answer their question naturally, like a teammate would in conversation. Here's how:

1. **Answer the question directly first** — Synthesize what you know and give a clear, direct answer. Don't start by saying "I found X decisions" — that's robotic.

2. **Explain the WHY and context** — Share the reasoning, alternatives considered, trade-offs discussed. Make connections between related decisions.

3. **Reference decision numbers naturally** — Weave them into your answer like: "We went with the modal flow (Decision #6) because..." or "That's covered in Decision #5 where we..."

4. **Be conversational** — Use "we", "us", "our team". Sound like you're recalling from memory, not reading from a database.

5. **Keep it concise** — 100-150 words. Get to the point but include the important context.

DON'T do:
- "I found 5 decisions. Decision #1: ... Decision #2: ..." (too mechanical)
- Numbered lists unless explaining sequential steps
- Formal sections like "Summary:" or "Highly Relevant:"

DO:
- "We chose X over Y because... (Decision #6)"
- "From what we logged a couple months ago (Decision #8), the reason is..."

Answer as if you're a senior team member who was in all those meetings and knows the full story.`;

  try {
    const anthropic = new Anthropic({ apiKey: config.claude.apiKey });
    const message = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: 400,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }]
    });
    return message.content[0].text;
  } catch (err) {
    console.error('❌ Demo Claude response failed:', err.message);
    // Fallback on error
    const top = results[0];
    return `On "${query}": Decision #${top.id} — "${top.text}"${results.length > 1 ? ` (plus ${results.length - 1} related item${results.length > 2 ? 's' : ''})` : ''}`;
  }
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
 * Keyword search + Claude conversational response.
 * Accepts optional conversationHistory array for follow-up context.
 * Mirrors the shape of the real /api/semantic-search response.
 */
function handleDemoSearch(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    try {
      const { query, type, limit, conversationHistory } = JSON.parse(body || '{}');

      if (!query || !query.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Query is required' }));
        return;
      }

      let pool = [...DEMO_DECISIONS];
      if (type) pool = pool.filter(d => d.type === type);

      const results = keywordSearch(query.trim(), pool, limit || 8);

      // Use Claude for a real conversational response, same as the live product
      const response = await generateDemoResponse(query.trim(), results, conversationHistory || []);

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
      console.error('Demo search error:', err);
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
