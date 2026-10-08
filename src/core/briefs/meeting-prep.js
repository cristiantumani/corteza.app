const { getDatabase, getDecisionsCollection, getWorkspaceMembersCollection } = require('../../config/database');
const { getUserAccessibleSpaces } = require('../../services/permissions');
const connections = require('../../integrations/google/connections');
const calendarClient = require('../../integrations/google/calendar-client');
const meetClient = require('../../integrations/google/meet-client');
const { localDayBounds, localTime } = require('../users/timezone');
const { normalizeName } = require('../actions/owners');

/**
 * Meeting prep for the morning summary (docs/specs/2026-10-meeting-prep-series.md): each of today's
 * meetings with what is open from **its own history**, never from its attendees.
 *
 * A meeting's history: the outcomes and action items captured from earlier instances of it. An
 * instance is found by its Meet code (every conference record of the event's Meet link, from the
 * Meet API) or, as a fallback, by the same title. For a series it lists everyone's open action
 * items, open questions and risks, and what was closed since the last instance. A meeting without
 * history is listed with nothing connected; a 1:1 without history suggests the open items shared
 * with that person.
 *
 * Needs the optional calendar scope on the person's Google connection; without it (or if Google
 * fails) there is no prep. Calendar events and Meet records are read here and never stored, and
 * nothing from them is logged.
 */

const MAX_MEETINGS = 8;
const MAX_ITEMS_PER_MEETING = 5;
const MAX_QUESTIONS = 3;
const MAX_CLOSED = 3;
const MAX_SUGGESTED = 3;
const MAX_CANDIDATES = 500;
const CLOSED_WINDOW_MS = 120 * 24 * 60 * 60 * 1000; // closed items older than this can't be "since last time"
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'en', 'por', 'para', 'the', 'and', 'with', 'of', 'for', 'a', 'to', 'meeting', 'reunion']);

/**
 * @typedef {Object} PrepItem
 * @property {string} item_id
 * @property {string} text
 * @property {string|null} due_date
 * @property {boolean} mine - the person owns it (alone or with others)
 * @property {string|null} owner - another owner's name when it isn't theirs; null for theirs or unassigned
 *
 * @typedef {Object} PrepOutcome
 * @property {'action_item'|'open_question'|'risk'} type
 * @property {string} text
 * @property {string|null} owner
 *
 * @typedef {Object} MeetingPrep
 * @property {string} start - ISO date-time
 * @property {string} title
 * @property {string[]} people - the other attendees' names
 * @property {'series'|'new'} kind - series: we have captures of earlier instances
 * @property {string|null} last_met - start of the most recent earlier instance (ISO)
 * @property {PrepItem[]} items - the series' open action items (everyone's), or for a new 1:1 the suggested ones
 * @property {boolean} suggested - items are suggestions (a 1:1 without history), not the meeting's own
 * @property {number} more - items left out
 * @property {PrepOutcome[]} questions - the series' open questions and risks
 * @property {PrepOutcome[]} closed - closed since the last instance
 */

/** "Juan Pérez" said in a meeting is the same person as attendee "Juan Pérez" or "Juan" */
function sameName(spoken, attendee) {
  const a = normalizeName(spoken);
  const b = normalizeName(attendee);
  if (!a || !b) return false;
  if (a === b) return true;
  // One of them is only a first name: compare first names
  if (!a.includes(' ') || !b.includes(' ')) return a.split(' ')[0] === b.split(' ')[0];
  return false;
}

/** Title without case, accents or punctuation */
function titleKey(title) {
  return normalizeName(title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function sameTitle(a, b) {
  const x = titleKey(a);
  return x.length >= 3 && x === titleKey(b);
}

/** A title Corteza made up when Meet had none ("Google Meet on 2026-10-01 14:00 UTC") */
function isPlaceholderTitle(title) {
  return !title || /^google meet( on |$)/i.test(String(title).trim());
}

/** Two real titles with no word in common: the same Meet link used for unrelated meetings */
function unrelatedTitles(a, b) {
  if (isPlaceholderTitle(a) || isPlaceholderTitle(b)) return false;
  const words = title => new Set(titleKey(title).split(' ').filter(word => word.length > 2 && !STOPWORDS.has(word)));
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return false;
  return ![...x].some(word => y.has(word));
}

/** Copies of one item (each colleague in a meeting captures it) count once */
const copyKey = text => String(text || '').trim().toLowerCase();

function byUrgency(today) {
  const rank = item => (item.due_date ? (item.due_date < today ? 0 : 1) : 2);
  return (a, b) => rank(a) - rank(b) || String(a.due_date || '').localeCompare(String(b.due_date || '')) || new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
}

/**
 * Builds the prep for one day's meetings (pure: no I/O)
 * @param {Object} params
 * @param {import('../../integrations/google/calendar-client').CalendarEvent[]} params.events
 * @param {string} params.userId
 * @param {string|null} params.selfEmail
 * @param {Object[]} params.members - [{ user_id, user_name, email }]
 * @param {Map<string, Object[]|null>} [params.records] - event id → its Meet code's conference records ({ name, startTime }); null when unknown
 * @param {Object[]} params.actions - action items the person can see: open ones, and ones closed recently
 * @param {Object[]} [params.outcomes] - open questions and risks the person can see, and ones resolved recently
 * @param {string} params.today - 'YYYY-MM-DD', the person's local date
 * @returns {MeetingPrep[]}
 */
function buildMeetingPrep({ events, userId, selfEmail, members, records = new Map(), actions, outcomes = [], today }) {
  const memberByEmail = new Map(members.filter(m => m.email).map(m => [String(m.email).toLowerCase(), m]));
  const memberById = new Map(members.map(m => [m.user_id, m]));
  const self = selfEmail ? selfEmail.toLowerCase() : null;
  /** @type {MeetingPrep[]} */
  const prep = [];

  const ownerOf = owners => {
    const list = owners || [];
    const mine = list.some(owner => owner.user_id === userId);
    const other = list.find(owner => owner.user_id !== userId);
    return { mine, owner: mine || !other ? null : other.name || memberById.get(other.user_id)?.user_name || null };
  };

  for (const event of events) {
    const attendees = event.attendees
      .filter(a => !a.self && a.email !== self)
      .map(a => {
        const member = memberByEmail.get(a.email);
        if (member && member.user_id === userId) return null;
        return { userId: member ? member.user_id : null, name: (member && member.user_name) || a.name || a.email.split('@')[0] };
      })
      .filter(Boolean);
    if (attendees.length === 0) continue;

    // Earlier instances of this meeting: its Meet code's records that started before it
    const eventStart = new Date(event.start).getTime();
    const known = Array.isArray(records.get(event.id)); // we know this meeting's Meet history
    const earlier = (records.get(event.id) || []).filter(record => record.startTime && new Date(record.startTime).getTime() < eventStart);
    const recordIds = new Set(earlier.map(record => record.name));
    const lastMetTime = earlier.reduce((latest, record) => Math.max(latest, new Date(record.startTime).getTime()), 0);
    const lastMet = lastMetTime ? new Date(lastMetTime).toISOString() : null;

    const fromThisMeeting = source => {
      if (!source) return false;
      if (source.external_id && recordIds.has(source.external_id)) return !unrelatedTitles(source.title, event.title);
      // Another Meet link is another meeting, even with the same title ("1:1", "Sync")
      if (known && String(source.external_id || '').startsWith('conferenceRecords/')) return false;
      return sameTitle(source.title, event.title);
    };

    const seriesActions = actions.filter(item => fromThisMeeting(item.source));
    const seriesOutcomes = outcomes.filter(outcome => fromThisMeeting(outcome.source_details));
    const isSeries = recordIds.size > 0 || seriesActions.length > 0 || seriesOutcomes.length > 0;
    // Without an earlier instance from Meet, "last time" is the latest capture of the series
    const lastCapture = [...seriesActions.map(i => i.source.occurred_at), ...seriesOutcomes.map(o => o.source_details.occurred_at)]
      .filter(Boolean).map(date => new Date(date).toISOString()).filter(date => new Date(date).getTime() < eventStart).sort().pop() || null;
    const since = lastMet || lastCapture;

    const seen = new Set();
    const once = text => {
      const key = copyKey(text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    const toItem = item => ({ item_id: item.item_id, text: item.text, due_date: item.due_date || null, ...ownerOf(item.owners) });

    let items = seriesActions.filter(item => item.status === 'open').sort(byUrgency(today)).filter(item => once(item.text)).map(toItem);
    let suggested = false;
    let limit = MAX_ITEMS_PER_MEETING;

    // A 1:1 we know nothing about: the open items shared with that person, as a suggestion
    if (!isSeries && attendees.length === 1) {
      const [person] = attendees;
      const isPerson = owner => (owner.user_id && owner.user_id === person.userId) || (!owner.user_id && owner.name && sameName(owner.name, person.name));
      items = actions.filter(item => item.status === 'open' && (item.owners || []).some(isPerson))
        .sort(byUrgency(today)).filter(item => once(item.text)).map(toItem);
      suggested = items.length > 0;
      limit = MAX_SUGGESTED;
    }

    const questions = seriesOutcomes.filter(outcome => outcome.resolution_status !== 'resolved')
      .filter(outcome => once(outcome.text))
      .map(outcome => ({ type: outcome.type, text: outcome.text, owner: outcome.owner_name || null }))
      .slice(0, MAX_QUESTIONS);

    const sinceTime = since ? new Date(since).getTime() : null;
    const closedAfter = date => sinceTime !== null && !!date && new Date(date).getTime() >= sinceTime;
    const closed = sinceTime === null ? [] : [
      ...seriesActions.filter(item => item.status === 'done' && closedAfter(item.completed_at))
        .map(item => ({ type: /** @type {'action_item'} */ ('action_item'), text: item.text, owner: ownerOf(item.owners).owner, at: item.completed_at })),
      ...seriesOutcomes.filter(outcome => outcome.resolution_status === 'resolved' && closedAfter(outcome.resolved_at))
        .map(outcome => ({ type: outcome.type, text: outcome.text, owner: outcome.resolved_by?.name || null, at: outcome.resolved_at }))
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .filter(entry => once(entry.text))
      .slice(0, MAX_CLOSED)
      .map(({ type, text, owner }) => ({ type, text, owner }));

    prep.push({
      start: event.start,
      title: event.title || 'Meeting',
      people: attendees.map(a => a.name),
      kind: isSeries ? /** @type {'series'} */ ('series') : /** @type {'new'} */ ('new'),
      last_met: since,
      items: items.slice(0, limit),
      suggested,
      more: Math.max(0, items.length - limit),
      questions,
      closed
    });
    if (prep.length === MAX_MEETINGS) break;
  }
  return prep;
}

/**
 * Whether a meeting has anything to show (a calendar alone isn't news)
 * @param {MeetingPrep} meeting
 * @returns {boolean}
 */
function hasContent(meeting) {
  return (meeting.items || []).length > 0 || (meeting.questions || []).length > 0 || (meeting.closed || []).length > 0;
}

/**
 * Today's meeting prep for a person (the rest of their local day)
 * @param {string} workspaceId
 * @param {string} userId
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.timeZone]
 * @param {Object} [options.deps] - injectable for tests: { getConnection, getClient, listEvents, listRecords }
 * @returns {Promise<MeetingPrep[]>} [] without calendar access or meetings with other people
 */
async function getMeetingPrep(workspaceId, userId, { now = new Date(), timeZone = 'UTC', deps = {} } = {}) {
  const {
    getConnection = connections.getConnection,
    getClient = connections.getAuthorizedClient,
    listEvents = calendarClient.listEventsBetween,
    listRecords = meetClient.listConferenceRecordsForMeetingCode
  } = deps;

  const connection = await getConnection(workspaceId, userId);
  if (!connection || connection.status !== 'active' || !connections.hasCalendar(connection)) return [];

  const { end } = localDayBounds(now, timeZone);
  const client = getClient(connection);
  let events;
  try {
    events = (await listEvents(client, { from: now, to: end })).filter(event => event.attendees.some(a => !a.self)).slice(0, MAX_MEETINGS);
  } catch (error) {
    console.warn(`⚠️  Reading the calendar failed for ${userId} in ${workspaceId}: ${error.response?.status || error.message}`);
    return [];
  }
  if (!events.length) return [];

  // Earlier instances of each meeting, by its Meet code (null when unknown: the title still works)
  const records = new Map(await Promise.all(events.map(async event => {
    if (!event.meeting_code) return [event.id, null];
    try {
      return [event.id, await listRecords(client, event.meeting_code)];
    } catch (error) {
      console.warn(`⚠️  Reading a meeting's history failed for ${userId} in ${workspaceId}: ${error.response?.status || error.message}`);
      return [event.id, null];
    }
  })));

  const db = getDatabase();
  const spaceIds = await getUserAccessibleSpaces(null, workspaceId, userId);
  const recentlyClosed = new Date(now.getTime() - CLOSED_WINDOW_MS);
  const visible = { workspace_id: workspaceId, $or: [{ space_id: { $in: spaceIds } }, { owner_ids: userId }], 'owner_duplicates.user_id': { $ne: userId } };
  const actionFields = { _id: 0, item_id: 1, text: 1, due_date: 1, owners: 1, source: 1, status: 1, completed_at: 1, created_at: 1 };
  const outcomeBase = { workspace_id: workspaceId, space_id: { $in: spaceIds }, type: { $in: ['open_question', 'risk'] }, review_status: { $ne: 'dismissed' } };
  const outcomeFields = { _id: 0, id: 1, type: 1, text: 1, owner_name: 1, source_details: 1, resolution_status: 1, resolved_at: 1, resolved_by: 1 };

  const [members, open, done, openOutcomes, resolvedOutcomes] = await Promise.all([
    getWorkspaceMembersCollection().find({ workspace_id: workspaceId, removed_at: null }, { projection: { user_id: 1, user_name: 1, email: 1 } }).toArray(),
    db.collection('action_items').find({ ...visible, status: 'open' }, { projection: actionFields })
      .sort({ due_date: 1, created_at: -1 }).limit(MAX_CANDIDATES).toArray(),
    db.collection('action_items').find({ ...visible, status: 'done', completed_at: { $gte: recentlyClosed } }, { projection: actionFields })
      .sort({ completed_at: -1 }).limit(MAX_CANDIDATES).toArray(),
    spaceIds.length ? getDecisionsCollection().find({ ...outcomeBase, resolution_status: { $ne: 'resolved' } }, { projection: outcomeFields })
      .sort({ timestamp: -1 }).limit(MAX_CANDIDATES).toArray() : [],
    spaceIds.length ? getDecisionsCollection().find({ ...outcomeBase, resolution_status: 'resolved', resolved_at: { $gte: recentlyClosed } }, { projection: outcomeFields })
      .sort({ resolved_at: -1 }).limit(MAX_CANDIDATES).toArray() : []
  ]);

  const today = localTime(now, timeZone).date;
  return buildMeetingPrep({
    events, userId, selfEmail: connection.google_email, members, records,
    actions: [...open, ...done], outcomes: [...openOutcomes, ...resolvedOutcomes], today
  });
}

module.exports = { getMeetingPrep, buildMeetingPrep, hasContent, sameName, sameTitle, unrelatedTitles };
