const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('meetings view (docs/specs/2026-10-meetings-view.md)', { skip }, () => {
  let db;
  let cleanup;
  let server;
  let base;
  let sessionUser;
  let mine;
  let colleagues;
  const W = 'WMEET';
  const CRISTIAN = { workspace_id: W, user_id: 'UC', user_name: 'Cristian' };
  const MARTIN = { workspace_id: W, user_id: 'UM', user_name: 'Martín' };
  const H = 3600 * 1000;
  const ago = hours => new Date(Date.now() - hours * H);

  async function request(path) {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertMany([
      { workspace_id: W, user_id: 'UC', user_name: 'Cristian', email: 'c@ninja.io', role: 'member', removed_at: null },
      { workspace_id: W, user_id: 'UM', user_name: 'Martín', email: 'm@ninja.io', role: 'member', removed_at: null }
    ]);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mine = await ensurePersonalSpace(W, 'UC', 'Cristian');
    colleagues = await ensurePersonalSpace(W, 'UM', 'Martín');

    const ingestion = (userId, externalId, title, status, hours, extra = {}) => ({
      workspace_id: W, user_id: userId, source: 'google_meet', external_id: externalId, title, status,
      attempts: 1, created_at: ago(hours), updated_at: ago(hours), ...extra
    });
    await db.collection('ingestions').insertMany([
      ingestion('UC', 'conferenceRecords/weekly', 'Weekly', 'completed', 2),
      ingestion('UC', 'conferenceRecords/1on1', 'Ana / Bruno', 'skipped', 5, { skip_reason: 'one_on_one' }),
      // Martín was in the same weekly: his own row, in his own list
      ingestion('UM', 'conferenceRecords/weekly', 'Weekly', 'completed', 2),
      ingestion('UM', 'conferenceRecords/private', 'Martín only', 'completed', 3)
    ]);
    const outcome = (id, type, spaceId, userId, externalId, extra = {}) => ({
      workspace_id: W, space_id: spaceId, id, type, text: `Outcome ${id}`, user_id: userId, capture: 'ai', review_status: null,
      timestamp: ago(2).toISOString(), created_at: ago(2),
      source_details: externalId ? { type: 'google_meet', title: 'Weekly', external_id: externalId, occurred_at: ago(2.5).toISOString() } : { type: 'dashboard' },
      ...extra
    });
    await db.collection('decisions').insertMany([
      outcome(1, 'decision', mine.space_id, 'UC', 'conferenceRecords/weekly'),
      outcome(2, 'open_question', mine.space_id, 'UC', 'conferenceRecords/weekly', { review_status: 'confirmed' }),
      // Martín's capture of the same meeting, in his private space: never counted for Cristian
      outcome(3, 'risk', colleagues.space_id, 'UM', 'conferenceRecords/weekly'),
      // Logged by hand
      outcome(4, 'decision', mine.space_id, 'UC', null, { capture: 'manual' })
    ]);
    await db.collection('action_items').insertOne({
      item_id: 'a1', workspace_id: W, space_id: mine.space_id, text: 'Send the deck', owners: [{ name: 'Cristian', user_id: 'UC' }], owner_ids: ['UC'],
      status: 'open', source: { title: 'Weekly', external_id: 'conferenceRecords/weekly' }, created_by: { user_id: 'UC' }, created_at: ago(2)
    });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/meetings'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    sessionUser = CRISTIAN;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('the person\'s own meetings with what they can see from each, and a Logged by hand row', async () => {
    const { status, body } = await request('/api/meetings');
    assert.equal(status, 200);
    const ids = body.meetings.map(row => row.id);
    assert.ok(ids.includes('conferenceRecords/weekly'));
    assert.ok(ids.includes('conferenceRecords/1on1'));
    assert.ok(!ids.includes('conferenceRecords/private'), 'not a colleague\'s meeting');
    const weekly = body.meetings.find(row => row.id === 'conferenceRecords/weekly');
    assert.deepEqual(weekly.counts, { decision: 1, action_item: 1, open_question: 1, risk: 0 }, 'Martín\'s private risk doesn\'t count');
    assert.equal(weekly.to_review, 1);
    assert.equal(weekly.title, 'Weekly');
    const oneOnOne = body.meetings.find(row => row.id === 'conferenceRecords/1on1');
    assert.equal(oneOnOne.status, 'skipped');
    assert.equal(oneOnOne.can_capture, true);
    const manual = body.meetings.find(row => row.kind === 'manual');
    assert.equal(manual.counts.decision, 1);
  });

  test('a meeting\'s outcomes: only visible ones; someone else\'s meeting is a 404', async () => {
    const { status, body } = await request(`/api/meetings/outcomes?id=${encodeURIComponent('conferenceRecords/weekly')}`);
    assert.equal(status, 200);
    assert.deepEqual(body.outcomes.map(o => o.id).sort(), [1, 2]);
    assert.equal(body.outcomes.find(o => o.id === 1).can_review, true);
    assert.equal(body.outcomes.find(o => o.id === 2).can_review, false);
    assert.deepEqual(body.action_items.map(a => a.item_id), ['a1']);
    assert.ok(!JSON.stringify(body).includes('owner_ids'), 'no owner ids sent');

    assert.equal((await request(`/api/meetings/outcomes?id=${encodeURIComponent('conferenceRecords/private')}`)).status, 404);
    assert.equal((await request('/api/meetings/outcomes?id=')).status, 404);

    const manual = (await request('/api/meetings')).body.meetings.find(row => row.kind === 'manual');
    const byHand = await request(`/api/meetings/outcomes?id=${encodeURIComponent(manual.id)}`);
    assert.deepEqual(byHand.body.outcomes.map(o => o.id), [4]);

    sessionUser = MARTIN;
    const his = await request(`/api/meetings/outcomes?id=${encodeURIComponent('conferenceRecords/weekly')}`);
    assert.deepEqual(his.body.outcomes.map(o => o.id), [3], 'Martín sees his own capture of the same meeting');
    sessionUser = CRISTIAN;
  });

  test('pagination with before', async () => {
    const first = await request('/api/meetings?limit=1');
    assert.equal(first.body.meetings.length, 1);
    assert.ok(first.body.next_before);
    const second = await request(`/api/meetings?limit=1&before=${encodeURIComponent(first.body.next_before)}`);
    assert.equal(second.body.meetings.length, 1);
    assert.notEqual(second.body.meetings[0].id, first.body.meetings[0].id);
  });
});
