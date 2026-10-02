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
 * @property {{ email: string, name: string|null, self: boolean }[]} attendees - people only (no rooms), not ones who declined
 */

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
      attendees: (event.attendees || [])
        .filter(a => a.email && !a.resource && a.responseStatus !== 'declined')
        .map(a => ({ email: String(a.email).toLowerCase(), name: a.displayName || null, self: Boolean(a.self) }))
    }));
}

module.exports = { listEventsBetween };
