const { getDecisionsCollection, getDatabase } = require('../../config/database');
const { getUserAccessibleSpaces, isAdmin } = require('../../services/permissions');

/**
 * Meetings view (docs/specs/2026-10-meetings-view.md): the person's own meetings (their
 * `ingestions`, one per person per meeting) with what came out of each, and one "Logged by hand"
 * row per day for outcomes with no meeting behind them. Outcomes count only in spaces the person
 * can see, action items there or owned by them. Queries filter on ids, user, status and dates
 * (titles and text are encrypted).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;
const MAX_INGESTIONS = 500;
const MAX_MANUAL = 500;
const DEFAULT_LIMIT = 20;
const MANUAL_PREFIX = 'manual:';
const TYPES = ['decision', 'action_item', 'open_question', 'risk'];

/** Skip reasons that "Capture anyway" can override (the others have nothing to read) */
const CAPTURABLE_SKIPS = ['one_on_one', 'excluded_title', 'too_short', 'ai_budget'];

const OUTCOME_FIELDS = {
  _id: 0, id: 1, type: 1, text: 1, rationale: 1, evidence_quote: 1, owner_name: 1, raised_by: 1, capture: 1, review_status: 1,
  resolution_status: 1, timestamp: 1, user_id: 1, space_id: 1, creator: 1, topic_id: 1, topic: 1, sensitive: 1, due_date: 1,
  'source_details.type': 1, 'source_details.title': 1, 'source_details.url': 1, 'source_details.external_id': 1
};
const ACTION_FIELDS = { _id: 0, item_id: 1, text: 1, owners: 1, owner_ids: 1, due_date: 1, status: 1, topic_id: 1, topic: 1, decision_id: 1, created_at: 1, sensitive: 1 };

const emptyCounts = () => ({ decision: 0, action_item: 0, open_question: 0, risk: 0 });
const notDismissed = { review_status: { $ne: 'dismissed' } };
const isPending = outcome => outcome.capture === 'ai' && !outcome.review_status;

/** @param {any} value @returns {number} ms, or NaN */
const timeOf = value => (value ? new Date(value).getTime() : NaN);

/**
 * Turns the person's ingestions and what's visible from each into rows, newest first (pure)
 * @param {Object} params
 * @param {any[]} params.ingestions - { external_id, title, status, skip_reason, occurred_at, created_at, updated_at, url }
 * @param {Map<string, { counts: Object, to_review: number, occurred_at: string|null, url: string|null }>} params.byMeeting
 * @param {Map<string, { counts: Object, to_review: number }>} params.manualDays - 'YYYY-MM-DD' → counts
 * @returns {Object[]} rows: { id, kind: 'meeting'|'manual', title, occurred_at, status, skip_reason, can_capture, url, counts, to_review }
 */
function buildRows({ ingestions, byMeeting, manualDays }) {
  const rows = ingestions.map(ingestion => {
    const seen = byMeeting.get(ingestion.external_id);
    const occurred = (seen && seen.occurred_at) || ingestion.occurred_at || ingestion.created_at || ingestion.updated_at || null;
    return {
      id: ingestion.external_id,
      kind: 'meeting',
      title: ingestion.title || null,
      occurred_at: occurred ? new Date(occurred).toISOString() : null,
      status: ingestion.status,
      skip_reason: ingestion.status === 'skipped' ? ingestion.skip_reason || null : null,
      can_capture: ingestion.status === 'failed' || (ingestion.status === 'skipped' && CAPTURABLE_SKIPS.includes(ingestion.skip_reason)),
      url: (seen && seen.url) || ingestion.url || null,
      counts: seen ? seen.counts : emptyCounts(),
      to_review: seen ? seen.to_review : 0
    };
  });
  for (const [day, seen] of manualDays) {
    rows.push({
      id: `${MANUAL_PREFIX}${day}`, kind: 'manual', title: null,
      // Start of that day, so it sorts under that day's meetings (newest first)
      occurred_at: new Date(`${day}T00:00:00.000Z`).toISOString(),
      status: 'completed', skip_reason: null, can_capture: false, url: null, counts: seen.counts, to_review: seen.to_review
    });
  }
  return rows.sort((a, b) => (timeOf(b.occurred_at) || 0) - (timeOf(a.occurred_at) || 0));
}

/**
 * A page of rows strictly older than `before`
 * @param {Object[]} rows - newest first
 * @param {string|null} before - ISO date
 * @param {number} limit
 * @returns {{ meetings: Object[], next_before: string|null }}
 */
function paginate(rows, before, limit) {
  const cutoff = before ? timeOf(before) : Infinity;
  const older = isNaN(cutoff) ? rows : rows.filter(row => (timeOf(row.occurred_at) || 0) < cutoff);
  const page = older.slice(0, limit);
  return { meetings: page, next_before: older.length > limit ? page[page.length - 1].occurred_at : null };
}

/** What the person can see, and whether they can review others' outcomes (admins) */
async function accessFor(workspaceId, userId) {
  const [spaceIds, admin] = await Promise.all([getUserAccessibleSpaces(null, workspaceId, userId), isAdmin(null, workspaceId, userId)]);
  return { spaceIds, admin };
}

function actionsCollection() {
  return getDatabase().collection('action_items');
}

/** Action items the person can see: in their spaces, or owned by them (not their duplicate copies) */
function visibleActions(workspaceId, userId, spaceIds) {
  return { workspace_id: workspaceId, $or: [{ space_id: { $in: spaceIds } }, { owner_ids: userId, 'owner_duplicates.user_id': { $ne: userId } }] };
}

/**
 * The person's meetings, newest first, with what came out of each
 * @param {string} workspaceId
 * @param {string} userId
 * @param {{ before?: string|null, limit?: number, now?: Date }} [options]
 * @returns {Promise<{ meetings: Object[], next_before: string|null }>}
 */
async function listMeetings(workspaceId, userId, { before = null, limit = DEFAULT_LIMIT, now = new Date() } = {}) {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const { spaceIds, admin } = await accessFor(workspaceId, userId);
  const ingestions = await getDatabase().collection('ingestions')
    .find({ workspace_id: workspaceId, user_id: userId, created_at: { $gte: since } },
      { projection: { _id: 0, external_id: 1, title: 1, status: 1, skip_reason: 1, occurred_at: 1, url: 1, created_at: 1, updated_at: 1 } })
    .sort({ created_at: -1 }).limit(MAX_INGESTIONS).toArray();
  const ids = ingestions.map(ingestion => ingestion.external_id).filter(id => typeof id === 'string');

  const inSpaces = { workspace_id: workspaceId, space_id: { $in: spaceIds }, ...notDismissed };
  const [outcomes, actions, manualOutcomes, manualActions] = await Promise.all([
    ids.length ? getDecisionsCollection().find(
      { ...inSpaces, 'source_details.external_id': { $in: ids } },
      { projection: { _id: 0, type: 1, capture: 1, review_status: 1, user_id: 1, 'source_details.external_id': 1, 'source_details.occurred_at': 1, 'source_details.url': 1 } }
    ).toArray() : [],
    ids.length ? actionsCollection().find(
      { ...visibleActions(workspaceId, userId, spaceIds), 'source.external_id': { $in: ids } },
      { projection: { _id: 0, 'source.external_id': 1 } }
    ).toArray() : [],
    // Logged by hand: the person's own outcomes with no meeting behind them
    getDecisionsCollection().find(
      { ...inSpaces, user_id: userId, timestamp: { $gte: since.toISOString() }, 'source_details.external_id': { $not: { $type: 'string' } } },
      { projection: { _id: 0, type: 1, capture: 1, review_status: 1, user_id: 1, timestamp: 1 } }
    ).limit(MAX_MANUAL).toArray(),
    actionsCollection().find(
      { ...visibleActions(workspaceId, userId, spaceIds), 'created_by.user_id': userId, created_at: { $gte: since }, 'source.external_id': { $not: { $type: 'string' } }, decision_id: null },
      { projection: { _id: 0, created_at: 1 } }
    ).limit(MAX_MANUAL).toArray()
  ]);

  const reviewable = outcome => isPending(outcome) && (admin || outcome.user_id === userId);
  /** @type {Map<string, any>} */
  const byMeeting = new Map();
  const meetingOf = id => {
    if (!byMeeting.has(id)) byMeeting.set(id, { counts: emptyCounts(), to_review: 0, occurred_at: null, url: null });
    return byMeeting.get(id);
  };
  for (const outcome of outcomes) {
    const source = outcome.source_details || {};
    const entry = meetingOf(source.external_id);
    if (TYPES.includes(outcome.type)) entry.counts[outcome.type]++;
    if (reviewable(outcome)) entry.to_review++;
    if (!entry.occurred_at && source.occurred_at) entry.occurred_at = source.occurred_at;
    if (!entry.url && typeof source.url === 'string' && /^https:\/\//.test(source.url)) entry.url = source.url;
  }
  for (const action of actions) meetingOf(action.source.external_id).counts.action_item++;

  /** @type {Map<string, any>} */
  const manualDays = new Map();
  const dayOf = day => {
    if (!manualDays.has(day)) manualDays.set(day, { counts: emptyCounts(), to_review: 0 });
    return manualDays.get(day);
  };
  for (const outcome of manualOutcomes) {
    if (!outcome.timestamp || !TYPES.includes(outcome.type)) continue;
    const entry = dayOf(new Date(outcome.timestamp).toISOString().slice(0, 10));
    entry.counts[outcome.type]++;
    if (reviewable(outcome)) entry.to_review++;
  }
  for (const action of manualActions) {
    if (action.created_at) dayOf(new Date(action.created_at).toISOString().slice(0, 10)).counts.action_item++;
  }

  const rows = buildRows({ ingestions, byMeeting, manualDays });
  return paginate(rows, before, Math.min(Math.max(1, limit), 50));
}

/**
 * What came out of one of the person's meetings (or a day's "Logged by hand")
 * @param {string} workspaceId
 * @param {string} userId
 * @param {string} meetingId - an ingestion's external_id, or 'manual:YYYY-MM-DD'
 * @returns {Promise<{ outcomes: Object[], action_items: Object[] }|null>} null when it isn't theirs
 */
async function meetingOutcomes(workspaceId, userId, meetingId) {
  if (typeof meetingId !== 'string' || !meetingId || meetingId.length > 300) return null;
  const { spaceIds, admin } = await accessFor(workspaceId, userId);
  const inSpaces = { workspace_id: workspaceId, space_id: { $in: spaceIds }, ...notDismissed };
  let outcomeFilter;
  let actionFilter;
  if (meetingId.startsWith(MANUAL_PREFIX)) {
    const day = meetingId.slice(MANUAL_PREFIX.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(start.getTime() + DAY_MS);
    outcomeFilter = { ...inSpaces, user_id: userId, 'source_details.external_id': { $not: { $type: 'string' } }, timestamp: { $gte: start.toISOString(), $lt: end.toISOString() } };
    actionFilter = { ...visibleActions(workspaceId, userId, spaceIds), 'created_by.user_id': userId, 'source.external_id': { $not: { $type: 'string' } }, decision_id: null, created_at: { $gte: start, $lt: end } };
  } else {
    const mine = await getDatabase().collection('ingestions').findOne({ workspace_id: workspaceId, user_id: userId, external_id: meetingId }, { projection: { _id: 1 } });
    if (!mine) return null;
    outcomeFilter = { ...inSpaces, 'source_details.external_id': meetingId };
    actionFilter = { ...visibleActions(workspaceId, userId, spaceIds), 'source.external_id': meetingId };
  }
  const [outcomes, actions] = await Promise.all([
    getDecisionsCollection().find(outcomeFilter, { projection: OUTCOME_FIELDS }).sort({ timestamp: -1, id: -1 }).limit(200).toArray(),
    actionsCollection().find(actionFilter, { projection: ACTION_FIELDS }).sort({ created_at: 1 }).limit(200).toArray()
  ]);
  return {
    outcomes: outcomes.map(outcome => ({
      ...outcome,
      resolution_status: outcome.resolution_status || (outcome.type === 'open_question' || outcome.type === 'risk' ? 'open' : undefined),
      can_review: isPending(outcome) && (admin || outcome.user_id === userId)
    })),
    action_items: actions.map(action => {
      const { owner_ids: ownerIds, ...rest } = action;
      return { ...rest, owners: (action.owners || []).map(owner => ({ name: (owner && owner.name) || null })), mine: (ownerIds || []).includes(userId) };
    })
  };
}

module.exports = { listMeetings, meetingOutcomes, buildRows, paginate, CAPTURABLE_SKIPS, MANUAL_PREFIX };
