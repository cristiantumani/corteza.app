const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const LONG_TEXT = Array(80).fill('Hablamos de la certificación ISO 27001').join('. ');

describe('topic threads: pipeline, linked items, close-the-loop suggestions, only your spaces', { skip }, () => {
  let db;
  let cleanup;
  let server;
  let base;
  let sessionUser;
  let mine;
  let colleagues;
  const TOPIC = 'top_0123456789abcdef';

  async function request(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WTOP', user_id: 'UC', user_name: 'Cristian Tumani', email: 'c@ninja.io', role: 'member', removed_at: null },
      { workspace_id: 'WTOP', user_id: 'UM', user_name: 'Martín Marchant', email: 'm@ninja.io', role: 'member', removed_at: null }
    ]);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mine = await ensurePersonalSpace('WTOP', 'UC', 'Cristian Tumani');
    colleagues = await ensurePersonalSpace('WTOP', 'UM', 'Martín Marchant');

    // The ISO 27001 thread in Cristian's space, plus a colleague's private items with the same topic id
    const outcome = (id, spaceId, type, text) => ({
      workspace_id: 'WTOP', space_id: spaceId, id, type, text, topic_id: TOPIC, topic: 'Certificación ISO 27001',
      capture: 'ai', embedding: [0.1], timestamp: new Date(Date.now() - id * 1000).toISOString(), created_at: new Date()
    });
    await db.collection('decisions').insertMany([
      outcome(101, mine.space_id, 'open_question', '¿Conviene certificarnos en ISO 27001?'),
      outcome(102, mine.space_id, 'risk', 'Sin la certificación podemos perder clientes enterprise'),
      outcome(103, mine.space_id, 'decision', 'Se evaluará la certificación este trimestre'),
      outcome(104, colleagues.space_id, 'risk', 'Riesgo privado de Martín'),
      { workspace_id: 'WTOP', space_id: mine.space_id, id: 105, type: 'risk', text: 'Riesgo sin hilo', timestamp: new Date().toISOString(), created_at: new Date() }
    ]);
    const action = (itemId, spaceId, ownerId, text) => ({
      item_id: itemId, workspace_id: 'WTOP', space_id: spaceId, text, topic_id: TOPIC, topic: 'Certificación ISO 27001',
      owners: [{ name: ownerId === 'UC' ? 'Cristian Tumani' : 'Martín Marchant', user_id: ownerId, email: null }], owner_ids: [ownerId],
      due_date: new Date().toISOString().slice(0, 10), status: 'open', decision_id: null, capture: 'ai',
      created_by: { user_id: ownerId, name: null }, created_at: new Date(), updated_at: new Date()
    });
    await db.collection('action_items').insertMany([
      action('act_iso', mine.space_id, 'UC', 'Investigar los requisitos de ISO 27001'),
      action('act_private', colleagues.space_id, 'UM', 'Tarea privada de Martín')
    ]);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/questions-risks'));
    app.use(require('../../src/http/action-items'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    sessionUser = { workspace_id: 'WTOP', user_id: 'UC', user_name: 'Cristian Tumani' };
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('a question lists the rest of its thread, never a colleague\'s private items', async () => {
    const { status, body } = await request('GET', '/api/questions-risks');
    assert.equal(status, 200);
    const question = body.items.find(item => item.id === 101);
    assert.equal(question.topic, 'Certificación ISO 27001');
    assert.deepEqual(question.linked.outcomes.map(outcome => outcome.id).sort(), [102, 103]);
    assert.deepEqual(question.linked.actions.map(action => action.item_id), ['act_iso']);
    assert.deepEqual(question.linked.actions[0].owners, [{ name: 'Cristian Tumani' }], 'owners carry names only');
    assert.ok(!JSON.stringify(body).includes('Martín'), 'nothing from a colleague\'s private space');
    assert.deepEqual(body.items.find(item => item.id === 105).linked, { outcomes: [], actions: [] });
  });

  test('?topic= shows one thread', async () => {
    const { body } = await request('GET', `/api/questions-risks?topic=${TOPIC}&status=all`);
    assert.deepEqual(body.items.map(item => item.id).sort(), [101, 102]);
    assert.equal(body.topic, 'Certificación ISO 27001');
    const invalid = await request('GET', '/api/questions-risks?topic=nope');
    assert.ok(invalid.body.items.some(item => item.id === 105), 'an invalid topic is ignored');
  });

  test('an action item says which thread it belongs to', async () => {
    const { body } = await request('GET', '/api/action-items?owner=me');
    const item = body.items.find(entry => entry.item_id === 'act_iso');
    assert.deepEqual(item.thread, {
      topic_id: TOPIC, topic: 'Certificación ISO 27001', questions: 1, risks: 1,
      open_questions: [{ id: 101, text: '¿Conviene certificarnos en ISO 27001?' }]
    });
  });

  test('the morning summary says what question a due item is the next step on', async () => {
    const { buildDailySummary } = require('../../src/jobs/daily-digest');
    const summary = await buildDailySummary('WTOP', 'UC', new Date(Date.now() - 3600000), new Date(), 'UTC', { meetingPrep: async () => [] });
    const item = summary.planItems.find(entry => entry.item_id === 'act_iso');
    assert.equal(item.next_step_on, '¿Conviene certificarnos en ISO 27001?');
    assert.equal(item.topic_id, undefined);
  });

  test('marking the next step done suggests answering the question; answering it suggests closing the risk', async () => {
    const done = await request('PATCH', '/api/action-items/act_iso', { status: 'done' });
    assert.equal(done.status, 200);
    assert.deepEqual(done.body.linked_questions, [{ id: 101, type: 'open_question', text: '¿Conviene certificarnos en ISO 27001?' }]);
    const stillOpen = await db.collection('decisions').findOne({ workspace_id: 'WTOP', id: 101 });
    assert.notEqual(stillOpen.resolution_status, 'resolved', 'only a suggestion: nothing closes by itself');

    const answered = await request('POST', '/api/questions-risks/101/resolve', { note: 'Sí, en Q1' });
    assert.equal(answered.status, 200);
    assert.deepEqual(answered.body.linked_risks, [{ id: 102, type: 'risk', text: 'Sin la certificación podemos perder clientes enterprise' }],
      'the colleague\'s private risk is not offered');

    const again = await request('PATCH', '/api/action-items/act_iso', { status: 'done' });
    assert.deepEqual(again.body.linked_questions, [], 'already done: nothing to suggest');
  });

  test('the pipeline gives items about the same subject one thread', async () => {
    const pipeline = require('../../src/ingestion/pipeline');
    const extract = async () => ({
      model: 'fake',
      decisions: [
        { decision_text: '¿Conviene certificarnos en ISO 27001?', decision_type: 'open_question', confidence: 0.9, topic: 'Certificación ISO 27001' },
        { decision_text: 'Podemos perder clientes enterprise', decision_type: 'risk', confidence: 0.8, topic: 'certificacion ISO 27001' },
        { decision_text: 'Cristian investiga los requisitos', decision_type: 'action_item', confidence: 0.9, owner_names: ['Cristian'], topic: 'Certificación ISO 27001' },
        { decision_text: 'Se contrata un diseñador', decision_type: 'decision', confidence: 0.9, topic: 'Contratación' }
      ]
    });
    const result = await pipeline.ingestTranscript({
      workspaceId: 'WTOP', source: 'google_meet', externalId: 'conferenceRecords/iso', title: 'Weekly', text: LONG_TEXT,
      participants: ['Cristian'], spaceId: mine.space_id, spaceName: mine.name, author: { user_id: 'UC', name: 'Cristian Tumani' }
    }, { extract, reviewAssignments: async () => ({}) });
    assert.equal(result.status, 'completed');

    const outcomes = await db.collection('decisions').find({ workspace_id: 'WTOP', 'source_details.external_id': 'conferenceRecords/iso' }).sort({ id: 1 }).toArray();
    const items = await db.collection('action_items').find({ workspace_id: 'WTOP', 'source.external_id': 'conferenceRecords/iso' }).toArray();
    const [question, risk, hire] = outcomes;
    assert.match(question.topic_id, /^top_[0-9a-f]{16}$/);
    assert.equal(question.topic, 'Certificación ISO 27001');
    assert.equal(risk.topic_id, question.topic_id);
    assert.equal(items[0].topic_id, question.topic_id);
    assert.equal(hire.topic_id, null, 'a lone subject has no thread');
  });
});
