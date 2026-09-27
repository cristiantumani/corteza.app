const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('Action items: service, due date requests, API', { skip }, () => {
  let db;
  let cleanup;
  let actions;
  let dueDates;
  let space;
  let privateSpaceId;
  let server;
  let base;
  let sessionUser;

  const members = [
    { workspace_id: 'WACT', user_id: 'U1', user_name: 'Martín Marchant', email: 'martin@acme.com', removed_at: null },
    { workspace_id: 'WACT', user_id: 'U2', user_name: 'Felipe Silva', email: 'felipe@acme.com', removed_at: null },
    { workspace_id: 'WACT', user_id: 'U3', user_name: 'Ana Ruiz', email: 'ana@acme.com', removed_at: null }
  ];
  const now = new Date('2026-09-27T12:00:00Z');

  async function create(overrides) {
    return actions.createActionItem({
      workspaceId: 'WACT', spaceId: space.space_id, spaceName: space.name, text: 'Do something',
      author: { user_id: 'U3', name: 'Ana Ruiz' }, capture: 'ai', ...overrides
    });
  }

  async function request(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    actions = require('../../src/core/actions/action-service');
    dueDates = require('../../src/core/actions/due-date-requests');
    space = await require('../../src/services/spaces').ensureDefaultSpace('WACT');
    await db.collection('workspace_members').insertMany(members);

    privateSpaceId = 'sp_private';
    await db.collection('workspace_spaces').insertOne({ workspace_id: 'WACT', space_id: privateSpaceId, name: 'Board', visibility: 'private', archived: false });

    const app = express();
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/action-items'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('items are created with owners matched to members and filtered by owner, due date and decision', async () => {
    const research = await create({ text: 'Technical research on AI + Excel', ownerNames: ['Martín', 'Felipe'], dueDate: '2026-10-10', decisionId: 83 });
    assert.deepEqual(research.owner_ids, ['U1', 'U2']);
    await create({ text: 'Overdue thing', ownerNames: ['Felipe'], dueDate: '2026-09-20' });
    await create({ text: 'Undated thing', ownerNames: ['Ana Ruiz'] });
    await create({ text: 'Due soon', ownerNames: ['Ana'], dueDate: '2026-09-30' });
    await create({ text: 'Secret board item', ownerNames: ['Ana'], spaceId: privateSpaceId });

    const visible = [space.space_id];
    const list = options => actions.listActionItems('WACT', { spaceIds: visible, now, ...options });

    assert.deepEqual((await list({})).map(i => i.text), ['Overdue thing', 'Due soon', 'Technical research on AI + Excel', 'Undated thing'], 'soonest first, undated last');
    assert.deepEqual((await list({ ownerId: 'U2' })).map(i => i.text).sort(), ['Overdue thing', 'Technical research on AI + Excel']);
    assert.deepEqual((await list({ due: 'overdue' })).map(i => i.text), ['Overdue thing']);
    assert.deepEqual((await list({ due: 'none' })).map(i => i.text), ['Undated thing']);
    assert.deepEqual((await list({ due: 'week' })).map(i => i.text), ['Due soon']);
    assert.deepEqual((await list({ decisionId: 83 })).map(i => i.text), ['Technical research on AI + Excel']);
    assert.ok(!(await list({ status: 'all' })).some(i => i.text === 'Secret board item'), 'spaces the viewer cannot access are excluded');
  });

  test('status and due date updates are validated', async () => {
    const item = await create({ text: 'Validate me', ownerNames: ['Ana'] });
    assert.equal((await actions.updateActionItem('WACT', item.item_id, { status: 'maybe' })).error, 'Invalid status');
    assert.match((await actions.updateActionItem('WACT', item.item_id, { due_date: 'next friday' })).error, /Invalid due date/);
    const done = await actions.updateActionItem('WACT', item.item_id, { status: 'done', due_date: '2026-10-01' });
    assert.equal(done.status, 'done');
    assert.equal(done.due_date, '2026-10-01');
    assert.ok(done.completed_at);
    assert.equal(await actions.updateActionItem('WOTHER', item.item_id, { status: 'open' }), null, 'other workspaces cannot update it');
  });

  test('owners are asked once for missing due dates, only for recent meetings', async () => {
    const undated = await create({ text: 'Undated A', ownerNames: ['Martín', 'Felipe'] });
    const undated2 = await create({ text: 'Undated B', ownerNames: ['Martín'] });
    const dated = await create({ text: 'Dated', ownerNames: ['Martín'], dueDate: '2026-10-01' });
    const unmatched = await create({ text: 'Nobody known', ownerNames: ['Carla'] });
    const sent = [];
    const send = async params => { sent.push(params); };
    const recent = { title: 'Weekly Ops', url: null, occurredAt: '2026-09-26T10:00:00Z' };

    const result = await dueDates.requestMissingDueDates([undated, undated2, dated, unmatched], recent, { send, now });
    assert.equal(result.sent, 2);
    const martin = sent.find(s => s.email === 'martin@acme.com');
    assert.deepEqual(martin.items.map(i => i.text), ['Undated A', 'Undated B'], 'one email per owner, listing all their undated items');
    assert.equal(sent.find(s => s.email === 'felipe@acme.com').items.length, 1);

    const saved = await actions.getActionItem('WACT', undated.item_id);
    assert.ok(saved.due_date_requested_at);
    const refreshed = await Promise.all([undated, undated2].map(i => actions.getActionItem('WACT', i.item_id)));
    assert.equal((await dueDates.requestMissingDueDates(refreshed, recent, { send, now })).sent, 0, 'not asked twice');

    const old = { title: 'August planning', occurredAt: '2026-08-10T10:00:00Z' };
    const fresh = await create({ text: 'From an old meeting', ownerNames: ['Martín'] });
    assert.equal((await dueDates.requestMissingDueDates([fresh], old, { send, now })).sent, 0, 'imports of past meetings do not email');
  });

  test('API: lists for the signed-in user, and only owners, the author or admins can update', async () => {
    sessionUser = null;
    assert.equal((await request('GET', '/api/action-items')).status, 401);

    sessionUser = { workspace_id: 'WACT', user_id: 'U2', user_name: 'Felipe Silva' };
    const mine = await request('GET', '/api/action-items?owner=me');
    assert.equal(mine.status, 200);
    assert.ok(mine.body.items.length > 0);
    assert.ok(mine.body.items.every(item => item.owner_ids.includes('U2')));

    const martinsOnly = await create({ text: 'Martin only', ownerNames: ['Martín'], author: { user_id: 'U1', name: 'Martín' } });
    assert.equal((await request('PATCH', `/api/action-items/${martinsOnly.item_id}`, { status: 'done' })).status, 403, 'Felipe is not an owner');

    sessionUser = { workspace_id: 'WACT', user_id: 'U1', user_name: 'Martín Marchant' };
    const updated = await request('PATCH', `/api/action-items/${martinsOnly.item_id}`, { due_date: '2026-10-03' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.item.due_date, '2026-10-03');
    assert.equal((await request('PATCH', `/api/action-items/${martinsOnly.item_id}`, { due_date: 'soon' })).status, 400);

    sessionUser = { workspace_id: 'WOTHER', user_id: 'U1', user_name: 'Martín' };
    assert.equal((await request('PATCH', `/api/action-items/${martinsOnly.item_id}`, { status: 'done' })).status, 404, 'other workspaces cannot see it');
  });
});
