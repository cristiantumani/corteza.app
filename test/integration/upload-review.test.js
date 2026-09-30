const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('uploaded transcripts: suggestions stay with whoever uploaded them', { skip }, () => {
  const WS = 'WUPL';
  const ana = { workspace_id: WS, user_id: 'UA', user_name: 'Ana' };
  const bob = { workspace_id: WS, user_id: 'UB', user_name: 'Bob' };
  // Over the 100-word minimum for an upload
  const NOTES = Array(12).fill('We agreed to move the launch to October 22. Ana will update the press kit by Friday.').join(' ');
  let db;
  let cleanup;
  let server;
  let base;
  let anaSpace;
  let bobSpace;

  async function post(user, path, body) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'x-test-user': JSON.stringify(user), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  /** Upload pasted notes (multipart, like the dashboard) */
  async function upload(user, spaceId, notes = NOTES) {
    const form = new FormData();
    form.append('workspace_id', WS);
    form.append('space_id', spaceId);
    form.append('text', notes);
    const response = await fetch(base + '/api/ai/extract-from-text', { method: 'POST', headers: { 'x-test-user': JSON.stringify(user) }, body: form });
    return { status: response.status, body: await response.json() };
  }

  async function pending(user, spaceId) {
    const params = new URLSearchParams({ workspace_id: WS, space_id: spaceId });
    const response = await fetch(`${base}/api/ai/pending-suggestions?${params}`, { headers: { 'x-test-user': JSON.stringify(user) } });
    return (await response.json()).suggestions || [];
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();

    // No Claude call: the route gets a fixed extraction (patched before the route loads it)
    const claude = require('../../src/services/claude');
    claude.isClaudeConfigured = () => true;
    claude.extractDecisionsFromTranscript = async () => ({
      decisions: [
        { decision_text: 'Launch moves to October 22', decision_type: 'decision', tags: ['launch'], confidence: 0.9, context: '' },
        { decision_text: 'Ana updates the press kit', decision_type: 'action_item', tags: [], confidence: 0.8, context: '' }
      ],
      model: 'fake',
      processingTime: 1
    });

    const spaces = require('../../src/services/spaces');
    await db.collection('workspace_members').insertMany([
      { workspace_id: WS, user_id: 'UA', user_name: 'Ana', removed_at: null },
      { workspace_id: WS, user_id: 'UB', user_name: 'Bob', removed_at: null }
    ]);
    anaSpace = await spaces.ensurePersonalSpace(WS, 'UA', 'Ana');
    bobSpace = await spaces.ensurePersonalSpace(WS, 'UB', 'Bob');

    const app = express();
    app.use((req, res, next) => { req.session = { user: JSON.parse(req.headers['x-test-user']) }; next(); });
    app.use(require('../../src/routes/ai-extract-web'));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test("uploading needs permission on the space: nobody can drop suggestions into a colleague's", async () => {
    assert.equal((await upload(bob, anaSpace.space_id)).status, 403);
    const own = await upload(ana, anaSpace.space_id);
    assert.equal(own.status, 200);
    assert.equal(own.body.suggestions.length, 2);
    assert.ok(own.body.suggestions.every(s => s.user_id === 'UA' && /^ai_sugg_\d+_[0-9a-f]{24}$/.test(s.suggestion_id)), 'random, unguessable ids');
  });

  test("a colleague can't see, approve or reject someone else's suggestions", async () => {
    const [first] = await pending(ana, anaSpace.space_id);
    assert.ok(first);

    assert.equal((await post(bob, '/api/ai/approve-suggestion', { suggestion_id: first.suggestion_id, workspace_id: WS, space_id: bobSpace.space_id })).status, 404);
    assert.equal((await post(bob, '/api/ai/reject-suggestion', { suggestion_id: first.suggestion_id, workspace_id: WS })).status, 404);
    // A query object instead of an id is refused, not run against the database
    assert.equal((await post(bob, '/api/ai/approve-suggestion', { suggestion_id: { $ne: '' }, workspace_id: WS, space_id: bobSpace.space_id })).status, 400);
    assert.equal((await post(bob, '/api/ai/reject-suggestion', { suggestion_id: { $ne: '' }, workspace_id: WS })).status, 400);

    assert.deepEqual(await pending(bob, bobSpace.space_id), []);
    assert.equal((await db.collection('ai_suggestions').findOne({ suggestion_id: first.suggestion_id })).status, 'pending', 'untouched');
  });

  test("the same transcript uploaded by a colleague gets its own suggestions, never the first person's", async () => {
    const bobs = await upload(bob, bobSpace.space_id);
    assert.equal(bobs.status, 200);
    assert.equal(bobs.body.cached, false);
    assert.ok(bobs.body.suggestions.every(s => s.user_id === 'UB' && s.space_id === bobSpace.space_id));

    const again = await upload(ana, anaSpace.space_id);
    assert.equal(again.body.cached, true, 'the same person re-uploading reuses their suggestions');
    assert.ok(again.body.suggestions.every(s => s.user_id === 'UA'));
  });

  test("approving saves to a space you can post to, as a confirmed outcome with an atomic number", async () => {
    const [first, second] = await pending(ana, anaSpace.space_id);
    assert.equal((await post(ana, '/api/ai/approve-suggestion', { suggestion_id: first.suggestion_id, workspace_id: WS, space_id: bobSpace.space_id })).status, 403, "not into a colleague's space");

    // Older code left a decision with a higher number in another space
    await db.collection('decisions').insertOne({ workspace_id: WS, space_id: bobSpace.space_id, id: 7, text: 'Older decision', type: 'decision' });

    const approved = await post(ana, '/api/ai/approve-suggestion', { suggestion_id: first.suggestion_id, workspace_id: WS, space_id: anaSpace.space_id, space_name: '<b>spoofed</b>' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.decision_id, 8, 'numbered after every decision in the workspace, not just the space');
    const saved = await db.collection('decisions').findOne({ workspace_id: WS, id: 8 });
    assert.equal(saved.space_id, anaSpace.space_id);
    assert.equal(saved.space_name, anaSpace.name, 'space name comes from the database');
    assert.equal(saved.capture, 'ai');
    assert.equal(saved.review_status, 'confirmed', 'approved on the review screen: nothing left to review');
    assert.equal(saved.user_id, 'UA');

    assert.equal((await post(ana, '/api/ai/approve-suggestion', { suggestion_id: first.suggestion_id, workspace_id: WS, space_id: anaSpace.space_id })).status, 400, 'once');
    assert.equal((await post(ana, '/api/ai/reject-suggestion', { suggestion_id: second.suggestion_id, workspace_id: WS, reason: 'duplicate' })).status, 200);
    assert.deepEqual(await pending(ana, anaSpace.space_id), []);
  });
});
