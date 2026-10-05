const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('app language: picked in Settings, else the browser\'s', { skip }, () => {
  let db;
  let cleanup;
  let server;
  let base;
  let session;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertOne({ workspace_id: 'WL', user_id: 'UL', user_name: 'Lucía', removed_at: null });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = session; next(); });
    app.use(require('../../src/http/language'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  const call = (method, body, headers = {}) => fetch(`${base}/api/me/language`, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined
  });

  test('needs a session', async () => {
    session = {};
    assert.equal((await call('GET')).status, 401);
  });

  test('follows the browser until the person picks; the pick is saved and used by the session', async () => {
    session = { user: { workspace_id: 'WL', user_id: 'UL' } };
    let body = await (await call('GET', null, { 'Accept-Language': 'es-CL,es;q=0.9' })).json();
    assert.deepEqual([body.language, body.chosen], ['es', null]);

    assert.equal((await call('PUT', { language: 'fr' })).status, 400);
    assert.equal((await call('PUT', {})).status, 400);

    body = await (await call('PUT', { language: 'en' }, { 'Accept-Language': 'es' })).json();
    assert.deepEqual([body.language, body.chosen], ['en', 'en']);
    assert.equal(session.user.language, 'en', 'the next page load uses it');
    assert.equal((await db.collection('workspace_members').findOne({ user_id: 'UL' })).language, 'en');
    assert.equal(await require('../../src/core/users/language').getLanguage('WL', 'UL'), 'en', 'what sign-in reads');

    body = await (await call('PUT', { language: null }, { 'Accept-Language': 'es' })).json();
    assert.deepEqual([body.language, body.chosen], ['es', null], 'back to the browser\'s');
    assert.equal(session.user.language, undefined);
    assert.equal((await db.collection('workspace_members').findOne({ user_id: 'UL' })).language, undefined);
  });
});
