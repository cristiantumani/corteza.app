const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('open questions and risks: list, resolve, reopen, only your spaces', { skip }, () => {
  let cleanup;
  let server;
  let base;
  let sessionUser;
  let mine;
  let colleagues;
  const ids = {};

  async function request(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    const db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WQR', user_id: 'UC', user_name: 'Cristian', email: 'c@ninja.io', role: 'member', removed_at: null },
      { workspace_id: 'WQR', user_id: 'UM', user_name: 'Martín', email: 'm@ninja.io', role: 'member', removed_at: null }
    ]);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mine = await ensurePersonalSpace('WQR', 'UC', 'Cristian');
    colleagues = await ensurePersonalSpace('WQR', 'UM', 'Martín');

    let nextId = 1;
    const add = async (key, spaceId, type, text, author) => {
      ids[key] = nextId++;
      await db.collection('decisions').insertOne({
        workspace_id: 'WQR', space_id: spaceId, id: ids[key], type, text, user_id: author.user_id, creator: author.name,
        capture: 'ai', rationale: 'It blocks the launch', embedding: [0.1, 0.2], timestamp: new Date(Date.now() - ids[key] * 1000).toISOString(), created_at: new Date()
      });
    };
    await add('question', mine.space_id, 'open_question', 'Do we price per seat or per workspace?', { user_id: 'UC', name: 'Cristian' });
    await add('risk', mine.space_id, 'risk', 'The pilot customer may churn before renewal', { user_id: 'UC', name: 'Cristian' });
    await add('decision', mine.space_id, 'decision', 'We launch on the 15th', { user_id: 'UC', name: 'Cristian' });
    await add('private', colleagues.space_id, 'open_question', 'Martín private question', { user_id: 'UM', name: 'Martín' });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/questions-risks'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    sessionUser = { workspace_id: 'WQR', user_id: 'UC', user_name: 'Cristian' };
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('lists open questions and risks from your spaces only, with counts by type', async () => {
    const { status, body } = await request('GET', '/api/questions-risks');
    assert.equal(status, 200);
    assert.deepEqual(body.items.map(item => item.id).sort(), [ids.question, ids.risk].sort(), 'no decisions, no colleague\'s private items');
    assert.deepEqual(body.counts, { open_question: 1, risk: 1 });
    assert.ok(body.items.every(item => item.resolution_status === 'open' && item.embedding === undefined));

    const risks = await request('GET', '/api/questions-risks?type=risk');
    assert.deepEqual(risks.body.items.map(item => item.text), ['The pilot customer may churn before renewal']);
  });

  test('a question is answered with a note, leaves the open list, and can be reopened', async () => {
    const resolved = await request('POST', `/api/questions-risks/${ids.question}/resolve`, { note: 'Per seat, decided with the board' });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.resolution_status, 'resolved');

    const open = await request('GET', '/api/questions-risks');
    assert.deepEqual(open.body.items.map(item => item.id), [ids.risk]);
    assert.deepEqual(open.body.counts, { open_question: 0, risk: 1 });

    const done = await request('GET', '/api/questions-risks?status=resolved');
    assert.equal(done.body.items[0].resolution_note, 'Per seat, decided with the board');
    assert.equal(done.body.items[0].resolved_by.name, 'Cristian');

    await request('POST', `/api/questions-risks/${ids.question}/reopen`);
    const again = await request('GET', '/api/questions-risks');
    assert.equal(again.body.items.length, 2);
    assert.equal(again.body.items.find(item => item.id === ids.question).resolution_note, null);
  });

  test('a colleague\'s private item and other outcome types can\'t be resolved', async () => {
    assert.equal((await request('POST', `/api/questions-risks/${ids.private}/resolve`, {})).status, 404);
    assert.equal((await request('POST', `/api/questions-risks/${ids.decision}/resolve`, {})).status, 404);
    assert.equal((await request('POST', '/api/questions-risks/abc/resolve', {})).status, 404);
  });
});
