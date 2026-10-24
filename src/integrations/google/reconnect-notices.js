const { getDatabase, getWorkspaceMembersCollection } = require('../../config/database');
const { memberLanguage } = require('../../core/users/language');
const { isValidTimeZone } = require('../../core/users/timezone');
const { track } = require('../posthog/client');
const { reportError } = require('../sentry/client');

/**
 * When Google stops working, the person knows (docs/specs/2026-10-lost-google-connection.md).
 *
 * A connection the poller marked `revoked` (access removed, password changed, or the 7-day expiry of
 * apps in Testing) means nothing is captured, so the morning summary goes quiet. This emails the
 * person: once the day it happens, and one reminder REMINDER_AFTER_MS after that first email if they
 * still haven't reconnected (connections lost before this shipped get their first email on the next run). Nothing more; Home and Settings keep showing "Reconnect". Reconnecting clears the
 * state (connections.saveConnection), so a later loss emails again.
 *
 * State on the connection: `reconnect_email_sent_at`, `reconnect_reminder_sent_at`. Each is claimed
 * before sending (one sender even with two app instances) and released if the send fails, so the
 * next run retries. The email carries only the date and a link: no meeting content.
 */

const REMINDER_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

function connections() {
  return getDatabase().collection('google_connections');
}

/**
 * The date access stopped, written for the reader ("lunes, 20 de octubre")
 * @param {Date} date
 * @param {'en'|'es'} language
 * @param {string|null} [timeZone]
 * @returns {string}
 */
function sinceLabel(date, language, timeZone) {
  return new Date(date).toLocaleDateString(language === 'es' ? 'es' : 'en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC'
  });
}

/**
 * Claims one notice on a connection; false when another run already sent it (or it was reconnected)
 * @param {*} id - the connection's _id
 * @param {'reconnect_email_sent_at'|'reconnect_reminder_sent_at'} field
 * @param {Date} now
 * @returns {Promise<boolean>}
 */
async function claim(id, field, now) {
  const result = await connections().updateOne({ _id: id, status: 'revoked', [field]: null }, { $set: { [field]: now } });
  return result.modifiedCount === 1;
}

/**
 * Emails the people whose Google connection was lost: the first notice, then one reminder
 * @param {Date} [now]
 * @param {Object} [deps]
 * @param {Function} [deps.send] - (params) => Promise; default the Resend email
 * @returns {Promise<{ sent: number, reminders: number, failed: number }>}
 */
async function sendReconnectNotices(now = new Date(), { send } = {}) {
  const sendEmail = send || require('../../utils/n8n-client').sendGoogleReconnectEmail;
  const lost = await connections().find(
    {
      status: 'revoked',
      revoked_at: { $type: 'date' },
      $or: [
        { reconnect_email_sent_at: null },
        { reconnect_reminder_sent_at: null, reconnect_email_sent_at: { $lte: new Date(now.getTime() - REMINDER_AFTER_MS) } }
      ]
    },
    { projection: { _id: 1, workspace_id: 1, user_id: 1, google_email: 1, revoked_at: 1, reconnect_email_sent_at: 1 } }
  ).toArray();
  const counts = { sent: 0, reminders: 0, failed: 0 };
  if (lost.length === 0) return counts;

  const members = await getWorkspaceMembersCollection().find(
    { $or: lost.map(row => ({ workspace_id: row.workspace_id, user_id: row.user_id })), removed_at: null },
    { projection: { _id: 0, workspace_id: 1, user_id: 1, email: 1, language: 1, browser_language: 1, timezone: 1 } }
  ).toArray();
  const memberOf = new Map(members.map(member => [`${member.workspace_id}|${member.user_id}`, member]));

  for (const connection of lost) {
    const member = memberOf.get(`${connection.workspace_id}|${connection.user_id}`);
    if (!member) continue; // no longer in the workspace
    const reminder = Boolean(connection.reconnect_email_sent_at);
    const field = reminder ? 'reconnect_reminder_sent_at' : 'reconnect_email_sent_at';
    if (!(await claim(connection._id, field, now))) continue;
    const language = memberLanguage(member) || 'en';
    try {
      await sendEmail({
        email: member.email || connection.google_email,
        since: sinceLabel(connection.revoked_at, language, member.timezone),
        reminder,
        lang: language
      });
      track('google_reconnect_email_sent', { reminder }, connection.user_id);
      counts[reminder ? 'reminders' : 'sent']++;
    } catch (error) {
      // Not sent: release the claim so the next run tries again
      await connections().updateOne({ _id: connection._id }, { $set: { [field]: null } }).catch(() => {});
      console.error(`❌ Reconnect email failed for ${connection.user_id} in ${connection.workspace_id}:`, error.message);
      reportError(error, { job: 'reconnect_notices', workspace_id: connection.workspace_id });
      counts.failed++;
    }
  }
  if (counts.sent || counts.reminders) console.log(`🔌 Reconnect emails: ${counts.sent} sent, ${counts.reminders} reminder(s)`);
  return counts;
}

module.exports = { sendReconnectNotices, sinceLabel, REMINDER_AFTER_MS };
