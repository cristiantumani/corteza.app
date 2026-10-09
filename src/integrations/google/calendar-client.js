/**
 * Thin client for the Google Calendar API (v3): the signed-in person's own events for a day,
 * so the morning summary can prepare them for today's meetings (core/briefs/meeting-prep.js).
 * Needs the optional `calendar.events.readonly` scope (connections.hasCalendar). Events are
 * read when the summary is built and never stored.
 *
 * API: https://developers.google.com/calendar/api/v3/reference/events/list
 */

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const MAX_EVENTS = 50;

/**
 * @typedef {Object} CalendarEvent
 * @property {string} id
 * @property {string} title
 * @property {string} start - ISO date-time
 * @property {string|null} end - ISO date-time
 * @property {string|null} meeting_code - the Google Meet code ('abc-defg-hij'), same for every instance of a recurring meeting
 * @property {{ email: string, name: string|null, self: boolean }[]} attendees - people only (no rooms), not ones who declined
 */

const MEET_CODE = /meet\.google\.com\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/i;

/**
 * The Meet code of a calendar event, from its Meet link or its conference data
 * @param {Object} event - a Calendar API event
 * @returns {string|null}
 */
function meetingCodeOf(event) {
  const fromLink = MEET_CODE.exec(event.hangoutLink || '');
  if (fromLink) return fromLink[1].toLowerCase();
  const conference = event.conferenceData || {};
  const id = typeof conference.conferenceId === 'string' ? conference.conferenceId.toLowerCase() : '';
  if (conference.conferenceSolution?.key?.type === 'hangoutsMeet' && /^[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}$/.test(id)) return id;
  const entry = (conference.entryPoints || []).map(point => MEET_CODE.exec(point.uri || '')).find(Boolean);
  return entry ? entry[1].toLowerCase() : null;
}

/**
 * Timed events on the person's primary calendar between `from` and `to` that they haven't
 * declined, earliest first. All-day events, cancelled ones and rooms are left out.
 * @param {Object} client - authorized OAuth2Client (connections.getAuthorizedClient)
 * @param {{ from: Date, to: Date }} range
 * @returns {Promise<CalendarEvent[]>}
 */
async function listEventsBetween(client, { from, to }) {
  const { data } = await client.request({
    url: `${CALENDAR_API}/calendars/primary/events`,
    params: {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: MAX_EVENTS
    }
  });
  return (data.items || [])
    .filter(event => event.status !== 'cancelled' && event.start && event.start.dateTime)
    .filter(event => !(event.attendees || []).some(a => a.self && a.responseStatus === 'declined'))
    .map(event => ({
      id: event.id,
      title: event.summary || '',
      start: event.start.dateTime,
      end: (event.end && event.end.dateTime) || null,
      meeting_code: meetingCodeOf(event),
      attendees: (event.attendees || [])
        .filter(a => a.email && !a.resource && a.responseStatus !== 'declined')
        .map(a => ({ email: String(a.email).toLowerCase(), name: a.displayName || null, self: Boolean(a.self) }))
    }));
}

module.exports = { listEventsBetween, meetingCodeOf };
