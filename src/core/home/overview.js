const { getDecisionsCollection } = require('../../config/database');
const { getUserAccessibleSpaces, isAdmin } = require('../../services/permissions');
const { listActionItems } = require('../actions/action-service');
const { listQuestionsAndRisks } = require('../decisions/questions-risks');
const { PENDING_REVIEW } = require('../decisions/review-service');

/**
 * Home overview: the three questions in one read (COR-41, docs/specs/2026-10-home-overview.md).
 *
 * - summary: what happened in the last 24 hours (new outcomes, how many meetings they came
 *   from) and what needs the person now (overdue action items, outcomes to review)
 * - owe: their open action items, most urgent first
 * - open: open questions and risks, newest first, with when they were raised
 * - decided: the latest decisions someone confirmed or logged by hand
 * - review: AI-captured outcomes nobody confirmed yet that this person can review, with their
 *   evidence, so they can be confirmed one at a time or a whole meeting at once
 *
 * Everything is limited to the spaces the person can access (plus action items they own), like
 * every other list: never a colleague's private data.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
const LIMITS = { owe: 6, open: 6, decided: 5, review: 20 };

// What the browser needs from an outcome: never `embedding`
const OUTCOME_FIELDS = {
  _id: 0, id: 1, type: 1, text: 1, rationale: 1, evidence_quote: 1, owner_name: 1, capture: 1, review_status: 1,
  timestamp: 1, user_id: 1, space_id: 1, creator: 1, topic_id: 1, topic: 1,
  'source_details.type': 1, 'source_details.title': 1, 'source_details.url': 1, 'source_details.external_id': 1
};

/**
 * @param {string} workspaceId
 * @param {string} userId
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.today] - 'YYYY-MM-DD' in the person's time zone
 * @returns {Promise<{
 *   since: string,
 *   summary: { new_outcomes: number, meetings: number, overdue: number, due_today: number, open_action_items: number, to_review: number, open_questions: number, open_risks: number },
 *   owe: Object[], open: Object[], decided: Object[], review: Object[]
 * }>}
 */
async function buildHomeOverview(workspaceId, userId, { now = new Date(), today } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today || '') ? today : now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const [spaceIds, admin] = await Promise.all([
    getUserAccessibleSpaces(null, workspaceId, userId),
    isAdmin(null, workspaceId, userId)
  ]);
  const decisions = getDecisionsCollection();
  const inSpaces = { workspace_id: workspaceId, space_id: { $in: spaceIds } };
  // Review needs the same right as editing: your own outcomes, or any as an admin (decision-review.js)
  const reviewable = { ...inSpaces, ...PENDING_REVIEW, ...(admin ? {} : { user_id: userId }) };

  const [owned, questionsRisks, decided, review, toReview, recent] = await Promise.all([
    listActionItems(workspaceId, { spaceIds, viewerId: userId, ownerId: userId, status: 'open', now, today: day }),
    listQuestionsAndRisks(workspaceId, { spaceIds, type: 'all', status: 'open' }),
    decisions.find(
      { ...inSpaces, type: 'decision', $or: [{ capture: { $ne: 'ai' } }, { review_status: 'confirmed' }] },
      { projection: OUTCOME_FIELDS }
    ).sort({ timestamp: -1 }).limit(LIMITS.decided).toArray(),
    decisions.find(reviewable, { projection: OUTCOME_FIELDS }).sort({ timestamp: -1 }).limit(LIMITS.review).toArray(),
    decisions.countDocuments(reviewable),
    // Ids and meeting only: counting what's new must not read outcome text
    decisions.find({ ...inSpaces, timestamp: { $gte: since } }, { projection: { _id: 0, 'source_details.external_id': 1 } }).limit(1000).toArray()
  ]);

  const overdue = owned.filter(item => item.due_date && item.due_date < day).length;
  const dueToday = owned.filter(item => item.due_date === day).length;
  const meetings = new Set(recent.map(outcome => outcome.source_details && outcome.source_details.external_id).filter(Boolean));

  return {
    since,
    summary: {
      new_outcomes: recent.length,
      meetings: meetings.size,
      overdue,
      due_today: dueToday,
      open_action_items: owned.length,
      to_review: toReview,
      open_questions: questionsRisks.counts.open_question || 0,
      open_risks: questionsRisks.counts.risk || 0
    },
    owe: owned.slice(0, LIMITS.owe).map(item => ({
      item_id: item.item_id, text: item.text, due_date: item.due_date || null, owners: item.owners || [],
      source: item.source && item.source.title ? { title: item.source.title, url: item.source.url || null } : null,
      new_from_colleague: !!item.new_from_colleague
    })),
    open: questionsRisks.items.slice(0, LIMITS.open).map(item => ({
      id: item.id, type: item.type, text: item.text, timestamp: item.timestamp,
      source: item.source_details && item.source_details.title ? { title: item.source_details.title } : null
    })),
    decided,
    review
  };
}

module.exports = { buildHomeOverview, WINDOW_MS };
