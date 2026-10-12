const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('the thread as a unit (docs/specs/2026-10-thread-as-unit.md)', { skip }, () => {
  let db;
  let cleanup;
  let server;
  let base;
  let sessionUser;
  let mine;
  let colleagues;
  const W = 'WTHR';
  const T = 'top_aaaa1111';
  const OTHER = 'top_bbbb2222';
  const CRISTIAN = { workspace_id: W, user_id: 'UC', user_name: 'Cristian' };
  const MARTIN = { workspace_id: W, user_id: 'UM', user_name: 'Martín' };
  const ADMIN = { workspace_id: W, user_id: 'UA', user_name: 'Admin' };
  const DAY = 86400000;

  async function request(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertMany([
      { workspace_id: W, user_id: 'UC', user_name: 'Cristian', email: 'c@ninja.io', role: 'member', removed_at: null },
      { workspace_id: W, user_id: 'UM', user_name: 'Martín', email: 'm@ninja.io', role: 'member', removed_at: null },
      { workspace_id: W, user_id: 'UA', user_name: 'Admin', email: 'a@ninja.io', role: 'member', removed_at: null }
    ]);
    await db.collection('workspace_admins').insertOne({ workspace_id: W, user_id: 'UA', role: 'admin', deactivated_at: null });
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mine = await ensurePersonalSpace(W, 'UC', 'Cristian');
    colleagues = await ensurePersonalSpace(W, 'UM', 'Martín');
    await db.collection('workspace_spaces').insertOne({ workspace_id: W, space_id: 'sp_team', name: 'Team', visibility: 'public', archived: false });

    const outcome = (id, type, text, extra = {}) => ({
      workspace_id: W, space_id: mine.space_id, id, type, text, topic_id: T, topic: 'ISO 27001', user_id: 'UC',
      capture: 'ai', resolution_status: 'open', embedding: [0.1], created_at: new Date(),
      timestamp: new Date(Date.now() - 12 * DAY).toISOString(),
      source_details: { type: 'google_meet', title: 'Weekly Product' }, ...extra
    });
    await db.collection('decisions').insertMany([
      outcome(201, 'open_question', '¿Vamos por ISO 27001?'),
      // In Cristian's space, but Martín wrote it: only Martín or an admin may take it out
      outcome(202, 'risk', 'Perder clientes enterprise', { user_id: 'UM' }),
      outcome(203, 'decision', 'Pedimos cotización a dos auditores', { timestamp: new Date(Date.now() - 5 * DAY).toISOString(), source_details: { title: 'Follow-up' } }),
      outcome(204, 'decision', 'Decisión privada de Martín', { space_id: colleagues.space_id, user_id: 'UM' }),
      outcome(206, 'decision', 'Otra decisión de otro tema', { topic_id: OTHER, topic: 'Pricing' }),
      // A shared space everyone sees; Martín wrote it
      outcome(207, 'decision', 'Decisión del equipo', { topic_id: OTHER, topic: 'Pricing', space_id: 'sp_team', user_id: 'UM' })
    ]);
    const action = (itemId, text, extra = {}) => ({
      item_id: itemId, workspace_id: W, space_id: mine.space_id, text, topic_id: T, topic: 'ISO 27001',
      owners: [{ name: 'Cristian', user_id: 'UC' }], owner_ids: ['UC'], status: 'open', capture: 'ai',
      due_date: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10),
      created_by: { user_id: 'UC', name: 'Cristian' }, created_at: new Date(Date.now() - 12 * DAY), updated_at: new Date(Date.now() - 12 * DAY),
      source: { title: 'Weekly Product', occurred_at: new Date(Date.now() - 12 * DAY) }, ...extra
    });
    await db.collection('action_items').insertMany([
      action('a_quote', 'Cotizar auditores'),
      action('a_private', 'Tarea privada de Martín', { space_id: colleagues.space_id, owners: [{ name: 'Martín', user_id: 'UM' }], owner_ids: ['UM'], created_by: { user_id: 'UM' } })
    ]);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/questions-risks'));
    app.use(require('../../src/http/threads'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    sessionUser = CRISTIAN;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('status line: age, the overdue next step, decisions that may answer it', async () => {
    const { body } = await request('GET', '/api/questions-risks');
    const question = body.items.find(item => item.id === 201);
    assert.equal(question.status.age_days, 12);
    assert.equal(question.status.in_thread, true);
    assert.equal(question.status.next_step.item_id, 'a_quote');
    assert.equal(question.status.next_step.mine, true);
    assert.equal(question.status.next_step.overdue, true);
    assert.equal(question.status.may_answer, 1, 'only the decision Cristian can see');
    assert.equal(question.can_edit, true);
    assert.equal(body.items.find(item => item.id === 202).can_edit, false);
  });

  test('thread view: only what the viewer can see, grouped by meeting, with its summary', async () => {
    const { status, body } = await request('GET', `/api/threads/${T}`);
    assert.equal(status, 200);
    assert.equal(body.topic, 'ISO 27001');
    assert.deepEqual({ ...body.summary, last_activity: undefined },
      { open_questions: 1, risks: 1, next_steps: 1, overdue: 1, last_activity: undefined });
    assert.deepEqual(body.meetings.map(group => group.title), ['Weekly Product', 'Follow-up']);
    const ids = body.meetings.flatMap(group => group.items.map(item => item.id));
    assert.deepEqual(ids.sort(), [201, 202, 203, 'a_quote'].sort());
    assert.ok(!JSON.stringify(body).includes('Martín'), 'nothing from a colleague\'s private space');
    assert.ok(!JSON.stringify(body).includes('owner_ids'), 'no owner ids sent');

    sessionUser = MARTIN;
    const theirs = await request('GET', `/api/threads/${T}`);
    assert.deepEqual(theirs.body.meetings.flatMap(group => group.items.map(item => item.id)).sort(), [204, 'a_private'].sort());
    sessionUser = CRISTIAN;

    assert.equal((await request('GET', '/api/threads/top_ffff0000')).status, 404);
    assert.equal((await request('GET', '/api/threads/not-a-topic')).status, 404);
  });

  test('use as answer: a decision of the same thread, visible to the person; undo reopens', async () => {
    const otherThread = await request('POST', '/api/questions-risks/201/resolve', { decision_id: 206 });
    assert.equal(otherThread.status, 404);
    const hidden = await request('POST', '/api/questions-risks/201/resolve', { decision_id: 204 });
    assert.equal(hidden.status, 404);

    const used = await request('POST', '/api/questions-risks/201/resolve', { decision_id: 203 });
    assert.equal(used.status, 200);
    assert.equal(used.body.answered_by, 203);
    assert.match(used.body.resolution_note, /^Answered by the decision: Pedimos cotización a dos auditores \(Follow-up, /);
    assert.deepEqual(used.body.linked_risks.map(risk => risk.id), [202], 'offers to close the thread\'s risk');
    const stored = await db.collection('decisions').findOne({ workspace_id: W, id: 201 });
    assert.equal(stored.resolution_status, 'resolved');
    assert.equal(stored.answered_by, 203);

    const risk = await request('POST', '/api/questions-risks/202/resolve', { decision_id: 203 });
    assert.match(risk.body.resolution_note, /^Mitigated by the decision:/);

    await request('POST', '/api/questions-risks/201/reopen');
    await request('POST', '/api/questions-risks/202/reopen');
    const reopened = await db.collection('decisions').findOne({ workspace_id: W, id: 201 });
    assert.equal(reopened.resolution_status, 'open');
    assert.equal(reopened.answered_by, null);
  });

  test('not related: only whoever can edit it; it stays out of the thread; undo puts it back', async () => {
    const forbidden = await request('POST', '/api/threads/unlink', { kind: 'decision', id: 202 });
    assert.equal(forbidden.status, 403);
    assert.equal((await request('POST', '/api/threads/unlink', { kind: 'action_item', id: 'a_private' })).status, 404);
    assert.equal((await request('POST', '/api/threads/unlink', { kind: 'space', id: 1 })).status, 400);

    const out = await request('POST', '/api/threads/unlink', { kind: 'action_item', id: 'a_quote' });
    assert.equal(out.status, 200);
    assert.equal(out.body.topic_id, T);
    let item = await db.collection('action_items').findOne({ workspace_id: W, item_id: 'a_quote' });
    assert.equal(item.topic_id, null);
    assert.deepEqual(item.unlinked_topics, [T]);
    const status = (await request('GET', '/api/questions-risks')).body.items.find(entry => entry.id === 201).status;
    assert.equal(status.next_step, null, 'no next step left in the thread');

    // Cross-meeting links don't put it back
    const { loadEarlierItems, applyLinks } = require('../../src/core/links/cross-meeting');
    const earlier = await loadEarlierItems({ workspaceId: W, spaceIds: [mine.space_id], ownerId: 'UC', meetingId: null, before: new Date() });
    const candidate = earlier.find(entry => entry.id === 'a_quote');
    assert.deepEqual(candidate.unlinked_topics, [T]);
    await applyLinks(W, [{ newItem: { kind: 'decision', id: 203, topic_id: T, topic: 'ISO 27001' }, earlier: candidate, relation: 'none' }]);
    item = await db.collection('action_items').findOne({ workspace_id: W, item_id: 'a_quote' });
    assert.equal(item.topic_id, null);

    assert.equal((await request('POST', '/api/threads/relink', { kind: 'action_item', id: 'a_quote', topic_id: OTHER })).status, 400);
    const back = await request('POST', '/api/threads/relink', { kind: 'action_item', id: 'a_quote', topic_id: T });
    assert.equal(back.status, 200);
    item = await db.collection('action_items').findOne({ workspace_id: W, item_id: 'a_quote' });
    assert.equal(item.topic_id, T);
    assert.equal(item.topic, 'ISO 27001');
    assert.deepEqual(item.unlinked_topics, []);

    assert.equal((await request('POST', '/api/threads/unlink', { kind: 'decision', id: 207 })).status, 403, 'a colleague\'s outcome');
    sessionUser = ADMIN;
    assert.equal((await request('POST', '/api/threads/unlink', { kind: 'decision', id: 202 })).status, 404, 'personal spaces stay private, even to admins');
    assert.equal((await request('POST', '/api/threads/unlink', { kind: 'decision', id: 207 })).status, 200, 'an admin can take it out');
    sessionUser = CRISTIAN;
  });
});
