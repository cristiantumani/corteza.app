const { getDatabase } = require('../../config/database');

/**
 * Operational alerts by email (docs/specs/2026-10-ops-monitoring.md): Cristian hears about a
 * problem before a pilot user does. Each alert type is sent at most once every 6 hours while it
 * lasts, and once more when it's resolved. Alerts carry counts, ids and error types, never meeting
 * titles or text. State lives in `ops_state` ({ _id: 'alert:<type>' } and { _id: 'heartbeat:<job>' }).
 */

const HOUR_MS = 60 * 60 * 1000;
const RESEND_EVERY_MS = 6 * HOUR_MS;

/** What each alert says. `detail` holds counts and error types only. */
const ALERTS = {
  ai_credit: {
    subject: 'Claude is out of credit: captures and answers are failing',
    body: d => `Anthropic rejected a request for billing (${d.reason}). Meetings won't be read and search won't answer until credit is added at console.anthropic.com.`,
    resolved: 'Claude is working again.'
  },
  ai_auth: {
    subject: 'Claude rejected the API key',
    body: d => `Anthropic answered ${d.status} (${d.reason}). Check ANTHROPIC_API_KEY in Railway.`,
    resolved: 'Claude accepts the API key again.'
  },
  failed_captures: {
    subject: 'Meeting captures are failing',
    body: d => `${d.failed} meeting(s) failed in the last hour, ${d.exhausted} of them after their last attempt. See Sentry for the errors.`,
    resolved: 'Captures are working again.'
  },
  meet_poller: {
    subject: 'The Google Meet poller stopped',
    body: d => `No poller run has finished since ${d.last_run || 'the app started'}. New meetings aren't being read. Check Railway.`,
    resolved: 'The Google Meet poller is running again.'
  },
  daily_digest: {
    subject: 'Morning summaries failed to send',
    body: d => `${d.failed} morning summar${d.failed === 1 ? 'y' : 'ies'} failed today (${d.day}). See Sentry for the errors.`,
    resolved: null
  },
  google_revoked: {
    subject: 'Google connections were lost',
    body: d => `${d.count} Google connection(s) were revoked or expired in the last 24 hours${Array.isArray(d.people) && d.people.length ? ` (${d.people.join(', ')})` : ''}. Those people need to reconnect Google Meet in Settings.`,
    resolved: null
  }
};

function state() {
  return getDatabase().collection('ops_state');
}

/** Sends one alert email to OPS_ALERT_EMAIL (no-op without it) */
async function defaultSend({ subject, text }) {
  const to = (process.env.OPS_ALERT_EMAIL || '').trim();
  if (!to || !process.env.RESEND_API_KEY) return false;
  const { sendEmail } = require('../../utils/n8n-client');
  const escaped = text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  await sendEmail({ to, subject: `[Corteza ops] ${subject}`, html: `<p style="font-family:sans-serif">${escaped}</p>` });
  return true;
}

/**
 * The alert is happening: email it, unless it was already sent in the last 6 hours
 * @param {keyof typeof ALERTS} type
 * @param {Object} detail - counts and error types only
 * @param {{ now?: Date, send?: Function, resendEveryMs?: number }} [options]
 * @returns {Promise<boolean>} whether an email went out
 */
async function raiseAlert(type, detail, { now = new Date(), send = defaultSend, resendEveryMs = RESEND_EVERY_MS } = {}) {
  const alert = ALERTS[type];
  if (!alert) throw new Error(`Unknown alert ${type}`);
  const current = await state().findOne({ _id: `alert:${type}` });
  const due = !current || !current.active || !current.last_sent_at
    || now.getTime() - new Date(current.last_sent_at).getTime() >= resendEveryMs;
  await state().updateOne(
    { _id: `alert:${type}` },
    { $set: { active: true, detail, last_seen_at: now }, $setOnInsert: { first_seen_at: now } },
    { upsert: true }
  );
  if (!due) return false;
  const sent = await send({ subject: alert.subject, text: alert.body(detail) });
  if (sent) await state().updateOne({ _id: `alert:${type}` }, { $set: { last_sent_at: now } });
  console.log(`🚨 Ops alert ${type}${sent ? ' sent' : ' (no OPS_ALERT_EMAIL)'}`);
  return Boolean(sent);
}

/**
 * The alert is over: say so once, if it was active
 * @param {keyof typeof ALERTS} type
 * @param {{ now?: Date, send?: Function }} [options]
 * @returns {Promise<boolean>} whether a "resolved" email went out
 */
async function resolveAlert(type, { now = new Date(), send = defaultSend } = {}) {
  const result = await state().findOneAndUpdate(
    { _id: `alert:${type}`, active: true },
    { $set: { active: false, resolved_at: now } }
  );
  const previous = result && 'value' in result ? result.value : result;
  if (!previous || !ALERTS[type].resolved || !previous.last_sent_at) return false;
  return Boolean(await send({ subject: `Resolved: ${ALERTS[type].subject}`, text: /** @type {string} */ (ALERTS[type].resolved) }));
}

/**
 * Records that a job finished a run (the alert checks look at it)
 * @param {string} job
 * @param {Date} [now]
 */
async function heartbeat(job, now = new Date()) {
  await state().updateOne({ _id: `heartbeat:${job}` }, { $set: { at: now } }, { upsert: true });
}

/**
 * Adds to today's failure count of a job (e.g. a morning summary that didn't send)
 * @param {string} job
 * @param {Date} [now]
 */
async function countFailure(job, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  await state().updateOne({ _id: `failures:${job}:${day}` }, { $inc: { count: 1 }, $set: { day, job } }, { upsert: true });
}

module.exports = { ALERTS, raiseAlert, resolveAlert, heartbeat, countFailure, RESEND_EVERY_MS };
