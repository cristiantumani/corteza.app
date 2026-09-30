const { getWorkspaceMembersCollection } = require('../../config/database');

/**
 * Each person's time zone, so emails arrive at the same local hour for everyone.
 *
 * Stored on the membership as `timezone` (IANA name, e.g. 'America/Santiago') with
 * `timezone_source`: 'auto' when the browser reported it (public/scripts/timezone.js, on
 * every app page), 'manual' when the person picked it in Settings. A manual choice is never
 * overwritten by the browser. Google sign-in doesn't give us a time zone.
 */

/**
 * @param {*} timeZone
 * @returns {boolean} true for a time zone name this server knows
 */
function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Date, weekday and hour at `now` in a time zone
 * @param {Date} now
 * @param {string} timeZone - falls back to UTC when invalid
 * @returns {{ date: string, weekday: number, hour: number }} date 'YYYY-MM-DD', weekday 0 = Sunday
 */
function localTime(now, timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(now)) {
    parts[part.type] = part.value;
  }
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays.indexOf(parts.weekday),
    hour: parseInt(parts.hour, 10)
  };
}

/**
 * Saves a person's time zone
 * @param {string} workspaceId
 * @param {string} userId
 * @param {string} timeZone
 * @param {{ manual?: boolean }} [options] - manual: picked in Settings (the browser won't override it)
 * @returns {Promise<boolean>} false for an invalid time zone, or an automatic one when a manual choice exists
 */
async function saveTimeZone(workspaceId, userId, timeZone, { manual = false } = {}) {
  if (!isValidTimeZone(timeZone)) return false;
  const filter = { workspace_id: workspaceId, user_id: userId, removed_at: null };
  if (!manual) filter.timezone_source = { $ne: 'manual' };
  const result = await getWorkspaceMembersCollection().updateOne(filter, {
    $set: { timezone: timeZone, timezone_source: manual ? 'manual' : 'auto', timezone_updated_at: new Date() }
  });
  return result.matchedCount > 0;
}

/**
 * A person's saved time zone
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<{ timezone: string|null, source: 'auto'|'manual'|null }>}
 */
async function getTimeZone(workspaceId, userId) {
  const member = await getWorkspaceMembersCollection().findOne(
    { workspace_id: workspaceId, user_id: userId, removed_at: null },
    { projection: { timezone: 1, timezone_source: 1 } }
  );
  const timezone = member && isValidTimeZone(member.timezone) ? member.timezone : null;
  return { timezone, source: timezone ? member.timezone_source || 'auto' : null };
}

module.exports = { isValidTimeZone, localTime, saveTimeZone, getTimeZone };
