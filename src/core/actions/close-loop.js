const { getDatabase, getDecisionsCollection } = require('../../config/database');

/**
 * What an action item's open questions and risks are, for closing the loop when it's done or
 * cancelled (docs/specs/2026-10-close-loop-actions.md). Corteza only suggests; the page asks.
 *
 * Related: the open questions and risks of the item's thread; else of the outcome it carries
 * out (that outcome's thread, or its meeting, plus the outcome itself when it's a question or
 * risk); else nothing. Only outcomes in the person's spaces.
 */

const MAX_RELATED = 6;
const OPEN_TYPES = ['open_question', 'risk'];
const FIELDS = { _id: 0, id: 1, type: 1, text: 1 };

/**
 * @typedef {Object} LoopGroup - what ties the item to its questions and risks
 * @property {string|null} topicId
 * @property {string|null} meetingId - source_details.external_id of the outcome it carries out
 * @property {number|null} decisionId
 *
 * @typedef {{ id: number, type: string, text: string }} LoopOutcome
 */

function openOutcomes(workspaceId, spaceIds, extra) {
  return getDecisionsCollection().find(
    { workspace_id: workspaceId, space_id: { $in: spaceIds }, type: { $in: OPEN_TYPES }, resolution_status: { $ne: 'resolved' }, review_status: { $ne: 'dismissed' }, ...extra },
    { projection: FIELDS }
  ).sort({ id: 1 }).limit(MAX_RELATED * 2).toArray();
}

/**
 * The open questions and risks related to an action item
 * @param {string} workspaceId
 * @param {{ topic_id?: string|null, decision_id?: number|null }} item
 * @param {{ spaceIds: string[] }} access
 * @returns {Promise<{ group: LoopGroup|null, outcomes: LoopOutcome[] }>}
 */
async function relatedOutcomes(workspaceId, item, { spaceIds }) {
  if (!spaceIds || spaceIds.length === 0) return { group: null, outcomes: [] };
  let group = null;
  let found = [];
  if (typeof item.topic_id === 'string' && item.topic_id) {
    group = { topicId: item.topic_id, meetingId: null, decisionId: null };
    found = await openOutcomes(workspaceId, spaceIds, { topic_id: item.topic_id });
  } else if (typeof item.decision_id === 'number') {
    const origin = await getDecisionsCollection().findOne(
      { workspace_id: workspaceId, id: item.decision_id, space_id: { $in: spaceIds } },
      { projection: { _id: 0, id: 1, type: 1, text: 1, topic_id: 1, source_details: 1, resolution_status: 1, review_status: 1 } }
    );
    if (!origin) return { group: null, outcomes: [] };
    const meetingId = origin.source_details && typeof origin.source_details.external_id === 'string' ? origin.source_details.external_id : null;
    group = { topicId: origin.topic_id || null, meetingId: origin.topic_id ? null : meetingId, decisionId: origin.id };
    if (origin.topic_id) found = await openOutcomes(workspaceId, spaceIds, { topic_id: origin.topic_id });
    else if (meetingId) found = await openOutcomes(workspaceId, spaceIds, { 'source_details.external_id': meetingId });
    const originOpen = OPEN_TYPES.includes(origin.type) && origin.resolution_status !== 'resolved' && origin.review_status !== 'dismissed';
    if (originOpen && !found.some(outcome => outcome.id === origin.id)) found.push({ id: origin.id, type: origin.type, text: origin.text });
  }
  // Questions first, then risks, oldest first
  const outcomes = found
    .sort((a, b) => (a.type === b.type ? a.id - b.id : a.type === 'open_question' ? -1 : 1))
    .slice(0, MAX_RELATED);
  return { group, outcomes };
}

/**
 * The related questions and risks a cancelled item leaves with no open action item (that the
 * person can see) in its thread or meeting
 * @param {string} workspaceId
 * @param {{ item_id: string, topic_id?: string|null, decision_id?: number|null }} item
 * @param {{ spaceIds: string[], userId: string }} access
 * @returns {Promise<LoopOutcome[]>}
 */
async function orphanedBy(workspaceId, item, { spaceIds, userId }) {
  const { group, outcomes } = await relatedOutcomes(workspaceId, item, { spaceIds });
  if (!group || outcomes.length === 0) return [];
  const ties = [];
  if (group.topicId) ties.push({ topic_id: group.topicId });
  if (group.decisionId !== null) ties.push({ decision_id: group.decisionId });
  if (group.meetingId) ties.push({ 'source.external_id': group.meetingId });
  // Items linked to one of the questions or risks themselves count too
  ties.push({ decision_id: { $in: outcomes.map(outcome => outcome.id) } });
  const stillOpen = await getDatabase().collection('action_items').countDocuments({
    workspace_id: workspaceId,
    item_id: { $ne: item.item_id },
    status: 'open',
    $and: [{ $or: ties }, { $or: [{ space_id: { $in: spaceIds } }, { owner_ids: userId }] }]
  });
  return stillOpen > 0 ? [] : outcomes;
}

module.exports = { relatedOutcomes, orphanedBy, MAX_RELATED };
