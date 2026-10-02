const { getDatabase, getWorkspaceMembersCollection } = require('../../config/database');
const { getUserAccessibleSpaces } = require('../../services/permissions');
const connections = require('../../integrations/google/connections');
const calendarClient = require('../../integrations/google/calendar-client');
const { localDayBounds } = require('../users/timezone');
const { normalizeName } = require('../actions/owners');

/**
 * Meeting prep for the morning summary: today's meetings on the person's calendar, each
 * with the open action items that involve the people in it.
 *
 * For each meeting (with at least one other attendee) it lists:
 * - the person's own open items shared with someone in the meeting (co-owned), or from an
 *   earlier meeting with the same title (a recurring meeting's open items);
 * - open items that attendees own and the person can see (from the person's meetings).
 *
 * Attendees are matched to members by email, and to owners named in meetings by name.
 * Needs the optional calendar scope on the person's Google connection; without it (or if
 * Google fails) there is no prep. Calendar events are read here and never stored, and
 * nothing from them is logged.
 */

const MAX_MEETINGS = 5;
const MAX_ITEMS_PER_MEETING = 5;
const MAX_CANDIDATES = 300;

/**
 * @typedef {Object} PrepItem
 * @property {string} item_id
 * @property {string} text
 * @property {string|null} due_date
 * @property {string|null} owner - null when it's the person's own item, else the owner's name
 *
 * @typedef {Object} MeetingPrep
 * @property {string} start - ISO date-time
 * @property {string} title
 * @property {string[]} people - the other attendees' names
 * @property {PrepItem[]} items - at most MAX_ITEMS_PER_MEETING, the person's own first
 * @property {number} more - items left out
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

function sameTitle(a, b) {
  const x = normalizeName(a);
  return x.length >= 3 && x === normalizeName(b);
}

/**
 * Builds the prep for one day's meetings (pure: no I/O)
 * @param {Object} params
 * @param {import('../../integrations/google/calendar-client').CalendarEvent[]} params.events
 * @param {string} params.userId
 * @param {string|null} params.selfEmail
 * @param {Object[]} params.members - [{ user_id, user_name, email }]
 * @param {Object[]} params.mine - the person's open items
 * @param {Object[]} params.others - open items others own, that the person can see
 * @returns {MeetingPrep[]}
 */
function buildMeetingPrep({ events, userId, selfEmail, members, mine, others }) {
  const memberByEmail = new Map(members.filter(m => m.email).map(m => [String(m.email).toLowerCase(), m]));
  const self = selfEmail ? selfEmail.toLowerCase() : null;
  const prep = [];

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

    const isAttendee = owner => attendees.some(a => (owner.user_id && owner.user_id === a.userId) || (owner.name && sameName(owner.name, a.name)));
    const items = [];
    const seen = new Set();
    const add = (item, ownerName) => {
      if (seen.has(item.item_id)) return;
      seen.add(item.item_id);
      items.push({ item_id: item.item_id, text: item.text, due_date: item.due_date || null, owner: ownerName });
    };

    for (const item of mine) {
      const shared = (item.owners || []).some(owner => owner.user_id !== userId && isAttendee(owner));
      const sameMeeting = item.source && item.source.title && sameTitle(item.source.title, event.title);
      if (shared || sameMeeting) add(item, null);
    }
    for (const item of others) {
      const owner = (item.owners || []).find(isAttendee);
      if (owner) add(item, owner.name || attendees.find(a => a.userId === owner.user_id)?.name || null);
    }
    if (items.length === 0) continue;

    prep.push({
      start: event.start,
      title: event.title || 'Meeting',
      people: attendees.map(a => a.name),
      items: items.slice(0, MAX_ITEMS_PER_MEETING),
      more: Math.max(0, items.length - MAX_ITEMS_PER_MEETING)
    });
    if (prep.length === MAX_MEETINGS) break;
  }
  return prep;
}

/**
 * Today's meeting prep for a person (the rest of their local day)
 * @param {string} workspaceId
 * @param {string} userId
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.timeZone]
 * @param {Object} [options.deps] - injectable for tests: { getConnection, getClient, listEvents }
 * @returns {Promise<MeetingPrep[]>} [] without calendar access, meetings or matching items
 */
async function getMeetingPrep(workspaceId, userId, { now = new Date(), timeZone = 'UTC', deps = {} } = {}) {
  const {
    getConnection = connections.getConnection,
    getClient = connections.getAuthorizedClient,
    listEvents = calendarClient.listEventsBetween
  } = deps;

  const connection = await getConnection(workspaceId, userId);
  if (!connection || connection.status !== 'active' || !connections.hasCalendar(connection)) return [];

  const { end } = localDayBounds(now, timeZone);
  let events;
  try {
    events = await listEvents(getClient(connection), { from: now, to: end });
  } catch (error) {
    console.warn(`⚠️  Reading the calendar failed for ${userId} in ${workspaceId}: ${error.response?.status || error.message}`);
    return [];
  }
  if (!events.length) return [];

  const db = getDatabase();
  const spaceIds = await getUserAccessibleSpaces(null, workspaceId, userId);
  const projection = { _id: 0, item_id: 1, text: 1, due_date: 1, owners: 1, source: 1 };
  const [members, mine, others] = await Promise.all([
    getWorkspaceMembersCollection().find({ workspace_id: workspaceId, removed_at: null }, { projection: { user_id: 1, user_name: 1, email: 1 } }).toArray(),
    db.collection('action_items').find(
      { workspace_id: workspaceId, owner_ids: userId, 'owner_duplicates.user_id': { $ne: userId }, status: 'open' },
      { projection }
    ).sort({ due_date: 1, created_at: -1 }).limit(MAX_CANDIDATES).toArray(),
    db.collection('action_items').find(
      { workspace_id: workspaceId, space_id: { $in: spaceIds }, owner_ids: { $ne: userId }, status: 'open', 'owners.0': { $exists: true } },
      { projection }
    ).sort({ due_date: 1, created_at: -1 }).limit(MAX_CANDIDATES).toArray()
  ]);

  return buildMeetingPrep({ events, userId, selfEmail: connection.google_email, members, mine, others });
}

module.exports = { getMeetingPrep, buildMeetingPrep, sameName };
