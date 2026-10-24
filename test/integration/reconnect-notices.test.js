const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setupTestDatabase, skip } = require('../helpers/db');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

console.log = () => {};
console.warn = () => {};
console.error = () => {};

const DAY = 24 * 60 * 60 * 1000;

describe('lost Google connection: the person hears it from us', { skip }, () => {
  const WS = 'WLOST';
  // Wednesday 8:10 in Santiago
  const WEDNESDAY = new Date('2026-09-30T11:10:00Z');
  let db;
  let cleanup;
  let notices;
  let connections;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    notices = require('../../src/integrations/google/reconnect-notices');
    connections = require('../../src/integrations/google/connections');
    await db.collection('workspace_members').insertMany([
      { workspace_id: WS, user_id: 'UA', email: 'ana@acme.com', workspace_name: 'Acme', removed_at: null, timezone: 'America/Santiago', language: 'es' },
      { workspace_id: WS, user_id: 'UB', email: 'bob@acme.com', workspace_name: 'Acme', removed_at: null, timezone: 'America/Santiago', daily_digest_opt_out: true },
      { workspace_id: WS, user_id: 'UC', email: 'carla@acme.com', workspace_name: 'Acme', removed_at: null, timezone: 'America/Santiago' }
    ]);
    await db.collection('google_connections').insertMany([
      { workspace_id: WS, user_id: 'UA', google_email: 'ana@acme.com', status: 'revoked', revoked_at: new Date('2026-09-28T13:00:00Z') },
      // Opted out of the summary: still told, it's about the service
      { workspace_id: WS, user_id: 'UB', google_email: 'bob@acme.com', status: 'revoked', revoked_at: new Date('2026-09-29T13:00:00Z') },
      { workspace_id: WS, user_id: 'UC', google_email: 'carla@acme.com', status: 'active' }
    ]);
  });

  after(async () => { if (cleanup) await cleanup(); });

  test('one email when it happens, one reminder 3 days later, then nothing', async () => {
    const sent = [];
    const send = async params => { sent.push(params); };

    assert.deepEqual(await notices.sendReconnectNotices(WEDNESDAY, { send }), { sent: 2, reminders: 0, failed: 0 });
    assert.deepEqual(sent.map(s => s.email).sort(), ['ana@acme.com', 'bob@acme.com']);
    const ana = sent.find(s => s.email === 'ana@acme.com');
    assert.equal(ana.reminder, false);
    assert.equal(ana.lang, 'es');
    assert.equal(ana.since, 'lunes, 28 de septiembre', 'the date in their language and time zone');
    assert.equal(sent.find(s => s.email === 'bob@acme.com').lang, 'en');

    sent.length = 0;
    await notices.sendReconnectNotices(new Date(WEDNESDAY.getTime() + 15 * 60 * 1000), { send });
    assert.equal(sent.length, 0, 'the next run sends nothing');

    await notices.sendReconnectNotices(new Date(WEDNESDAY.getTime() + 3 * DAY + 60 * 1000), { send });
    assert.deepEqual(sent.map(s => [s.email, s.reminder]).sort(), [['ana@acme.com', true], ['bob@acme.com', true]]);

    sent.length = 0;
    await notices.sendReconnectNotices(new Date(WEDNESDAY.getTime() + 10 * DAY), { send });
    assert.equal(sent.length, 0, 'no more after the reminder');
  });

  test('a failed send is tried again on the next run', async () => {
    await db.collection('google_connections').insertOne({ workspace_id: WS, user_id: 'UC2', google_email: 'c2@acme.com', status: 'revoked', revoked_at: WEDNESDAY });
    await db.collection('workspace_members').insertOne({ workspace_id: WS, user_id: 'UC2', email: 'c2@acme.com', removed_at: null });
    const failing = async () => { throw new Error('Resend error: down'); };
    assert.equal((await notices.sendReconnectNotices(WEDNESDAY, { send: failing })).failed, 1);
    const sent = [];
    await notices.sendReconnectNotices(new Date(WEDNESDAY.getTime() + 15 * 60 * 1000), { send: async params => { sent.push(params); } });
    assert.deepEqual(sent.map(s => s.email), ['c2@acme.com']);
  });

  test('reconnecting clears the notices, so a later loss emails again', async () => {
    await connections.saveConnection({
      workspaceId: WS, userId: 'UA', userName: 'Ana', email: 'ana@acme.com',
      refreshToken: '1//new-token', grantedScopes: connections.MEET_SCOPES
    });
    const row = await db.collection('google_connections').findOne({ workspace_id: WS, user_id: 'UA' });
    assert.equal(row.status, 'active');
    assert.equal(row.reconnect_email_sent_at, undefined);
    assert.equal(row.reconnect_reminder_sent_at, undefined);

    await db.collection('google_connections').updateOne({ _id: row._id }, { $set: { status: 'revoked', revoked_at: new Date('2026-10-12T13:00:00Z') } });
    const sent = [];
    await notices.sendReconnectNotices(new Date('2026-10-13T11:00:00Z'), { send: async params => { sent.push(params); } });
    assert.deepEqual(sent.filter(s => s.email === 'ana@acme.com').map(s => s.reminder), [false], 'a first email again, not a reminder');
  });

  test('the morning summary says so: sent even with nothing new on the first morning, then Mondays', async () => {
    const digest = require('../../src/jobs/daily-digest');
    await db.collection('google_connections').updateOne({ workspace_id: WS, user_id: 'UA' }, { $set: { revoked_at: new Date('2026-09-28T13:00:00Z') }, $unset: { digest_notice_sent_at: '' } });
    const sent = [];
    const send = async params => { sent.push(params); };

    await digest.runDailyDigest(WEDNESDAY, { send });
    const ana = sent.find(s => s.email === 'ana@acme.com');
    assert.ok(ana, 'nothing new, but their connection is lost');
    assert.equal(ana.summary.googleLost, 'lunes, 28 de septiembre');
    assert.equal(ana.partner, null, 'no partner line about an empty day');
    assert.ok(!sent.some(s => s.email === 'bob@acme.com'), 'opted out of the summary');
    assert.ok(!sent.some(s => s.email === 'carla@acme.com'), 'connected and nothing new: no email');

    sent.length = 0;
    await digest.runDailyDigest(new Date('2026-10-01T11:10:00Z'), { send });
    assert.ok(!sent.some(s => s.email === 'ana@acme.com'), 'Thursday: not again');

    await digest.runDailyDigest(new Date('2026-10-05T11:10:00Z'), { send });
    assert.ok(sent.some(s => s.email === 'ana@acme.com' && s.summary.googleLost), 'Monday: again');
  });

  test('the notice rule on its own', () => {
    const { lostConnectionNotice } = require('../../src/jobs/daily-digest');
    const lostAt = new Date('2026-09-28T13:00:00Z');
    assert.deepEqual(lostConnectionNotice({ status: 'active' }, '2026-09-30', 'UTC'), { since: null, sendAnyway: false });
    assert.equal(lostConnectionNotice({ status: 'revoked', revoked_at: lostAt }, '2026-09-30', 'UTC').sendAnyway, true);
    const noticed = { status: 'revoked', revoked_at: lostAt, digest_notice_sent_at: new Date('2026-09-30T11:00:00Z') };
    assert.equal(lostConnectionNotice(noticed, '2026-10-01', 'UTC').sendAnyway, false);
    assert.equal(lostConnectionNotice(noticed, '2026-10-05', 'UTC').sendAnyway, true, 'Monday');
    assert.deepEqual(lostConnectionNotice(noticed, '2026-10-01', 'UTC').since, lostAt, 'still mentioned when an email goes out anyway');
  });
});
