const { getDatabase, getDecisionsCollection } = require('../../config/database');
const { generateDecisionEmbedding, isEmbeddingsEnabled } = require('../../services/embeddings');

/**
 * Decisions: the single write path for new decisions.
 *
 * New code creates decisions only through createDecision(). Older write sites
 * (Slack, dashboard, web suggestions) still insert directly and move here in
 * Phase 1; they use "find last id + 1", which nextDecisionId() stays compatible with.
 */

const VALID_TYPES = ['decision', 'explanation', 'context', 'learning', 'risk', 'assumption'];

/**
 * Next per-workspace decision number, atomically.
 * The counter is bumped past the highest existing id first, so it never
 * hands out an id that older code paths already used.
 * @param {string} workspaceId
 * @returns {Promise<number>}
 */
async function nextDecisionId(workspaceId) {
  const [last] = await getDecisionsCollection()
    .find({ workspace_id: workspaceId })
    .sort({ id: -1 })
    .limit(1)
    .project({ id: 1 })
    .toArray();
  const highestUsed = last?.id || 0;

  const counter = await getDatabase().collection('counters').findOneAndUpdate(
    { _id: `decision:${workspaceId}` },
    [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, highestUsed] }, 1] } } }],
    { upsert: true, returnDocument: 'after' }
  );
  return counter.seq;
}

/**
 * Creates a decision
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {string} params.spaceId - required (see ensureDefaultSpace)
 * @param {string} [params.spaceName]
 * @param {string} params.text
 * @param {string} [params.type='decision']
 * @param {string[]} [params.tags]
 * @param {string|null} [params.epicKey]
 * @param {string|null} [params.alternatives] - free-text context shown with the decision
 * @param {Object} params.author - { user_id, name } (who it's attributed to)
 * @param {Object} params.source - { type: 'google_meet'|'slack'|'dashboard'|'extension'|'api'|'upload', external_id?, title?, url? }
 * @param {'ai'|'manual'} [params.capture='manual']
 * @param {number|null} [params.confidence] - AI confidence 0–1
 * @returns {Promise<Object>} The saved decision
 */
async function createDecision({
  workspaceId, spaceId, spaceName = null, text, type = 'decision', tags = [], epicKey = null,
  alternatives = null, author, source, capture = 'manual', confidence = null
}) {
  if (!workspaceId || !spaceId) throw new Error('createDecision requires workspaceId and spaceId');
  if (!text || !text.trim()) throw new Error('createDecision requires text');

  const now = new Date();
  const decision = {
    workspace_id: workspaceId,
    space_id: spaceId,
    space_name: spaceName,
    id: await nextDecisionId(workspaceId),
    text: text.trim(),
    type: VALID_TYPES.includes(type) ? type : 'decision',
    tags: Array.isArray(tags) ? tags : [],
    epic_key: epicKey || null,
    alternatives: alternatives || null,
    user_id: author?.user_id || null,
    creator: author?.name || 'Corteza',
    source: source?.type || 'dashboard',
    source_details: source ? { ...source } : null,
    capture,
    confidence: typeof confidence === 'number' ? confidence : null,
    timestamp: now.toISOString(),
    created_at: now
  };

  const decisionsCollection = getDecisionsCollection();
  await decisionsCollection.insertOne(decision);

  // Embedding for semantic search (non-blocking)
  if (isEmbeddingsEnabled()) {
    generateDecisionEmbedding(decision)
      .then(embedding => decisionsCollection.updateOne({ _id: decision._id }, { $set: { embedding } }))
      .catch(error => console.error('Embedding generation failed:', error.message));
  }

  return decision;
}

module.exports = {
  createDecision,
  nextDecisionId,
  VALID_TYPES
};
