const { getDecisionsCollection, getDatabase } = require('../../config/database');
const { isAdmin } = require('../../services/permissions');

/**
 * The thread as a unit (docs/specs/2026-10-thread-as-unit.md):
 *   - statusFor: the line under an open question or risk ("Open 12 days · next step: Ana, due Oct 16")
 *   - buildThreadView: one thread as a timeline grouped by meeting, with its summary
 * Visibility follows spaces, like thread-service.loadThreads: outcomes in spaces the viewer can
 * access, action items there or owned by them. Sensitive items live in `private_to`'s personal
 * space, so nobody else sees them here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 100;
const QUESTION_TYPES = ['open_question', 'risk'];

/** @param {Date} now @returns {string} YYYY-MM-DD */
const todayOf = now => now.toISOString().slice(0, 10);

/**
 * Whole days since a date (0 for today or a date in the future)
 * @param {string|Date|null|undefined} value
 * @param {Date} [now]
 * @returns {number|null} null when there's no valid date
 */
function ageDays(value, now = new Date()) {
  const time = value ? new Date(value).getTime() : NaN;
  if (isNaN(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
}

/**
 * A thread's next step: its open action item with the earliest due date (no date last, then the oldest)
 * @param {{ status?: string, due_date?: string|null }[]} actions - oldest first
 * @returns {any|null}
 */
function pickNextStep(actions) {
  const open = (actions || []).filter(action => action.status === 'open');
  if (open.length === 0) return null;
  const dated = open.filter(action => action.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return dated[0] || open[0];
}

/**
 * How an action item reads as a next step
 * @param {any} action - { item_id, text, owners: [{ name }], mine, due_date }
 * @param {string} today - YYYY-MM-DD
 * @returns {{ item_id: string, text: string, owner: string|null, mine: boolean, due_date: string|null, overdue: boolean }}
 */
function describeNextStep(action, today) {
  const owner = (action.owners || []).map(o => o && o.name).find(Boolean) || null;
  return {
    item_id: action.item_id,
    text: action.text,
    owner,
    mine: Boolean(action.mine),
    due_date: action.due_date || null,
    overdue: Boolean(action.due_date && action.due_date < today)
  };
}

/**
 * The status line of an open question or risk
 * @param {{ type: string, timestamp?: string|null, resolution_status?: string }} item
 * @param {{ outcomes: any[], actions: any[] }|undefined} thread - its thread as the viewer sees it
 * @param {Date} [now]
 * @returns {{ age_days: number|null, in_thread: boolean, next_step: Object|null, may_answer: number }|null}
 *   null for anything that isn't an open question or risk
 */
function statusFor(item, thread, now = new Date()) {
  if (!QUESTION_TYPES.includes(item.type) || item.resolution_status === 'resolved') return null;
  const next = thread ? pickNextStep(thread.actions) : null;
  return {
    age_days: ageDays(item.timestamp, now),
    in_thread: Boolean(thread),
    next_step: next ? describeNextStep(next, todayOf(now)) : null,
    may_answer: thread ? thread.outcomes.filter(outcome => outcome.type === 'decision').length : 0
  };
}

/**
 * Counts for a thread's header
 * @param {any[]} outcomes - { type, resolution_status, timestamp, resolved_at }
 * @param {any[]} actions - { status, due_date, created_at, updated_at, completed_at }
 * @param {Date} [now]
 * @returns {{ open_questions: number, risks: number, next_steps: number, overdue: number, last_activity: string|null }}
 */
function summarize(outcomes, actions, now = new Date()) {
  const today = todayOf(now);
  const isOpen = outcome => outcome.resolution_status !== 'resolved';
  const openActions = actions.filter(action => action.status === 'open');
  const dates = [
    ...outcomes.flatMap(outcome => [outcome.timestamp, outcome.resolved_at]),
    ...actions.flatMap(action => [action.created_at, action.updated_at, action.completed_at])
  ].map(value => (value ? new Date(value).getTime() : NaN)).filter(time => !isNaN(time));
  return {
    open_questions: outcomes.filter(outcome => outcome.type === 'open_question' && isOpen(outcome)).length,
    risks: outcomes.filter(outcome => outcome.type === 'risk' && isOpen(outcome)).length,
    next_steps: openActions.length,
    overdue: openActions.filter(action => action.due_date && action.due_date < today).length,
    last_activity: dates.length ? new Date(Math.max(...dates)).toISOString() : null
  };
}

/**
 * Items grouped by the meeting they came from, oldest meeting first
 * @param {any[]} items - each with `meeting` (title or null) and `date`
 * @returns {{ title: string|null, date: string|null, items: any[] }[]}
 */
function groupByMeeting(items) {
  const time = item => (item.date ? new Date(item.date).getTime() : 0) || 0;
  const sorted = [...items].sort((a, b) => time(a) - time(b));
  /** @type {Map<string, { title: string|null, date: string|null, items: any[] }>} */
  const groups = new Map();
  for (const item of sorted) {
    const day = item.date ? new Date(item.date).toISOString().slice(0, 10) : '';
    const key = `${item.meeting || ''}|${day}`;
    if (!groups.has(key)) groups.set(key, { title: item.meeting || null, date: item.date ? new Date(item.date).toISOString() : null, items: [] });
    /** @type {{ items: any[] }} */ (groups.get(key)).items.push(item);
  }
  return [...groups.values()];
}

const OUTCOME_FIELDS = {
  _id: 0, id: 1, type: 1, text: 1, owner_name: 1, user_id: 1, source_details: 1, timestamp: 1, sensitive: 1,
  resolution_status: 1, resolution_note: 1, resolved_by: 1, resolved_at: 1, answered_by: 1, topic: 1
};
const ACTION_FIELDS = {
  _id: 0, item_id: 1, text: 1, owners: 1, owner_ids: 1, created_by: 1, due_date: 1, status: 1, source: 1, sensitive: 1,
  decision_id: 1, created_at: 1, updated_at: 1, completed_at: 1, topic: 1
};

/**
 * One thread as the viewer sees it: summary, and every item grouped by meeting
 * @param {string} workspaceId
 * @param {string} topicId
 * @param {{ spaceIds: string[], viewerId: string }} access
 * @param {{ now?: Date, admin?: boolean }} [options] - admin: skip the lookup (tests)
 * @returns {Promise<Object|null>} null when the viewer can see nothing of it
 */
async function buildThreadView(workspaceId, topicId, { spaceIds, viewerId }, options = {}) {
  if (typeof topicId !== 'string' || !topicId) return null;
  const now = options.now || new Date();
  const [outcomes, actions] = await Promise.all([
    getDecisionsCollection()
      .find({ workspace_id: workspaceId, topic_id: topicId, space_id: { $in: spaceIds || [] } }, { projection: OUTCOME_FIELDS })
      .sort({ timestamp: 1, id: 1 }).limit(MAX_ITEMS).toArray(),
    getDatabase().collection('action_items')
      .find({
        workspace_id: workspaceId,
        topic_id: topicId,
        $or: [{ space_id: { $in: spaceIds || [] } }, { owner_ids: viewerId, 'owner_duplicates.user_id': { $ne: viewerId } }]
      }, { projection: ACTION_FIELDS })
      .sort({ created_at: 1 }).limit(MAX_ITEMS).toArray()
  ]);
  if (outcomes.length + actions.length === 0) return null;

  const admin = options.admin !== undefined ? options.admin : await isAdmin(null, workspaceId, viewerId);
  const actionRows = actions.map(action => ({
    kind: 'action_item',
    id: action.item_id,
    item_id: action.item_id,
    type: 'action_item',
    text: action.text,
    owners: (action.owners || []).map(owner => ({ name: (owner && owner.name) || null })),
    mine: (action.owner_ids || []).includes(viewerId),
    due_date: action.due_date || null,
    status: action.status,
    sensitive: Boolean(action.sensitive),
    decision_id: action.decision_id || null,
    meeting: (action.source && action.source.title) || null,
    date: (action.source && action.source.occurred_at) || action.created_at || null,
    created_at: action.created_at, updated_at: action.updated_at, completed_at: action.completed_at,
    can_edit: admin || (action.owner_ids || []).includes(viewerId) || (action.created_by && action.created_by.user_id) === viewerId
  }));
  const thread = { outcomes, actions: actionRows };
  const outcomeRows = outcomes.map(outcome => {
    const resolution = outcome.resolution_status || 'open';
    return {
      kind: 'decision',
      id: outcome.id,
      type: outcome.type,
      text: outcome.text,
      owner_name: outcome.owner_name || null,
      sensitive: Boolean(outcome.sensitive),
      resolution_status: resolution,
      resolution_note: outcome.resolution_note || null,
      resolved_by: outcome.resolved_by || null,
      resolved_at: outcome.resolved_at || null,
      answered_by: outcome.answered_by || null,
      meeting: (outcome.source_details && outcome.source_details.title) || null,
      url: outcome.source_details && typeof outcome.source_details.url === 'string' && /^https:\/\//.test(outcome.source_details.url) ? outcome.source_details.url : null,
      date: outcome.timestamp || null,
      timestamp: outcome.timestamp || null,
      status: statusFor({ ...outcome, resolution_status: resolution }, thread, now),
      can_edit: admin || outcome.user_id === viewerId
    };
  });

  const topic = outcomes.find(outcome => outcome.topic)?.topic || actions.find(action => action.topic)?.topic || null;
  const meetings = groupByMeeting([...outcomeRows, ...actionRows]).map(group => ({
    ...group,
    items: group.items.map(item => {
      const row = { ...item };
      delete row.created_at; delete row.updated_at; delete row.completed_at;
      return row;
    })
  }));
  return { topic_id: topicId, topic, summary: summarize(outcomes, actionRows, now), meetings };
}

module.exports = { ageDays, pickNextStep, describeNextStep, statusFor, summarize, groupByMeeting, buildThreadView };
