const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { getDatabase, getDecisionsCollection } = require('../config/database');

/**
 * Search → "Is this source related to your question?"
 *
 *   POST /api/search-feedback   { query, decision_id, relevant: true|false }
 *
 * Kept in `search_feedback` ({ workspace_id, user_id, query, decision_id, relevant,
 * created_at, updated_at }; one row per user + query + source) to tune search later.
 * Leaving an unrelated source out of the answer is done by the page, which asks
 * /api/semantic-search again with exclude_ids.
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.post('/api/search-feedback', apiRateLimiter, express.json(), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const { query, decision_id, relevant } = req.body || {};
    const decisionId = Number(decision_id);
    const cleanQuery = typeof query === 'string' ? query.trim().slice(0, 500) : '';
    if (!cleanQuery || !Number.isInteger(decisionId) || typeof relevant !== 'boolean') {
      return res.status(400).json({ success: false, error: 'query, decision_id and relevant are required' });
    }

    const decision = await getDecisionsCollection().findOne({ workspace_id, id: decisionId }, { projection: { _id: 1 } });
    if (!decision) return res.status(404).json({ success: false, error: 'Source not found' });

    const now = new Date();
    await getDatabase().collection('search_feedback').updateOne(
      { workspace_id, user_id, query: cleanQuery, decision_id: decisionId },
      { $set: { relevant, updated_at: now }, $setOnInsert: { created_at: now } },
      { upsert: true }
    );
    console.log(`🔎 Search feedback: #${decisionId} ${relevant ? 'related' : 'not related'} to "${cleanQuery.slice(0, 60)}" (${user_id})`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to save search feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to save feedback' });
  }
});

module.exports = router;
