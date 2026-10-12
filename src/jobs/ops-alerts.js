const { getDatabase } = require('../config/database');
const config = require('../config/environment');
const alerts = require('../core/ops/alerts');
const { reportError } = require('../integrations/sentry/client');

/**
 * Every 15 minutes, checks what can break without anyone noticing and emails OPS_ALERT_EMAIL
 * (core/ops/alerts; docs/specs/2026-10-ops-monitoring.md). Claude billing/auth failures are
 * raised right away by integrations/anthropic/client, not here.
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const POLLER_STALE_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 3; // as in ingestion/pipeline.js
const startedAt = new Date();

/**
 * Meetings that failed in the last hour, and those that used up their attempts
 * @param {Date} now
 * @returns {Promise<{ failed: number, exhausted: number }>}
 */
async function countFailedCaptures(now) {
  const since = new Date(now.getTime() - HOUR_MS);
  const ingestions = getDatabase().collection('ingestions');
  const [failed, exhausted] = await Promise.all([
    ingestions.countDocuments({ status: 'failed', updated_at: { $gte: since } }),
    ingestions.countDocuments({ status: 'failed', attempts: { $gte: MAX_ATTEMPTS }, updated_at: { $gte: since } })
  ]);
  return { failed, exhausted };
}

/** True when the Meet poller should be running here */
function pollerEnabled() {
  return process.env.MEET_CAPTURE_ENABLED !== 'false' && Boolean(config.google && config.google.isConfigured);
}

/**
 * Runs every check once
 * @param {{ now?: Date, appStartedAt?: Date, pollerOn?: boolean, raise?: Function, resolve?: Function }} [deps]
 * @returns {Promise<Object<string, boolean>>} which alerts are active
 */
async function runOpsChecks(deps = {}) {
  const now = deps.now || new Date();
  const raise = deps.raise || ((type, detail, options) => alerts.raiseAlert(type, detail, { now, ...options }));
  const resolve = deps.resolve || (type => alerts.resolveAlert(type, { now }));
  const state = getDatabase().collection('ops_state');
  /** @type {Object<string, boolean>} */
  const active = {};

  // Captures failing
  const captures = await countFailedCaptures(now);
  active.failed_captures = captures.failed >= 3 || captures.exhausted > 0;
  if (active.failed_captures) await raise('failed_captures', captures);
  else await resolve('failed_captures');

  // Meet poller stopped
  const pollerOn = deps.pollerOn !== undefined ? deps.pollerOn : pollerEnabled();
  if (pollerOn) {
    const beat = await state.findOne({ _id: 'heartbeat:meet_poller' });
    const last = beat ? new Date(beat.at) : null;
    const reference = last || deps.appStartedAt || startedAt;
    active.meet_poller = now.getTime() - reference.getTime() > POLLER_STALE_MS;
    if (active.meet_poller) await raise('meet_poller', { last_run: last ? last.toISOString() : null });
    else await resolve('meet_poller');
  }

  // Morning summaries that failed today
  const day = now.toISOString().slice(0, 10);
  const digestFailures = await state.findOne({ _id: `failures:daily_digest:${day}` });
  active.daily_digest = Boolean(digestFailures && digestFailures.count > 0);
  if (active.daily_digest) await raise('daily_digest', { failed: digestFailures.count, day });
  else await resolve('daily_digest');

  // Google connections lost in the last 24 hours (once a day at most)
  const revoked = await getDatabase().collection('google_connections').countDocuments({
    status: 'revoked', revoked_at: { $gte: new Date(now.getTime() - 24 * HOUR_MS) }
  });
  active.google_revoked = revoked > 0;
  if (active.google_revoked) await raise('google_revoked', { count: revoked }, { resendEveryMs: 24 * HOUR_MS });
  else await resolve('google_revoked');

  return active;
}

function startOpsAlertsJob() {
  if (process.env.OPS_ALERTS_ENABLED === 'false') return;
  if (!process.env.OPS_ALERT_EMAIL) console.warn('⚠️  OPS_ALERT_EMAIL not set: ops alerts are checked but not emailed');
  const run = () => runOpsChecks().catch(error => {
    console.error('❌ Ops checks failed:', error.message);
    reportError(error, { job: 'ops_alerts' });
  });
  setTimeout(() => {
    run();
    setInterval(run, CHECK_INTERVAL_MS);
  }, 60 * 1000);
}

module.exports = { runOpsChecks, countFailedCaptures, startOpsAlertsJob, POLLER_STALE_MS };
