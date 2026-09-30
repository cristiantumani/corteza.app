const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('editing an outcome (PUT /api/decisions/:id) with the global JSON parser', { skip }, () => {
  const WS = 'WEDIT';
  const ana = { workspace_id: WS, user_id: 'UA', user_name: 'Ana' };
  let db;
  let cleanup;
  let server;
  let base;

  function put(id, body) {
    return fetch(`${base}/api/decisions/${id}`, {
      method: 'PUT',
      headers: { 'x-test-user': JSON.stringify(ana), 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    const spaces = require('../../src/services/spaces');
    await db.collection('workspace_members').insertOne({ workspace_id: WS, user_id: 'UA', user_name: 'Ana', removed_at: null });
    const space = await spaces.ensurePersonalSpace(WS, 'UA', 'Ana');
    await db.collection('decisions').insertOne({ workspace_id: WS, space_id: space.space_id, id: 1, text: 'Launch in October', type: 'decision', tags: [], user_id: 'UA' });

    const { rejectOperatorKeys, jsonBodyErrors } = require('../../src/middleware/input-safety');
    const { requireWorkspaceAccess } = require('../../src/middleware/auth');
    const { updateDecision } = require('../../src/routes/api');
    const app = express();
    app.use((req, res, next) => { req.session = { user: JSON.parse(req.headers['x-test-user']) }; next(); });
    app.use(express.json({ limit: '1mb' }));
    app.use(rejectOperatorKeys);
    app.put('/api/decisions/:id', requireWorkspaceAccess, updateDecision);
    app.use(jsonBodyErrors);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('a valid edit is saved (the handler reads the parsed body instead of the raw stream)', async () => {
    const response = await put(1, { text: 'Launch on October 22', tags: ['Launch'] });
    assert.equal(response.status, 200);
    const saved = await db.collection('decisions').findOne({ workspace_id: WS, id: 1 });
    assert.equal(saved.text, 'Launch on October 22');
    assert.deepEqual(saved.tags, ['launch']);
  });

  test('operators, non-object bodies and broken JSON are refused', async () => {
    assert.equal((await put(1, { text: { $set: 'x' } })).status, 400);
    assert.equal((await put(1, [1, 2])).status, 400);
    assert.equal((await put(1, '{"text":')).status, 400);
    assert.equal((await db.collection('decisions').findOne({ workspace_id: WS, id: 1 })).text, 'Launch on October 22', 'unchanged');
  });
});
