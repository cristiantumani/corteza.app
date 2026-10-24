const { getDatabase, getWorkspaceMembersCollection } = require('../../config/database');
const { getUserAccessibleSpaces } = require('../../services/permissions');
const { listActionItems } = require('../../core/actions/action-service');
const { buildThreadView } = require('../../core/topics/thread-view');
const { buildToday } = require('../../core/home/today');
const { listMeetings, meetingOutcomes } = require('../../core/meetings/meetings');
const { getTimeZone, localTime } = require('../../core/users/timezone');

/**
 * What the MCP connector's tools return (docs/specs/2026-10-mcp-connector.md). Read-only, and each
 * one acts as the person behind the token: the same spaces and action items they see in the app,
 * through the same services. Sensitive outcomes and action items never leave (v1), even their own.
 *
 * Results are compact objects for an AI assistant to read: the outcome's own words (headline, why),
 * who and when, the meeting it came from, and a link to open it in Corteza. No embeddings, no quotes
 * beyond what a card shows, no internal fields.
 */

const MAX_ITEMS = 20;
const SEARCH_MODULE = '../../services/semantic-search';
const TOPIC_ID = /^top_[a-f0-9]{8,32}$/;
const OUTCOME_TYPES = ['decision', 'open_question', 'risk'];

/** @returns {string} */
function appUrl() {
  return (process.env.BASE_URL || 'https://app.corteza.app').replace(/\/+$/, '');
}

/**
 * @typedef {Object} Caller
 * @property {string} workspaceId
 * @property {string} userId
 */

/** @param {Caller} caller @returns {Promise<string[]>} */
function spacesOf(caller) {
  return getUserAccessibleSpaces(null, caller.workspaceId, caller.userId);
}

/**
 * Ids of the given outcomes and action items that are sensitive (to leave out)
 * @param {string} workspaceId
 * @param {{ decisionIds?: number[], itemIds?: string[] }} ids
 * @returns {Promise<{ decisions: Set<number>, items: Set<string> }>}
 */
async function sensitiveIds(workspaceId, { decisionIds = [], itemIds = [] }) {
  const db = getDatabase();
  const [decisions, items] = await Promise.all([
    decisionIds.length ? db.collection('decisions').find({ workspace_id: workspaceId, id: { $in: decisionIds }, sensitive: true }, { projection: { _id: 0, id: 1 } }).toArray() : [],
    itemIds.length ? db.collection('action_items').find({ workspace_id: workspaceId, item_id: { $in: itemIds }, sensitive: true }, { projection: { _id: 0, item_id: 1 } }).toArray() : []
  ]);
  return { decisions: new Set(decisions.map(d => d.id)), items: new Set(items.map(i => i.item_id)) };
}

/** Link to open an outcome in Corteza */
function outcomeLink(outcome) {
  if (outcome.type === 'open_question' || outcome.type === 'risk') return `${appUrl()}/questions?item=${encodeURIComponent(outcome.id)}`;
  const meeting = outcome.source_details && outcome.source_details.external_id;
  return meeting ? `${appUrl()}/dashboard?tab=meetings&meeting=${encodeURIComponent(meeting)}` : `${appUrl()}/dashboard`;
}

/** An outcome as the assistant sees it */
function outcomeCard(outcome) {
  const source = outcome.source_details || {};
  return {
    id: outcome.id,
    type: outcome.type || 'decision',
    headline: outcome.text,
    why: outcome.rationale || null,
    owner: outcome.owner_name || null,
    raised_by: outcome.raised_by || null,
    status: outcome.resolution_status || (outcome.type === 'decision' ? null : 'open'),
    answer_or_mitigation: outcome.resolution_note || null,
    topic: outcome.topic || null,
    topic_id: outcome.topic_id || null,
    meeting: source.title || null,
    date: outcome.timestamp || source.occurred_at || null,
    link: outcomeLink(outcome)
  };
}

/** An action item as the assistant sees it */
function actionCard(item) {
  return {
    id: item.item_id,
    type: 'action_item',
    task: item.text,
    why: item.rationale || null,
    owners: (item.owners || []).map(owner => owner.name).filter(Boolean),
    due_date: item.due_date || null,
    status: item.status,
    next_step_on: item.next_step_on || null,
    topic: item.topic || null,
    topic_id: item.topic_id || null,
    meeting: (item.source && item.source.title) || null,
    link: `${appUrl()}/actions?item=${encodeURIComponent(item.item_id)}`
  };
}

/**
 * search_outcomes: outcomes that match a question, most relevant first, across the person's spaces.
 * Sources only: the assistant writes the answer (no Claude call here; embeddings at most).
 * @param {Caller} caller
 * @param {{ query: string, type?: string, limit?: number }} args
 */
async function searchOutcomes(caller, { query, type, limit = 10 }) {
  // services/ isn't type-checked yet (tsconfig): loaded by a computed path so tsc doesn't pull it in
  const { hybridSearch } = require(SEARCH_MODULE);
  const max = Math.min(Math.max(1, Number(limit) || 10), MAX_ITEMS);
  const spaceIds = await spacesOf(caller);
  const found = new Map();
  for (const spaceId of spaceIds) {
    const { results } = await hybridSearch(query, { workspace_id: caller.workspaceId, space_id: spaceId, type: OUTCOME_TYPES.includes(String(type)) ? type : undefined, limit: max });
    for (const result of results.all || []) {
      // Only real matches (not the latest outcomes Search adds for its own answer to choose from)
      if (result.matched === false || result.type === 'action_item') continue;
      const previous = found.get(result.id);
      if (!previous || (result.score || 0) > (previous.score || 0)) found.set(result.id, result);
    }
  }
  const ranked = [...found.values()].sort((a, b) => (b.score || 0) - (a.score || 0));
  const hidden = await sensitiveIds(caller.workspaceId, { decisionIds: ranked.map(r => r.id) });
  const outcomes = ranked.filter(r => !hidden.decisions.has(r.id)).slice(0, max).map(outcomeCard);
  return { outcomes, count: outcomes.length };
}

/**
 * get_thread: one subject end to end
 * @param {Caller} caller
 * @param {{ topic_id: string }} args
 */
async function getThread(caller, { topic_id: topicId }) {
  if (!TOPIC_ID.test(String(topicId))) return { error: 'Unknown topic_id. Use the topic_id of an outcome from search_outcomes or list_action_items.' };
  const spaceIds = await spacesOf(caller);
  const thread = await buildThreadView(caller.workspaceId, topicId, { spaceIds, viewerId: caller.userId });
  if (!thread) return { error: 'Not found' };
  const rows = [].concat(...(thread.meetings || []).map(group => group.items || []));
  // A sensitive thread stays in Corteza (sensitivity spreads to the whole thread)
  if (rows.some(row => row.sensitive)) return { error: 'Not found' };
  return {
    topic: thread.topic || null,
    summary: thread.summary || null,
    meetings: (thread.meetings || []).map(group => ({
      meeting: group.title || null,
      date: group.date || null,
      outcomes: group.items.filter(row => row.kind === 'decision').map(row => ({
        id: row.id, type: row.type, headline: row.text, owner: row.owner_name, status: row.resolution_status,
        answer_or_mitigation: row.resolution_note, open_days: row.status ? row.status.age_days : null, link: outcomeLink(row)
      })),
      action_items: group.items.filter(row => row.kind === 'action_item').map(row => ({
        id: row.item_id, task: row.text, owners: (row.owners || []).map(o => o.name).filter(Boolean), due_date: row.due_date, status: row.status,
        link: `${appUrl()}/actions?item=${encodeURIComponent(row.item_id)}`
      }))
    })),
    link: `${appUrl()}/questions?topic=${encodeURIComponent(topicId)}`
  };
}

/**
 * The member a name or email points to (for "Ana's action items")
 * @param {string} workspaceId
 * @param {string} who
 * @returns {Promise<{ user_id: string, name: string }|null|'ambiguous'>}
 */
async function findMember(workspaceId, who) {
  const needle = String(who).trim().toLowerCase();
  if (!needle) return null;
  const members = await getWorkspaceMembersCollection().find({ workspace_id: workspaceId, removed_at: null }, { projection: { _id: 0, user_id: 1, user_name: 1, email: 1 } }).toArray();
  const exact = members.filter(m => (m.email || '').toLowerCase() === needle || (m.user_name || '').toLowerCase() === needle);
  const partial = exact.length ? exact : members.filter(m => (m.user_name || '').toLowerCase().includes(needle) || (m.email || '').toLowerCase().startsWith(needle));
  if (partial.length > 1) return 'ambiguous';
  return partial[0] ? { user_id: partial[0].user_id, name: partial[0].user_name || partial[0].email } : null;
}

/**
 * list_action_items: mine by default, or a person's, with the same visibility as the Action items page
 * @param {Caller} caller
 * @param {{ owner?: string, due?: string, status?: string, limit?: number }} args
 */
async function listActions(caller, { owner, due, status = 'open', limit = MAX_ITEMS }) {
  let ownerId = caller.userId;
  let ownerName = null;
  if (owner && !['me', 'mine', 'yo'].includes(String(owner).toLowerCase())) {
    if (['all', 'everyone', 'todos'].includes(String(owner).toLowerCase())) {
      ownerId = undefined;
    } else {
      const member = await findMember(caller.workspaceId, owner);
      if (member === 'ambiguous') return { error: `More than one person matches "${owner}". Use their full name or email.` };
      if (!member) return { error: `Nobody in this workspace matches "${owner}".` };
      ownerId = member.user_id;
      ownerName = member.name;
    }
  }
  const { timezone } = await getTimeZone(caller.workspaceId, caller.userId);
  const now = new Date();
  const spaceIds = await spacesOf(caller);
  const items = await listActionItems(caller.workspaceId, {
    spaceIds, viewerId: caller.userId, ownerId,
    status: ['open', 'done', 'cancelled', 'resolved', 'all'].includes(String(status)) ? /** @type {any} */ (status) : 'open',
    due: ['overdue', 'today', 'none', 'week'].includes(String(due)) ? /** @type {any} */ (due) : undefined,
    now, today: localTime(now, timezone || 'UTC').date
  });
  const hidden = await sensitiveIds(caller.workspaceId, { itemIds: items.map(i => i.item_id) });
  const visible = items.filter(item => !item.sensitive && !hidden.items.has(item.item_id));
  const max = Math.min(Math.max(1, Number(limit) || MAX_ITEMS), MAX_ITEMS);
  return { owner: ownerId === caller.userId ? 'you' : (ownerName || 'everyone'), action_items: visible.slice(0, max).map(actionCard), more: Math.max(0, visible.length - max) };
}

/**
 * prepare_meeting: today's meetings still ahead, each with what is open from its earlier sessions
 * @param {Caller} caller
 */
async function prepareMeeting(caller) {
  const { timezone } = await getTimeZone(caller.workspaceId, caller.userId);
  const today = await buildToday(caller.workspaceId, caller.userId, { now: new Date(), timeZone: timezone || 'UTC' });
  if (today.status === 'no_google') return { error: 'Google isn’t connected in Corteza, so it can’t read your calendar. Connect it in Settings → Google Meet.' };
  if (today.status === 'no_calendar') return { error: 'Corteza doesn’t have the calendar permission. Reconnect Google in Settings → Google Meet and tick Calendar.' };
  const meetings = today.meetings || [];
  const itemIds = [].concat(...meetings.map(m => (m.items || []).map(i => i.item_id).filter(Boolean)));
  const decisionIds = [].concat(...meetings.map(m => [...(m.questions || []), ...(m.closed || [])].map(q => q.id).filter(id => typeof id === 'number')));
  const hidden = await sensitiveIds(caller.workspaceId, { decisionIds, itemIds });
  return {
    time_zone: timezone || 'UTC',
    meetings: meetings.map(meeting => ({
      title: meeting.title,
      start: meeting.start,
      end: meeting.end,
      people: meeting.people || [],
      history: meeting.kind === 'series' ? 'has earlier sessions in Corteza' : 'no earlier sessions in Corteza',
      last_met: meeting.last_met || null,
      open_action_items: (meeting.items || []).filter(i => !hidden.items.has(i.item_id)).map(i => ({ task: i.text, owner: i.owner || null, due_date: i.due_date || null, link: i.item_id ? `${appUrl()}/actions?item=${encodeURIComponent(i.item_id)}` : null })),
      suggested_items: Boolean(meeting.suggested),
      open_questions_and_risks: (meeting.questions || []).filter(q => !hidden.decisions.has(q.id)).map(q => ({ type: q.type, text: q.text, owner: q.owner || null })),
      closed_since_last_time: (meeting.closed || []).filter(c => !hidden.decisions.has(/** @type {any} */ (c).id)).map(c => ({ text: c.text, owner: c.owner || null }))
    }))
  };
}

/**
 * list_meetings: the person's recent meetings and what came out of each
 * @param {Caller} caller
 * @param {{ before?: string, limit?: number }} args
 */
async function listMyMeetings(caller, { before, limit = 10 }) {
  const valid = typeof before === 'string' && !isNaN(new Date(before).getTime()) ? before : null;
  const result = await listMeetings(caller.workspaceId, caller.userId, { before: valid, limit: Math.min(Math.max(1, Number(limit) || 10), MAX_ITEMS) });
  return {
    meetings: result.meetings.map(meeting => ({
      id: meeting.id,
      title: meeting.title || (meeting.id === 'manual' ? 'Logged by hand' : null),
      date: meeting.occurred_at || null,
      status: meeting.status,
      skip_reason: meeting.skip_reason || null,
      counts: meeting.counts || {},
      to_review: meeting.to_review || 0
    })),
    next_before: result.next_before
  };
}

/**
 * get_meeting: what came out of one of the person's meetings
 * @param {Caller} caller
 * @param {{ id: string }} args
 */
async function getMeeting(caller, { id }) {
  const result = await meetingOutcomes(caller.workspaceId, caller.userId, String(id || ''));
  if (!result) return { error: 'Not found' };
  const hidden = await sensitiveIds(caller.workspaceId, { decisionIds: result.outcomes.map(o => o.id), itemIds: result.action_items.map(a => a.item_id) });
  return {
    outcomes: result.outcomes.filter(o => !o.sensitive && !hidden.decisions.has(o.id)).map(outcomeCard),
    action_items: result.action_items.filter(a => !a.sensitive && !hidden.items.has(a.item_id)).map(actionCard)
  };
}

module.exports = { searchOutcomes, getThread, listActions, prepareMeeting, listMyMeetings, getMeeting, outcomeCard, actionCard, findMember, MAX_ITEMS };
