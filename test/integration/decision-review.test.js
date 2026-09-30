const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('confirm and dismiss AI-captured outcomes', { skip }, () => {
  const WS = 'WREV';
  const ana = { workspace_id: WS, user_id: 'UA' };
  const bob = { workspace_id: WS, user_id: 'UB' };
  let db;
  let cleanup;
  let server;
  let base;
  let createDecision;
  let anaSpace;

  async function call(user, path, body) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'x-test-user': JSON.stringify(user), 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return { status: response.status, body: await response.json() };
  }

  function capture(text, extra = {}) {
    return createDecision({
      workspaceId: WS, spaceId: anaSpace.space_id, text, type: 'decision', capture: 'ai',
      author: { user_id: 'UA', name: 'Ana' }, source: { type: 'google_meet', title: 'Weekly' }, ...extra
    });
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    ({ createDecision } = require('../../src/core/decisions/decision-service'));
    const spaces = require('../../src/services/spaces');
    await db.collection('workspace_members').insertMany([
      { workspace_id: WS, user_id: 'UA', user_name: 'Ana', removed_at: null },
      { workspace_id: WS, user_id: 'UB', user_name: 'Bob', removed_at: null }
    ]);
    // Bob is an admin: still not allowed into Ana's personal space
    await db.collection('workspace_admins').insertOne({ workspace_id: WS, user_id: 'UB', role: 'admin', deactivated_at: null });
    anaSpace = await spaces.ensurePersonalSpace(WS, 'UA', 'Ana');

    const app = express();
    app.use((req, res, next) => { req.session = { user: JSON.parse(req.headers['x-test-user']) }; next(); });
    app.use(require('../../src/http/decision-review'));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('confirming marks it reviewed and saves an approved example for that person', async () => {
    const { PENDING_REVIEW } = require('../../src/core/decisions/review-service');
    const decision = await capture('Launch moves to October');
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: WS, id: decision.id, ...PENDING_REVIEW }), 1);

    const response = await call(ana, `/api/decisions/${decision.id}/review`, { action: 'confirm' });
    assert.equal(response.status, 200);
    const saved = await db.collection('decisions').findOne({ workspace_id: WS, id: decision.id });
    assert.equal(saved.review_status, 'confirmed');
    assert.equal(saved.reviewed_by, 'UA');
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: WS, id: decision.id, ...PENDING_REVIEW }), 0);

    await call(ana, `/api/decisions/${decision.id}/review`, { action: 'confirm' });
    assert.equal(await db.collection('ai_feedback').countDocuments({ decision_id: decision.id, action: 'approved' }), 1, 'confirming twice saves one example');
  });

  test("a colleague can't review someone's personal outcomes, not even an admin", async () => {
    const decision = await capture('Hire a second designer');
    assert.equal((await call(bob, `/api/decisions/${decision.id}/review`, { action: 'dismiss' })).status, 404);
    assert.equal((await call(bob, `/api/decisions/${decision.id}/review`, { action: 'confirm' })).status, 404);
    assert.ok(await db.collection('decisions').findOne({ workspace_id: WS, id: decision.id }), 'still there');
    assert.equal((await call(ana, `/api/decisions/${decision.id}/review`, { action: 'maybe' })).status, 400);
  });

  test('dismissing removes it, keeps a copy to undo, and teaches only that person', async () => {
    const { getRejectedExamples } = require('../../src/services/claude');
    const decision = await capture('Move the meeting to Thursday at 15:45');
    await db.collection('decisions').updateOne({ _id: decision._id }, { $set: { embedding: [0.1, 0.2] } });

    assert.equal((await call(ana, `/api/decisions/${decision.id}/review`, { action: 'dismiss' })).status, 200);
    assert.equal(await db.collection('decisions').findOne({ workspace_id: WS, id: decision.id }), null);
    const dismissal = await db.collection('ai_feedback').findOne({ decision_id: decision.id, action: 'rejected' });
    assert.equal(dismissal.user_id, 'UA');
    assert.equal(dismissal.snapshot.text, 'Move the meeting to Thursday at 15:45');
    assert.equal(dismissal.snapshot.embedding, undefined, 'embeddings are not copied');

    assert.equal((await call(ana, `/api/decisions/${decision.id}/dismiss-reason`, { reason: 'not_relevant' })).status, 200);
    assert.equal((await call(ana, `/api/decisions/${decision.id}/dismiss-reason`, { reason: 'made_up' })).status, 400);
    const examples = await getRejectedExamples(WS, 5, 'UA');
    assert.deepEqual(examples.map(e => [e.original_suggestion.decision_text, e.rejection_reason]), [['Move the meeting to Thursday at 15:45', 'not relevant to the business']]);
    assert.deepEqual(await getRejectedExamples(WS, 5, 'UB'), [], "a colleague's extraction never sees it");
  });

  test('undo puts it back with the same number, only for whoever dismissed it', async () => {
    const decision = await capture('Pilot with 3 customers before December');
    await call(ana, `/api/decisions/${decision.id}/review`, { action: 'dismiss', reason: 'duplicate' });

    assert.equal((await call(bob, `/api/decisions/${decision.id}/restore`)).status, 404);
    const restored = await call(ana, `/api/decisions/${decision.id}/restore`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.decision.id, decision.id);
    assert.equal(restored.body.decision.text, 'Pilot with 3 customers before December');
    assert.equal(restored.body.decision.review_status ?? null, null, 'back to waiting for review');
    assert.equal(await db.collection('ai_feedback').countDocuments({ decision_id: decision.id, action: 'rejected' }), 0, 'the rejected example is forgotten');
    assert.equal((await call(ana, `/api/decisions/${decision.id}/restore`)).status, 404, 'nothing left to restore');
  });
});
