const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('Home overview: summary, what I owe, what is open, decided, review queue', { skip }, () => {
  let db;
  let cleanup;
  let space;
  let server;
  let base;
  let sessionUser;
  const now = new Date('2026-10-04T12:00:00Z');
  const hoursAgo = hours => new Date(now.getTime() - hours * 3600 * 1000).toISOString();
  const meet = (id, title) => ({ type: 'google_meet', external_id: id, title, url: `https://meet.google.com/${id}` });

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    space = await require('../../src/services/spaces').ensureDefaultSpace('WHOME');
    await db.collection('workspace_spaces').insertOne({ workspace_id: 'WHOME', space_id: 'sp_board', name: 'Board', visibility: 'private', archived: false });
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WHOME', user_id: 'U1', user_name: 'Ana Rojas', email: 'ana@acme.example', removed_at: null },
      { workspace_id: 'WHOME', user_id: 'U2', user_name: 'Bruno Díaz', email: 'bruno@acme.example', removed_at: null }
    ]);

    const outcome = (id, extra) => ({
      id, workspace_id: 'WHOME', space_id: space.space_id, user_id: 'U1', creator: 'Ana Rojas', type: 'decision', tags: [], ...extra
    });
    await db.collection('decisions').insertMany([
      outcome(1, { text: 'Launch the annual plan', capture: 'ai', review_status: null, timestamp: hoursAgo(2), evidence_quote: '20% keeps the margin', source_details: meet('m1', 'Pricing Q4') }),
      outcome(2, { text: 'Ask legal about discounts', type: 'open_question', capture: 'ai', review_status: null, timestamp: hoursAgo(2), source_details: meet('m1', 'Pricing Q4') }),
      outcome(3, { text: 'Payments provider may be late', type: 'risk', capture: 'ai', review_status: 'confirmed', timestamp: hoursAgo(5), source_details: meet('m2', 'Weekly Ops') }),
      outcome(4, { text: 'Move weekly ops to Tuesday', capture: 'ai', review_status: 'confirmed', timestamp: hoursAgo(30), source_details: meet('m3', 'Weekly Ops') }),
      outcome(5, { text: 'Use Linear for product work', capture: 'manual', timestamp: hoursAgo(50) }),
      outcome(6, { text: 'Old question, answered', type: 'open_question', resolution_status: 'resolved', timestamp: hoursAgo(80) }),
      // A colleague's AI capture in the shared space: visible, but only they (or an admin) review it
      outcome(7, { text: 'Bruno\'s pending capture', user_id: 'U2', creator: 'Bruno Díaz', capture: 'ai', review_status: null, timestamp: hoursAgo(1), source_details: meet('m4', 'Sales sync') }),
      // A private space U1 isn't in: never shown or counted
      outcome(8, { text: 'Board secret', space_id: 'sp_board', user_id: 'U2', capture: 'manual', timestamp: hoursAgo(1) })
    ]);

    const actions = require('../../src/core/actions/action-service');
    const create = overrides => actions.createActionItem({
      workspaceId: 'WHOME', spaceId: space.space_id, spaceName: space.name, text: 'Do something',
      author: { user_id: 'U1', name: 'Ana Rojas' }, capture: 'ai', ...overrides
    });
    await create({ text: 'Due later', ownerNames: ['Ana Rojas'], dueDate: '2026-10-20' });
    await create({ text: 'Overdue one', ownerNames: ['Ana Rojas'], dueDate: '2026-10-01' });
    await create({ text: 'Due today', ownerNames: ['Ana Rojas'], dueDate: '2026-10-04' });
    await create({ text: 'No date', ownerNames: ['Ana Rojas'] });
    await create({ text: 'Bruno owns it', ownerNames: ['Bruno Díaz'], dueDate: '2026-09-30' });

    const app = express();
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/home'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('builds the overview for one person, within the spaces they can access', async () => {
    const { buildHomeOverview } = require('../../src/core/home/overview');
    const overview = await buildHomeOverview('WHOME', 'U1', { now, today: '2026-10-04' });

    assert.deepEqual(overview.summary, {
      new_outcomes: 4, // #1, #2, #3 and Bruno's #7 in the last 24 h; not #8 (private space)
      meetings: 3, // m1, m2, m4
      overdue: 1,
      due_today: 1,
      open_action_items: 4,
      to_review: 2, // #1 and #2: Bruno's #7 is his to review
      open_questions: 1,
      open_risks: 1
    });
    assert.deepEqual(overview.owe.map(item => item.text), ['Overdue one', 'Due today', 'Due later', 'No date'], 'mine only, most urgent first');
    assert.deepEqual(overview.open.map(item => item.id), [2, 3], 'open questions and risks, newest first; answered ones left out');
    assert.deepEqual(overview.decided.map(d => d.id), [4, 5], 'confirmed or logged by hand, newest first; nothing waiting for review');
    assert.deepEqual(overview.review.map(d => d.id), [1, 2]);
    assert.equal(overview.review[0].evidence_quote, '20% keeps the margin', 'the queue carries the evidence');
    assert.equal(overview.review[0].source_details.external_id, 'm1', 'and the meeting, to confirm a whole meeting at once');
    const everything = JSON.stringify(overview);
    assert.ok(!everything.includes('Board secret'), 'a private space the person is not in never shows');
    assert.ok(!everything.includes('embedding'), 'embeddings are never sent');
  });

  test('an admin can review a colleague\'s captures', async () => {
    await db.collection('workspace_admins').insertOne({ workspace_id: 'WHOME', user_id: 'U1', role: 'admin', deactivated_at: null });
    const { buildHomeOverview } = require('../../src/core/home/overview');
    const overview = await buildHomeOverview('WHOME', 'U1', { now, today: '2026-10-04' });
    assert.deepEqual(overview.review.map(d => d.id).sort(), [1, 2, 7]);
    await db.collection('workspace_admins').deleteMany({ workspace_id: 'WHOME' });
  });

  test('GET /api/home needs a session and returns the overview', async () => {
    sessionUser = null;
    assert.equal((await fetch(`${base}/api/home`)).status, 401);

    sessionUser = { workspace_id: 'WHOME', user_id: 'U2', user_name: 'Bruno Díaz' };
    const response = await fetch(`${base}/api/home`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.owe.map(item => item.text), ['Bruno owns it']);
    assert.deepEqual(body.review.map(d => d.id), [7], 'Bruno reviews his own capture');
  });
});
