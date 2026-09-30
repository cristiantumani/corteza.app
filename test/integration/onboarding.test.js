const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('first-run onboarding', { skip }, () => {
  let db;
  let cleanup;
  let server;
  let base;

  async function call(user, method, path) {
    const response = await fetch(base + path, { method, headers: { 'x-test-user': JSON.stringify(user) } });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WON', user_id: 'UA', user_name: 'Ana', removed_at: null },
      { workspace_id: 'WON', user_id: 'UB', user_name: 'Bob', removed_at: null }
    ]);
    await db.collection('workspace_admins').insertOne({ workspace_id: 'WON', user_id: 'UA', role: 'admin', deactivated_at: null });

    const app = express();
    app.use((req, res, next) => { req.session = { user: JSON.parse(req.headers['x-test-user']) }; next(); });
    app.use(require('../../src/http/onboarding'));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('shows once per person: seen after they finish or skip, and only for them', async () => {
    const ana = { workspace_id: 'WON', user_id: 'UA' };
    const bob = { workspace_id: 'WON', user_id: 'UB' };
    assert.deepEqual((await call(ana, 'GET', '/api/onboarding')).body, { success: true, seen: false, is_admin: true });
    assert.equal((await call(bob, 'GET', '/api/onboarding')).body.is_admin, false, 'the admin-only step is hidden for members');

    assert.equal((await call(ana, 'POST', '/api/onboarding/seen')).status, 200);
    assert.equal((await call(ana, 'GET', '/api/onboarding')).body.seen, true);
    assert.equal((await call(bob, 'GET', '/api/onboarding')).body.seen, false);

    const first = (await db.collection('workspace_members').findOne({ user_id: 'UA' })).onboarding_seen_at;
    await call(ana, 'POST', '/api/onboarding/seen');
    const again = (await db.collection('workspace_members').findOne({ user_id: 'UA' })).onboarding_seen_at;
    assert.equal(again.getTime(), first.getTime(), 'the first time is kept');
  });

  test('without a session it answers 401', async () => {
    const response = await fetch(base + '/api/onboarding', { headers: { 'x-test-user': 'null' } });
    assert.equal(response.status, 401);
  });
});
