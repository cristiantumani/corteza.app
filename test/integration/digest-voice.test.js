const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('morning partner settings: each person picks, admins switch it off', { skip }, () => {
  let db;
  let cleanup;
  let server;
  let base;
  let sessionUser;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WV', user_id: 'UADMIN', user_name: 'Ana', email: 'ana@acme.example', removed_at: null },
      { workspace_id: 'WV', user_id: 'UMEMBER', user_name: 'Bruno', email: 'bruno@acme.example', removed_at: null }
    ]);
    await db.collection('workspace_admins').insertOne({ workspace_id: 'WV', user_id: 'UADMIN', role: 'admin', deactivated_at: null });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/digest-voice'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  const call = (method, path, body) => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  });

  test('needs a session', async () => {
    sessionUser = null;
    assert.equal((await call('GET', '/api/me/digest-voice')).status, 401);
  });

  test('nobody picked: the default voice; a pick is saved, an unknown one refused', async () => {
    delete process.env.DIGEST_DEFAULT_VOICE;
    sessionUser = { workspace_id: 'WV', user_id: 'UMEMBER' };
    const first = await (await call('GET', '/api/me/digest-voice')).json();
    assert.equal(first.voice, 'sarcastic');
    assert.equal(first.chosen, null);
    assert.equal(first.workspace_enabled, true);
    assert.equal(first.is_admin, false);

    assert.equal((await call('PUT', '/api/me/digest-voice', { voice: 'pirate' })).status, 400);
    const saved = await (await call('PUT', '/api/me/digest-voice', { voice: 'classic' })).json();
    assert.equal(saved.voice, 'classic');
    assert.equal(saved.chosen, 'classic');
    const member = await db.collection('workspace_members').findOne({ workspace_id: 'WV', user_id: 'UMEMBER' });
    assert.equal(member.digest_voice, 'classic');
  });

  test('only an admin turns personalities off, and then everyone gets Classic', async () => {
    sessionUser = { workspace_id: 'WV', user_id: 'UMEMBER' };
    await call('PUT', '/api/me/digest-voice', { voice: 'sergeant' });
    assert.equal((await call('PUT', '/api/workspace/digest-voices', { enabled: false })).status, 403);

    sessionUser = { workspace_id: 'WV', user_id: 'UADMIN' };
    assert.equal((await call('PUT', '/api/workspace/digest-voices', { enabled: 'no' })).status, 400);
    assert.equal((await call('PUT', '/api/workspace/digest-voices', { enabled: false })).status, 200);

    sessionUser = { workspace_id: 'WV', user_id: 'UMEMBER' };
    const after = await (await call('GET', '/api/me/digest-voice')).json();
    assert.equal(after.workspace_enabled, false);
    assert.equal(after.voice, 'classic');
    assert.equal(after.chosen, 'sergeant', 'their pick is kept for when it comes back on');
  });
});
