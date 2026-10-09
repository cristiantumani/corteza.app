const connections = require('../../integrations/google/connections');
const { getMeetingPrep } = require('../briefs/meeting-prep');

/**
 * "Prepare your day" on Home (docs/specs/2026-10-home-today.md): the meetings still ahead today
 * (or running), each with what is open from its own history. Same prep as the morning summary
 * (core/briefs/meeting-prep), with the Google part cached for 10 minutes.
 */

/**
 * @typedef {Object} TodayPrep
 * @property {'ok'|'no_calendar'|'no_google'} status - no_google: Google isn't connected (or needs reconnecting);
 *   no_calendar: connected without the calendar permission
 * @property {import('../briefs/meeting-prep').MeetingPrep[]} meetings
 */

/**
 * @param {string} workspaceId
 * @param {string} userId
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.timeZone]
 * @param {Object} [options.deps] - injectable for tests (see getMeetingPrep), plus { getMeetingPrep }
 * @returns {Promise<TodayPrep>}
 */
async function buildToday(workspaceId, userId, { now = new Date(), timeZone = 'UTC', deps = {} } = {}) {
  const getConnection = deps.getConnection || connections.getConnection;
  const connection = await getConnection(workspaceId, userId);
  if (!connection || connection.status !== 'active') return { status: 'no_google', meetings: [] };
  if (!connections.hasCalendar(connection)) return { status: 'no_calendar', meetings: [] };
  const loadPrep = deps.getMeetingPrep || getMeetingPrep;
  const prep = await loadPrep(workspaceId, userId, { now, timeZone, cache: true, deps: { ...deps, getConnection: async () => connection } });
  // Meetings that already ended today drop off
  const meetings = prep.filter(meeting => new Date(meeting.end || meeting.start).getTime() > now.getTime());
  return { status: 'ok', meetings };
}

module.exports = { buildToday };
