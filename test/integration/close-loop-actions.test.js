const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('closing an action item closes the loop (docs/specs/2026-10-close-loop-actions.md)', { skip }, () => {
  let cleanup;
  let db;
  let server;
  let base;
  let mine;
  let colleagues;
  const TOPIC = 'top_pricing';
  const MEETING = 'conferenceRecords/pricing-1';

  async function request(method, path, body) {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WLOOP', user_id: 'UC', user_name: 'Cristian', email: 'c@ninja.io', removed_at: null },
      { workspace_id: 'WLOOP', user_id: 'UM', user_name: 'Martín', email: 'm@ninja.io', removed_at: null }
    ]);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mine = await ensurePersonalSpace('WLOOP', 'UC', 'Cristian');
    colleagues = await ensurePersonalSpace('WLOOP', 'UM', 'Martín');

    const outcome = (id, type, text, extra = {}) => ({
      workspace_id: 'WLOOP', space_id: mine.space_id, id, type, text, capture: 'ai', timestamp: new Date().toISOString(), created_at: new Date(), ...extra
    });
    const fromMeeting = { type: 'google_meet', external_id: MEETING, title: 'Pricing' };
    await db.collection('decisions').insertMany([
      // A thread
      outcome(201, 'open_question', '¿Cobramos por la API?', { topic_id: TOPIC, topic: 'Precios' }),
      outcome(202, 'risk', 'Clientes se van con el cambio de precio', { topic_id: TOPIC, topic: 'Precios' }),
      outcome(203, 'risk', 'Riesgo ya mitigado', { topic_id: TOPIC, resolution_status: 'resolved' }),
      outcome(204, 'open_question', 'Pregunta descartada', { topic_id: TOPIC, review_status: 'dismissed' }),
      outcome(205, 'risk', 'Riesgo privado de Martín', { topic_id: TOPIC, space_id: colleagues.space_id }),
      // A meeting without threads
      outcome(301, 'decision', 'Lanzamos el plan anual', { source_details: fromMeeting }),
      outcome(302, 'open_question', '¿Qué descuento damos?', { source_details: fromMeeting }),
      outcome(303, 'risk', 'Margen bajo el objetivo', { source_details: fromMeeting }),
      // An open question an item carries out directly
      outcome(401, 'open_question', '¿Quién lidera el onboarding?')
    ]);
    const action = (itemId, text, extra = {}) => ({
      item_id: itemId, workspace_id: 'WLOOP', space_id: mine.space_id, text, owners: [{ name: 'Cristian', user_id: 'UC' }], owner_ids: ['UC'],
      due_date: null, status: 'open', decision_id: null, topic_id: null, capture: 'ai', created_by: { user_id: 'UC', name: 'Cristian' },
      created_at: new Date(), updated_at: new Date(), ...extra
    });
    await db.collection('action_items').insertMany([
      action('a_thread_1', 'Proponer el precio de la API', { topic_id: TOPIC }),
      action('a_thread_2', 'Hablar con 3 clientes', { topic_id: TOPIC }),
      action('a_meeting', 'Armar la página del plan anual', { decision_id: 301, source: fromMeeting }),
      action('a_direct', 'Definir quién lidera el onboarding', { decision_id: 401 }),
      action('a_loose', 'Comprar café')
    ]);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: { workspace_id: 'WLOOP', user_id: 'UC', user_name: 'Cristian' } }; next(); });
    app.use(require('../../src/http/questions-risks'));
    app.use(require('../../src/http/action-items'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('core: what is related to an item, and what cancelling it would leave alone', async () => {
    const closeLoop = require('../../src/core/actions/close-loop');
    const access = { spaceIds: [mine.space_id], userId: 'UC' };
    const ids = async item => (await closeLoop.relatedOutcomes('WLOOP', item, access)).outcomes.map(o => o.id);
    assert.deepEqual(await ids({ topic_id: TOPIC }), [201, 202]);
    assert.deepEqual(await ids({ decision_id: 301 }), [302, 303]);
    assert.deepEqual(await ids({ decision_id: 401 }), [401]);
    assert.deepEqual(await ids({}), []);
    assert.deepEqual(await ids({ decision_id: 999 }), [], 'an outcome they can’t see links nothing');
    assert.deepEqual((await closeLoop.orphanedBy('WLOOP', { item_id: 'a_thread_1', topic_id: TOPIC }, access)), [], 'a_thread_2 is still open');
    assert.deepEqual((await closeLoop.orphanedBy('WLOOP', { item_id: 'a_meeting', decision_id: 301 }, access)).map(o => o.id), [302, 303]);
    assert.deepEqual((await closeLoop.orphanedBy('WLOOP', { item_id: 'a_loose' }, access)), []);
  });

  test('done: its thread’s open questions and risks, questions first; not resolved, dismissed or private ones', async () => {
    const { status, body } = await request('PATCH', '/api/action-items/a_thread_1', { status: 'done' });
    assert.equal(status, 200);
    assert.deepEqual(body.may_resolve.map(o => [o.id, o.type]), [[201, 'open_question'], [202, 'risk']]);
    assert.deepEqual(body.orphaned, []);
    const still = await db.collection('decisions').findOne({ workspace_id: 'WLOOP', id: 201 });
    assert.notEqual(still.resolution_status, 'resolved', 'a suggestion only');
  });

  test('done without a thread: the questions and risks of the meeting it came from', async () => {
    const { body } = await request('PATCH', '/api/action-items/a_meeting', { status: 'done' });
    assert.deepEqual(body.may_resolve.map(o => o.id), [302, 303]);
  });

  test('done, carrying out a question: that question', async () => {
    const { body } = await request('PATCH', '/api/action-items/a_direct', { status: 'done' });
    assert.deepEqual(body.may_resolve.map(o => o.id), [401]);
  });

  test('done with no thread or outcome: nothing is guessed', async () => {
    const { body } = await request('PATCH', '/api/action-items/a_loose', { status: 'done' });
    assert.deepEqual(body.may_resolve, []);
  });

  test('cancelled: says what is left with no action items, only when it was the last one', async () => {
    // a_thread_1 is done, a_thread_2 is the last open one of the thread
    const last = await request('PATCH', '/api/action-items/a_thread_2', { status: 'cancelled' });
    assert.deepEqual(last.body.may_resolve, [], 'a cancelled item resolved nothing');
    assert.deepEqual(last.body.orphaned.map(o => o.id), [201, 202]);
    assert.equal(last.body.viewer_id, 'UC');

    // Reopen one and cancel another item of the same thread: the first still covers it
    await request('PATCH', '/api/action-items/a_thread_1', { status: 'open' });
    await request('PATCH', '/api/action-items/a_thread_2', { status: 'open' });
    const notLast = await request('PATCH', '/api/action-items/a_thread_2', { status: 'cancelled' });
    assert.deepEqual(notLast.body.orphaned, []);
  });

  test('an action item added for an orphaned question is linked to it and joins its thread', async () => {
    const added = await request('POST', '/api/action-items', { decision_id: 201, text: 'Preguntar a ventas', owner_user_ids: ['UC'] });
    assert.equal(added.status, 201);
    assert.equal(added.body.item.decision_id, 201);
    assert.equal(added.body.item.topic_id, TOPIC);
    // Now the thread has an open item again: cancelling the other one orphans nothing
    await request('PATCH', '/api/action-items/a_thread_1', { status: 'cancelled' });
    const after = await request('PATCH', '/api/action-items/a_thread_2', { status: 'open' });
    assert.equal(after.status, 200);
    const cancelAgain = await request('PATCH', '/api/action-items/a_thread_2', { status: 'cancelled' });
    assert.deepEqual(cancelAgain.body.orphaned, [], 'the new item still covers the thread');
  });

  test('closing what’s suggested uses the questions-and-risks endpoint', async () => {
    const closed = await request('POST', '/api/questions-risks/202/resolve', { note: 'Resuelto con el pendiente: Proponer el precio de la API' });
    assert.equal(closed.status, 200);
    const risk = await db.collection('decisions').findOne({ workspace_id: 'WLOOP', id: 202 });
    assert.equal(risk.resolution_status, 'resolved');
  });
});
