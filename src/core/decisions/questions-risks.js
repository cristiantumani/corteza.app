const { getDecisionsCollection } = require('../../config/database');

/**
 * Open questions and risks: the outcomes that need a follow-up (an answer, or a way to
 * mitigate them). They're decisions with `type: 'open_question'` or `'risk'`; this adds a
 * lifecycle on top:
 *
 *   resolution_status: 'open' (also when missing) | 'resolved'
 *   resolution_note: how it was answered or mitigated (optional, at most 1000 characters)
 *   resolved_by: { user_id, name }, resolved_at
 *
 * "Resolved" reads "Answered" for a question and "Mitigated" for a risk in the UI.
 * Visibility follows spaces, like every outcome: the caller passes the spaces the viewer
 * can access.
 */

const TYPES = ['open_question', 'risk'];
const STATUSES = ['open', 'resolved'];
const MAX_NOTE = 1000;
const LIST_LIMIT = 300;

/** Fields the page needs (never the embedding) */
const PROJECTION = {
  _id: 0, id: 1, type: 1, text: 1, rationale: 1, evidence_quote: 1, owner_name: 1, space_id: 1, space_name: 1,
  source_details: 1, timestamp: 1, capture: 1, review_status: 1, creator: 1, raised_by: 1, user_id: 1,
  resolution_status: 1, resolution_note: 1, resolved_by: 1, resolved_at: 1, topic_id: 1, topic: 1
};

/**
 * Lists open questions and risks, newest first
 * @param {string} workspaceId
 * @param {Object} filters
 * @param {string[]} filters.spaceIds - spaces the viewer can access
 * @param {'open_question'|'risk'|'all'} [filters.type='all']
 * @param {'open'|'resolved'|'all'} [filters.status='open']
 * @param {string|null} [filters.topicId] - only this thread (core/topics)
 * @returns {Promise<{ items: Object[], counts: { open_question: number, risk: number } }>}
 *   counts: open ones by type, whatever the filters (for the tabs)
 */
async function listQuestionsAndRisks(workspaceId, { spaceIds, type = 'all', status = 'open', topicId = null }) {
  const base = { workspace_id: workspaceId, space_id: { $in: spaceIds || [] } };
  /** @type {Record<string, any>} */
  const query = { ...base, type: TYPES.includes(type) ? type : { $in: TYPES } };
  if (status === 'open') query.resolution_status = { $ne: 'resolved' };
  if (status === 'resolved') query.resolution_status = 'resolved';
  if (topicId) query.topic_id = topicId;

  const [items, openCounts] = await Promise.all([
    getDecisionsCollection().find(query, { projection: PROJECTION }).sort({ timestamp: -1, id: -1 }).limit(LIST_LIMIT).toArray(),
    getDecisionsCollection().aggregate([
      { $match: { ...base, type: { $in: TYPES }, resolution_status: { $ne: 'resolved' } } },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]).toArray()
  ]);
  const counts = { open_question: 0, risk: 0 };
  for (const row of openCounts) counts[row._id] = row.count;
  return { items: items.map(item => ({ ...item, resolution_status: item.resolution_status || 'open' })), counts };
}

/**
 * Marks a question answered or a risk mitigated, or reopens it
 * @param {Object} decision - the stored outcome (the caller checked access)
 * @param {'resolved'|'open'} status
 * @param {{ user_id: string, name?: string|null }} user
 * @param {unknown} [note] - how it was answered or mitigated
 * @returns {Promise<Object|{ error: string }>} the updated fields
 */
async function setResolution(decision, status, user, note) {
  if (!TYPES.includes(decision.type)) return { error: 'Only open questions and risks can be resolved' };
  if (!STATUSES.includes(status)) return { error: 'Invalid status' };
  const fields = status === 'resolved'
    ? {
      resolution_status: 'resolved',
      resolution_note: typeof note === 'string' && note.trim() ? note.trim().slice(0, MAX_NOTE) : null,
      resolved_by: { user_id: user.user_id, name: user.name || null },
      resolved_at: new Date()
    }
    : { resolution_status: 'open', resolution_note: null, resolved_by: null, resolved_at: null };
  await getDecisionsCollection().updateOne({ workspace_id: decision.workspace_id, id: decision.id }, { $set: fields });
  return fields;
}

module.exports = { listQuestionsAndRisks, setResolution, TYPES, STATUSES, MAX_NOTE };
