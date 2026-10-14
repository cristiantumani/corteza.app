const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('ops alerts (docs/specs/2026-10-ops-monitoring.md)', { skip }, () => {
  let cleanup;
  let db;
  let alerts;
  let ops;
  const NOW = new Date('2026-10-12T15:00:00Z');
  const MIN = 60 * 1000;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    alerts = require('../../src/core/ops/alerts');
    ops = require('../../src/jobs/ops-alerts');
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  beforeEach(async () => {
    await Promise.all(['ops_state', 'ingestions', 'google_connections'].map(name => db.collection(name).deleteMany({})));
  });

  test('an alert is sent once every 6 hours while it lasts, and once more when resolved', async () => {
    const sent = [];
    const send = async message => { sent.push(message.subject); return true; };
    assert.equal(await alerts.raiseAlert('failed_captures', { failed: 3, exhausted: 0 }, { now: NOW, send }), true);
    assert.equal(await alerts.raiseAlert('failed_captures', { failed: 4, exhausted: 0 }, { now: new Date(NOW.getTime() + 60 * MIN), send }), false);
    assert.equal(await alerts.raiseAlert('failed_captures', { failed: 5, exhausted: 1 }, { now: new Date(NOW.getTime() + 361 * MIN), send }), true);
    assert.equal(await alerts.resolveAlert('failed_captures', { now: new Date(NOW.getTime() + 400 * MIN), send }), true);
    assert.equal(await alerts.resolveAlert('failed_captures', { now: new Date(NOW.getTime() + 401 * MIN), send }), false, 'only once');
    assert.equal(sent.length, 3);
    assert.match(sent[2], /^Resolved:/);
    assert.equal(await alerts.raiseAlert('failed_captures', { failed: 3, exhausted: 0 }, { now: new Date(NOW.getTime() + 402 * MIN), send }), true, 'a new episode is sent right away');
  });

  test('checks: failing captures, a stopped poller, failed morning summaries, lost Google connections', async () => {
    const raised = {};
    const deps = {
      now: NOW, appStartedAt: new Date(NOW.getTime() - 60 * MIN), pollerOn: true,
      raise: async (type, detail) => { raised[type] = detail; },
      resolve: async () => {}
    };
    // All quiet: a recent heartbeat, nothing failed
    await alerts.heartbeat('meet_poller', new Date(NOW.getTime() - 4 * MIN));
    let active = await ops.runOpsChecks(deps);
    assert.deepEqual(active, { failed_captures: false, meet_poller: false, daily_digest: false, google_revoked: false });

    const ingestion = (id, attempts, minutesAgo) => ({
      workspace_id: 'W', user_id: 'U', source: 'google_meet', external_id: id, status: 'failed', attempts, updated_at: new Date(NOW.getTime() - minutesAgo * MIN)
    });
    await db.collection('ingestions').insertMany([ingestion('m1', 1, 10), ingestion('m2', 3, 20), ingestion('m3', 1, 200)]);
    await db.collection('ops_state').updateOne({ _id: 'heartbeat:meet_poller' }, { $set: { at: new Date(NOW.getTime() - 25 * MIN) } });
    await alerts.countFailure('daily_digest', NOW);
    await alerts.countFailure('daily_digest', NOW);
    await db.collection('google_connections').insertOne({ workspace_id: 'W', user_id: 'U', google_email: 'ana@acme.com', status: 'revoked', revoked_at: new Date(NOW.getTime() - 60 * MIN) });

    active = await ops.runOpsChecks(deps);
    assert.deepEqual(active, { failed_captures: true, meet_poller: true, daily_digest: true, google_revoked: true });
    assert.deepEqual(raised.failed_captures, { failed: 2, exhausted: 1 });
    assert.equal(raised.daily_digest.failed, 2);
    assert.equal(raised.google_revoked.count, 1);
    assert.deepEqual(raised.google_revoked.people, ['ana@acme.com'], 'names who lost the connection');
    assert.ok(!JSON.stringify(raised).includes('m1'), 'counts only');
  });

  test('the Settings status counts only the person\'s own meetings', async () => {
    const { captureHealth } = require('../../src/ingestion/pipeline');
    const row = (userId, id, status, attempts, at) => ({ workspace_id: 'W', user_id: userId, source: 'google_meet', external_id: id, status, attempts, updated_at: at });
    await db.collection('ingestions').insertMany([
      row('UA', 'a1', 'completed', 1, new Date(NOW.getTime() - 90 * MIN)),
      row('UA', 'a2', 'failed', 3, new Date(NOW.getTime() - 30 * MIN)),
      row('UA', 'a3', 'failed', 1, new Date(NOW.getTime() - 30 * MIN)),
      row('UB', 'b1', 'completed', 1, new Date(NOW.getTime() - 5 * MIN)),
      row('UB', 'b2', 'failed', 3, new Date(NOW.getTime() - 5 * MIN))
    ]);
    const health = await captureHealth('W', 'UA', 'google_meet', NOW);
    assert.equal(health.failed_today, 1, 'only meetings out of attempts, only theirs');
    assert.equal(new Date(health.last_read_at).toISOString(), new Date(NOW.getTime() - 90 * MIN).toISOString());
  });
});
