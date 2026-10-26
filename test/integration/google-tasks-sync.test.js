const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.warn = () => {};

/**
 * My action items in Google Calendar (docs/specs/2026-10-google-tasks-sync.md): the person's open
 * action items with a due date become tasks in their "Corteza" list, and what they complete or move
 * in Google comes back. Google's Tasks API is a fake in memory here.
 */
describe('Google Tasks sync', { skip }, () => {
  const WS = 'WTASKS';
  const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
  let cleanup;
  let db;
  let sync;
  let google;
  let clock;

  /** A fake Tasks API: lists and tasks in memory, behind the OAuth client's request() */
  function fakeGoogle() {
    const lists = new Map();
    let seq = 0;
    const tick = () => new Date(Date.parse('2026-10-26T10:00:00Z') + (clock += 1000)).toISOString();
    const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
    const client = {
      async request({ url, method = 'GET', data, params }) {
        const path = url.replace('https://tasks.googleapis.com/tasks/v1', '');
        let match;
        if (path === '/users/@me/lists' && method === 'POST') {
          const id = `list${++seq}`;
          lists.set(id, new Map());
          return { data: { id, title: data.title } };
        }
        if ((match = path.match(/^\/users\/@me\/lists\/([^/]+)$/))) {
          if (!lists.has(decodeURIComponent(match[1]))) throw notFound();
          return { data: { id: match[1] } };
        }
        if ((match = path.match(/^\/lists\/([^/]+)\/tasks$/))) {
          const list = lists.get(decodeURIComponent(match[1]));
          if (!list) throw notFound();
          if (method === 'POST') {
            const task = { ...data, id: `task${++seq}`, updated: tick() };
            list.set(task.id, task);
            return { data: task };
          }
          const since = params.updatedMin ? Date.parse(params.updatedMin) : 0;
          return { data: { items: [...list.values()].filter(task => Date.parse(task.updated) >= since) } };
        }
        if ((match = path.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
          const list = lists.get(decodeURIComponent(match[1]));
          const task = list && list.get(decodeURIComponent(match[2]));
          if (!task || task.deleted) throw notFound();
          if (method === 'DELETE') {
            list.delete(task.id);
            return { data: {} };
          }
          Object.assign(task, data, { updated: tick() });
          return { data: task };
        }
        throw new Error(`unexpected ${method} ${url}`);
      }
    };
    /** What the person does in Google */
    const user = {
      tasks: () => [].concat(...[...lists.values()].map(list => [...list.values()].filter(task => !task.deleted))),
      edit(taskId, changes) {
        for (const list of lists.values()) if (list.has(taskId)) Object.assign(list.get(taskId), changes, { updated: tick() });
      }
    };
    return { client, user, lists };
  }

  const connection = () => db.collection('google_connections').findOne({ workspace_id: WS, user_id: 'UA' });
  const run = async () => sync.syncPerson(await connection(), { getClient: () => google.client });
  const item = id => db.collection('action_items').findOne({ workspace_id: WS, item_id: id });
  const taskOf = text => google.user.tasks().find(task => task.title === text);

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    sync = require('../../src/core/actions/google-tasks-sync');
  });

  beforeEach(async () => {
    clock = 0;
    google = fakeGoogle();
    await db.collection('action_items').deleteMany({ workspace_id: WS });
    await db.collection('google_task_links').deleteMany({ workspace_id: WS });
    await db.collection('google_connections').deleteMany({ workspace_id: WS });
    await db.collection('google_connections').insertOne({
      workspace_id: WS, user_id: 'UA', status: 'active', scopes: ['openid', TASKS_SCOPE], tasks_sync: true, refresh_token_encrypted: 'x'
    });
    const base = { workspace_id: WS, space_id: 'S1', status: 'open', created_at: new Date(), updated_at: new Date('2026-10-20T10:00:00Z') };
    await db.collection('action_items').insertMany([
      { ...base, item_id: 'act_dated', text: 'Send the proposal to Kestrel', rationale: 'They asked for annual pricing', owners: [{ name: 'Ana', user_id: 'UA' }], owner_ids: ['UA'], due_date: '2026-11-07', source: { title: 'Pricing sync', occurred_at: '2026-10-20T09:00:00Z' } },
      { ...base, item_id: 'act_undated', text: 'Think about hiring', owners: [{ name: 'Ana', user_id: 'UA' }], owner_ids: ['UA'], due_date: null },
      { ...base, item_id: 'act_secret', text: 'Talk to Carla', owners: [{ name: 'Ana', user_id: 'UA' }], owner_ids: ['UA'], due_date: '2026-11-03', sensitive: true, private_to: 'UA' },
      { ...base, item_id: 'act_bruno', text: 'Bruno reviews costs', owners: [{ name: 'Bruno', user_id: 'UB' }], owner_ids: ['UB'], due_date: '2026-11-04' },
      { ...base, item_id: 'act_done', text: 'Already done', owners: [{ name: 'Ana', user_id: 'UA' }], owner_ids: ['UA'], due_date: '2026-10-01', status: 'done' }
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('her open items with a date become tasks in a Corteza list; undated, done and colleagues’ ones don’t', async () => {
    const result = await run();
    assert.equal(result.created, 2);
    const titles = google.user.tasks().map(task => task.title).sort();
    assert.deepEqual(titles, ['Send the proposal to Kestrel', 'Talk to Carla'], 'sensitive ones sync too (decided Oct 26)');
    const task = taskOf('Send the proposal to Kestrel');
    assert.equal(task.due, '2026-11-07T00:00:00.000Z');
    assert.match(task.notes, /They asked for annual pricing/);
    assert.match(task.notes, /From: Pricing sync · 2026-10-20/);
    assert.match(task.notes, /\/actions\?item=act_dated/);
    assert.equal((await connection()).tasks_count, 2);

    const again = await run();
    assert.equal(again.created + again.updated, 0, 'nothing changed, nothing sent');
  });

  test('Corteza → Google: a new date updates it, done completes it, cancelled or reassigned removes it', async () => {
    await run();
    const actions = require('../../src/core/actions/action-service');
    await actions.updateActionItem(WS, 'act_dated', { due_date: '2026-11-10' });
    await actions.updateActionItem(WS, 'act_secret', { status: 'done' });
    await run();
    assert.equal(taskOf('Send the proposal to Kestrel').due, '2026-11-10T00:00:00.000Z');
    assert.equal(taskOf('Talk to Carla').status, 'completed');

    await actions.updateActionItem(WS, 'act_dated', { status: 'cancelled' });
    await run();
    assert.equal(taskOf('Send the proposal to Kestrel'), undefined);
  });

  test('Google → Corteza: completing marks it done (via Google Tasks), a new date moves it, deleting doesn’t bring it back', async () => {
    await run();
    google.user.edit(taskOf('Send the proposal to Kestrel').id, { status: 'completed' });
    google.user.edit(taskOf('Talk to Carla').id, { due: '2026-11-05T00:00:00.000Z' });
    const result = await run();
    assert.equal(result.pulled, 2);
    const done = await item('act_dated');
    assert.equal(done.status, 'done');
    assert.equal(done.changed_via.client_name, 'Google Tasks');
    assert.equal((await item('act_secret')).due_date, '2026-11-05');
    assert.equal(result.created + result.updated, 0, 'no echo back to Google');

    google.user.edit(taskOf('Talk to Carla').id, { deleted: true });
    await run();
    assert.equal(taskOf('Talk to Carla'), undefined, 'deleted in Google stays deleted while the item doesn’t change');
  });

  test('off: nothing is added and Google changes are not read; the tasks stay', async () => {
    await run();
    await db.collection('google_connections').updateOne({ workspace_id: WS, user_id: 'UA' }, { $set: { tasks_sync: false } });
    google.user.edit(taskOf('Send the proposal to Kestrel').id, { status: 'completed' });
    await db.collection('action_items').updateOne({ workspace_id: WS, item_id: 'act_undated' }, { $set: { due_date: '2026-11-20', updated_at: new Date() } });
    assert.deepEqual(await run(), { skipped: 'off' });
    assert.equal((await item('act_dated')).status, 'open');
    assert.equal(google.user.tasks().length, 2);
  });

  test('no Tasks permission: skipped; a deleted Corteza list is created again', async () => {
    await db.collection('google_connections').updateOne({ workspace_id: WS, user_id: 'UA' }, { $set: { scopes: ['openid'] } });
    assert.deepEqual(await run(), { skipped: 'no_scope' });
    await db.collection('google_connections').updateOne({ workspace_id: WS, user_id: 'UA' }, { $set: { scopes: ['openid', TASKS_SCOPE] } });
    await run();
    google.lists.clear();
    const result = await run();
    assert.equal(result.created, 2);
  });
});
