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

  test('API: an action item can be added to a decision by hand, with owners picked from the members', async () => {
    await db.collection('decisions').insertMany([
      { id: 501, workspace_id: 'WACT', space_id: space.space_id, space_name: space.name, text: 'Se decide lanzar en octubre', type: 'decision' },
      { id: 502, workspace_id: 'WACT', space_id: privateSpaceId, text: 'Board only', type: 'decision' }
    ]);
    sessionUser = { workspace_id: 'WACT', user_id: 'U3', user_name: 'Ana Ruiz' };

    const people = await request('GET', '/api/people');
    assert.equal(people.status, 200);
    assert.deepEqual(people.body.people.map(p => p.user_id).sort(), ['U1', 'U2', 'U3']);

    const added = await request('POST', '/api/action-items', {
      decision_id: 501, text: '  Preparar el anuncio  ', owner_user_ids: ['U1', 'U2', 'U9'], due_date: '2026-10-15'
    });
    assert.equal(added.status, 201);
    assert.equal(added.body.item.text, 'Preparar el anuncio');
    assert.equal(added.body.item.decision_id, 501);
    assert.equal(added.body.item.space_id, space.space_id);
    assert.equal(added.body.item.capture, 'manual');
    assert.deepEqual(added.body.item.owner_ids, ['U1', 'U2'], 'people outside the workspace are dropped');
    assert.equal(added.body.item.created_by.user_id, 'U3');

    const listed = await request('GET', '/api/action-items?owner=all&status=all&decision_id=501');
    assert.ok(listed.body.items.some(item => item.item_id === added.body.item.item_id));

    assert.equal((await request('POST', '/api/action-items', { decision_id: 501, text: '   ' })).status, 400);
    assert.equal((await request('POST', '/api/action-items', { decision_id: 501, text: 'x', due_date: 'soon' })).status, 400);
    assert.equal((await request('POST', '/api/action-items', { decision_id: 999, text: 'x' })).status, 404);
    assert.equal((await request('POST', '/api/action-items', { decision_id: 502, text: 'x' })).status, 403, 'not a member of the private space');

    sessionUser = { workspace_id: 'WOTHER', user_id: 'U3', user_name: 'Ana' };
    assert.equal((await request('POST', '/api/action-items', { decision_id: 501, text: 'x' })).status, 404, 'other workspaces cannot add to it');
  });

  test('API: an action item can be logged on its own (Log manually), in a space the person can add to', async () => {
    sessionUser = { workspace_id: 'WACT', user_id: 'U3', user_name: 'Ana Ruiz' };
    const added = await request('POST', '/api/action-items', {
      space_id: space.space_id, text: 'Enviar propuesta a Carolina', owner_user_ids: ['U3'], due_date: '2026-10-03'
    });
    assert.equal(added.status, 201);
    assert.equal(added.body.item.decision_id, null);
    assert.equal(added.body.item.space_id, space.space_id);
    assert.equal(added.body.item.space_name, space.name, 'space name comes from the database');
    assert.deepEqual(added.body.item.owner_ids, ['U3']);
    assert.equal(added.body.item.due_date, '2026-10-03');

    const mine = await request('GET', '/api/action-items?owner=me');
    assert.ok(mine.body.items.some(item => item.item_id === added.body.item.item_id), 'it shows in Action items');
    // Outcome text may be encrypted in the database: compare after reading
    const outcomes = await db.collection('decisions').find({ workspace_id: 'WACT' }).toArray();
    assert.ok(!outcomes.some(outcome => outcome.text === 'Enviar propuesta a Carolina'), 'not saved as an outcome');

    assert.equal((await request('POST', '/api/action-items', { text: 'x' })).status, 400, 'a space is needed');
    assert.equal((await request('POST', '/api/action-items', { space_id: { $ne: '' }, text: 'x' })).status, 400);
    assert.equal((await request('POST', '/api/action-items', { space_id: 'nope', text: 'x' })).status, 404);
    assert.equal((await request('POST', '/api/action-items', { space_id: privateSpaceId, text: 'x' })).status, 403, 'not a member of the private space');
    sessionUser = { workspace_id: 'WOTHER', user_id: 'U3', user_name: 'Ana' };
    assert.equal((await request('POST', '/api/action-items', { space_id: space.space_id, text: 'x' })).status, 404, "another workspace's space");
  });
  test('API: the owner edits what, why and owners; unmatched owners stay only if kept', async () => {
    sessionUser = { workspace_id: 'WACT', user_id: 'U1', user_name: 'Martín Marchant' };
    const item = await create({ text: 'Revisar el contrato', ownerNames: ['Martín', 'Proveedor externo'], author: { user_id: 'U1', name: 'Martín' } });
    assert.deepEqual(item.owners.map(o => o.user_id), ['U1', null], 'one member, one name with no member');

    const edited = await request('PATCH', `/api/action-items/${item.item_id}`, {
      text: '  Revisar y firmar el contrato  ', rationale: 'Vence el viernes', owner_ids: ['U1', 'U3', 'UNKNOWN'], keep_owner_names: ['Proveedor externo']
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.item.text, 'Revisar y firmar el contrato');
    assert.equal(edited.body.item.rationale, 'Vence el viernes');
    assert.deepEqual(edited.body.item.owners.map(o => o.name), ['Martín Marchant', 'Ana Ruiz', 'Proveedor externo'], 'unknown ids are dropped');
    assert.deepEqual(edited.body.item.owner_ids, ['U1', 'U3']);

    const dropped = await request('PATCH', `/api/action-items/${item.item_id}`, { owner_ids: ['U1'], keep_owner_names: [], rationale: '' });
    assert.deepEqual(dropped.body.item.owners.map(o => o.name), ['Martín Marchant']);
    assert.equal(dropped.body.item.rationale, null, 'an empty why clears it');

    assert.equal((await request('PATCH', `/api/action-items/${item.item_id}`, { text: '   ' })).status, 400, 'the text can\'t be empty');
    sessionUser = { workspace_id: 'WACT', user_id: 'U2', user_name: 'Felipe Silva' };
    assert.equal((await request('PATCH', `/api/action-items/${item.item_id}`, { text: 'x' })).status, 403, 'only owners, the author or admins');
  });

  test('API: Resolved lists done and cancelled items, most recently finished first', async () => {
    sessionUser = { workspace_id: 'WACT', user_id: 'U2', user_name: 'Felipe Silva' };
    const first = await create({ text: 'Primero hecho', ownerNames: ['Felipe'] });
    const second = await create({ text: 'Después cancelado', ownerNames: ['Felipe'] });
    const open = await create({ text: 'Sigue abierto', ownerNames: ['Felipe'] });
    await request('PATCH', `/api/action-items/${first.item_id}`, { status: 'done' });
    await new Promise(resolve => setTimeout(resolve, 20));
    await request('PATCH', `/api/action-items/${second.item_id}`, { status: 'cancelled' });

    const resolved = await request('GET', '/api/action-items?owner=me&status=resolved');
    const ids = resolved.body.items.map(i => i.item_id);
    assert.ok(ids.indexOf(second.item_id) < ids.indexOf(first.item_id), 'most recently finished first');
    assert.ok(!ids.includes(open.item_id));
    assert.ok(resolved.body.items.every(i => i.status === 'done' || i.status === 'cancelled'));
    const active = await request('GET', '/api/action-items?owner=me&status=open');
    assert.ok(active.body.items.every(i => i.status === 'open'));
  });
});
