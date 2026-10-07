const { getDecisionsCollection } = require('../../config/database');
const { describeLinks } = require('../links/close-links');
const { buildHeadline } = require('./headline');
const { getVoiceSetting } = require('../digest/voice-settings');
const { getUserAccessibleSpaces, isAdmin } = require('../../services/permissions');
const { listActionItems } = require('../actions/action-service');
const { listQuestionsAndRisks } = require('../decisions/questions-risks');
const { PENDING_REVIEW } = require('../decisions/review-service');

/**
 * Home overview: the three questions in one read (COR-41, docs/specs/2026-10-home-overview.md).
 *
 * - headline: the person's morning partner on where their day stands (headline.js)
 * - summary: what's open and needs the person (their action items: overdue, due today; open
 *   questions and risks, and how many were raised in the last 24 hours; outcomes to review),
 *   plus what happened in the last 24 hours (new outcomes, how many meetings)
 * - owe: their open action items, most urgent first
 * - open: open questions and risks, newest first, with when they were raised
 * - review: AI-captured outcomes nobody confirmed yet that this person can review, with their
 *   evidence, so they can be confirmed one at a time or a whole meeting at once
 *
 * Everything is limited to the spaces the person can access (plus action items they own), like
 * every other list: never a colleague's private data.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
const LIMITS = { owe: 6, open: 6, review: 20 };

// What the browser needs from an outcome: never `embedding`
const OUTCOME_FIELDS = {
  _id: 0, id: 1, type: 1, text: 1, rationale: 1, evidence_quote: 1, owner_name: 1, capture: 1, review_status: 1,
  timestamp: 1, user_id: 1, space_id: 1, creator: 1, raised_by: 1, topic_id: 1, topic: 1, resolves: 1,
  'source_details.type': 1, 'source_details.title': 1, 'source_details.url': 1, 'source_details.external_id': 1
};

/**
 * @param {string} workspaceId
 * @param {string} userId
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.today] - 'YYYY-MM-DD' in the person's time zone
 * @param {'en'|'es'} [options.lang] - the page's language (the headline's line)
 * @returns {Promise<{
 *   since: string,
 *   headline: { voice: string, situation: string, title: string|null, follow: string|null, item_id: string|null },
 *   summary: { new_outcomes: number, meetings: number, overdue: number, due_today: number, open_action_items: number, to_review: number, open_questions: number, open_risks: number, new_questions: number, new_risks: number },
 *   owe: Object[], open: Object[], review: Object[]
 * }>}
 */
async function buildHomeOverview(workspaceId, userId, { now = new Date(), today, lang = 'en' } = {}) {
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

  const [owned, questionsRisks, voiceSetting, review, toReview, recent] = await Promise.all([
    listActionItems(workspaceId, { spaceIds, viewerId: userId, ownerId: userId, status: 'open', now, today: day }),
    listQuestionsAndRisks(workspaceId, { spaceIds, type: 'all', status: 'open' }),
    getVoiceSetting(workspaceId, userId),
    decisions.find(reviewable, { projection: OUTCOME_FIELDS }).sort({ timestamp: -1 }).limit(LIMITS.review).toArray(),
    decisions.countDocuments(reviewable),
    // Ids and meeting only: counting what's new must not read outcome text
    decisions.find({ ...inSpaces, timestamp: { $gte: since } }, { projection: { _id: 0, 'source_details.external_id': 1 } }).limit(1000).toArray()
  ]);

  // What each outcome to review may close in earlier meetings (core/links), shown on the review card
  const mayClose = await describeLinks(workspaceId, review, { spaceIds, userId });
  const reviewItems = review.map(({ resolves, ...item }) => ({ ...item, may_close: mayClose.get(item.id) || [] }));

  const raisedSince = type => questionsRisks.items.filter(item => item.type === type && item.timestamp && item.timestamp >= since).length;

  const overdue = owned.filter(item => item.due_date && item.due_date < day).length;
  const dueToday = owned.filter(item => item.due_date === day).length;
  const meetings = new Set(recent.map(outcome => outcome.source_details && outcome.source_details.external_id).filter(Boolean));

  return {
    since,
    headline: buildHeadline({ voiceName: voiceSetting.voice, lang, owned, today: day, seed: `${userId}:${day}` }),
    summary: {
      new_outcomes: recent.length,
      meetings: meetings.size,
      overdue,
      due_today: dueToday,
      open_action_items: owned.length,
      to_review: toReview,
      open_questions: questionsRisks.counts.open_question || 0,
      open_risks: questionsRisks.counts.risk || 0,
      new_questions: raisedSince('open_question'),
      new_risks: raisedSince('risk')
    },
    owe: owned.slice(0, LIMITS.owe).map(item => ({
      item_id: item.item_id, text: item.text, due_date: item.due_date || null, owners: item.owners || [],
      source: item.source && item.source.title ? { title: item.source.title, url: item.source.url || null } : null,
      new_from_colleague: !!item.new_from_colleague
    })),
    // The whole outcome (same fields as the Questions page), so the detail modal opened from Home shows all of it
    open: questionsRisks.items.slice(0, LIMITS.open).map(item => ({
      ...item,
      source: item.source_details && item.source_details.title ? { title: item.source_details.title } : null
    })),
    review: reviewItems
  };
}

module.exports = { buildHomeOverview, WINDOW_MS };
