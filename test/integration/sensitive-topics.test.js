const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const LONG_TEXT = 'Cristian: hablemos del equipo comercial y de cómo seguimos este trimestre. '.repeat(20);

describe('sensitive topics (docs/specs/2026-10-sensitive-topics.md)', { skip }, () => {
  let cleanup;
  let db;
  let server;
  let base;
  let mine;
  let jessSpace;
  let sessionUser;
  const CRISTIAN = { workspace_id: 'WSEN', user_id: 'UC', user_name: 'Cristian Tumani' };
  const JESS = { workspace_id: 'WSEN', user_id: 'UJ', user_name: 'Jess Soto' };

  async function request(user, method, path, body) {
    sessionUser = user;
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WSEN', user_id: 'UC', user_name: 'Cristian Tumani', email: 'c@ninja.io', removed_at: null },
      { workspace_id: 'WSEN', user_id: 'UJ', user_name: 'Jess Soto', email: 'j@ninja.io', removed_at: null }
    ]);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mine = await ensurePersonalSpace('WSEN', 'UC', 'Cristian Tumani');
    jessSpace = await ensurePersonalSpace('WSEN', 'UJ', 'Jess Soto');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/action-items'));
    app.use(require('../../src/http/questions-risks'));
    app.use(require('../../src/http/sensitive'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('the AI flags one item; its whole thread is private to the capturer, and Jess loses access to her task', async () => {
    const pipeline = require('../../src/ingestion/pipeline');
    const extract = async () => ({
      model: 'fake',
      decisions: [
        { decision_text: '¿Rocha sigue en el equipo comercial?', decision_type: 'open_question', confidence: 0.9, topic: 'Continuidad de Rocha', sensitive: true },
        { decision_text: 'Jess prepara el plan de salida de Rocha', decision_type: 'action_item', confidence: 0.9, owner_names: ['Jess Soto'], topic: 'Continuidad de Rocha' },
        { decision_text: 'Jess envía la propuesta a Acme', decision_type: 'action_item', confidence: 0.9, owner_names: ['Jess Soto'], topic: 'Acme' }
      ]
    });
    const result = await pipeline.ingestTranscript({
      workspaceId: 'WSEN', source: 'google_meet', externalId: 'conferenceRecords/one-on-one', title: 'Weekly Jess / Cris', text: LONG_TEXT,
      participants: ['Cristian', 'Jess'], spaceId: mine.space_id, spaceName: mine.name, author: { user_id: 'UC', name: 'Cristian Tumani' }
    }, { extract, reviewAssignments: async () => ({}), linkMeetings: false });
    assert.equal(result.status, 'completed');

    const question = await db.collection('decisions').findOne({ workspace_id: 'WSEN', 'source_details.external_id': 'conferenceRecords/one-on-one' });
    assert.equal(question.sensitive, true);
    assert.equal(question.private_to, 'UC');
    const items = await db.collection('action_items').find({ workspace_id: 'WSEN', 'source.external_id': 'conferenceRecords/one-on-one' }).toArray();
    const exit = items.find(item => item.topic_id === question.topic_id);
    const acme = items.find(item => item !== exit);
    assert.equal(exit.sensitive, true, 'same thread: sensitive too');
    assert.deepEqual(exit.owners.map(o => o.name), ['Jess Soto'], 'Jess keeps her name on it');
    assert.deepEqual(exit.owner_ids, [], '…but no access');
    assert.equal(acme.sensitive, false);
    assert.deepEqual(acme.owner_ids, ['UJ']);

    const jessList = await request(JESS, 'GET', '/api/action-items?owner=all');
    assert.deepEqual(jessList.body.items.map(i => i.text), ['Jess envía la propuesta a Acme'], 'Jess sees only the non-sensitive one');
    const mineList = await request(CRISTIAN, 'GET', '/api/action-items?owner=all');
    assert.equal(mineList.body.items.length, 2);
    assert.ok(mineList.body.items.find(i => i.item_id === exit.item_id).sensitive);
  });

  // A thread seeded directly (the tests below don't depend on the pipeline)
  let seeded = 0;
  async function seedThread(topicId) {
    const { createActionItem } = require('../../src/core/actions/action-service');
    const author = { user_id: 'UC', name: 'Cristian Tumani' };
    seeded += 1;
    const question = {
      workspace_id: 'WSEN', space_id: mine.space_id, id: 9000 + seeded, type: 'open_question', text: '¿Fernando y Javier vuelven a un rol IC?',
      user_id: 'UC', source_details: { type: 'google_meet', external_id: `conferenceRecords/${topicId}` }, topic_id: topicId, topic: 'Reestructuración',
      sensitive: false, timestamp: new Date().toISOString(), created_at: new Date()
    };
    await db.collection('decisions').insertOne({ ...question });
    const task = await createActionItem({ workspaceId: 'WSEN', spaceId: mine.space_id, text: 'Jess conversa con Fernando', ownerUserIds: ['UJ'], topicId, topic: 'Reestructuración', author });
    const other = await createActionItem({ workspaceId: 'WSEN', spaceId: mine.space_id, text: 'Jess envía la propuesta a Acme', ownerUserIds: ['UJ'], author });
    return { question, task, other };
  }
  const jessSees = async () => (await request(JESS, 'GET', '/api/action-items?owner=all')).body.items.map(i => i.item_id);

  test('marking one marks its thread; only the person it is private to can take the mark off', async () => {
    const { question, task, other } = await seedThread('top_restructure');
    assert.ok((await jessSees()).includes(task.item_id));

    const marked = await request(CRISTIAN, 'PUT', '/api/sensitive', { kind: 'decision', id: question.id, sensitive: true });
    assert.equal(marked.status, 200);
    assert.deepEqual([marked.body.decisions, marked.body.action_items], [1, 1], 'the question and its thread’s action item');
    const storedTask = await db.collection('action_items').findOne({ workspace_id: 'WSEN', item_id: task.item_id });
    assert.equal(storedTask.sensitive, true);
    assert.deepEqual(storedTask.owner_ids, []);
    assert.deepEqual(storedTask.owners.map(o => o.name), ['Jess Soto'], 'Jess keeps her name on it');
    const seen = await jessSees();
    assert.ok(!seen.includes(task.item_id), 'Jess no longer sees it');
    assert.ok(seen.includes(other.item_id), 'the rest of her items stay');
    const mineNow = (await request(CRISTIAN, 'GET', '/api/action-items?owner=all')).body.items.find(i => i.item_id === task.item_id);
    assert.equal(mineNow.sensitive, true, 'Cristian still sees it, flagged');
    const questions = await request(CRISTIAN, 'GET', '/api/questions-risks');
    assert.equal(questions.body.items.find(i => i.id === question.id).sensitive, true);

    // Jess can't reach it at all
    assert.equal((await request(JESS, 'PUT', '/api/sensitive', { kind: 'action_item', id: task.item_id, sensitive: false })).status, 404);

    const unmarked = await request(CRISTIAN, 'PUT', '/api/sensitive', { kind: 'action_item', id: task.item_id, sensitive: false });
    assert.equal(unmarked.status, 200);
    assert.deepEqual((await db.collection('action_items').findOne({ workspace_id: 'WSEN', item_id: task.item_id })).owner_ids, ['UJ'], 'access comes back');
    assert.ok((await jessSees()).includes(task.item_id));

    assert.equal((await request(CRISTIAN, 'PUT', '/api/sensitive', { kind: 'nope', id: 1, sensitive: true })).status, 400);
    assert.equal((await request(CRISTIAN, 'PUT', '/api/sensitive', { kind: 'decision', id: question.id, sensitive: 'yes' })).status, 400);
  });

  test('a thread with a sensitive item spreads it to items that join later', async () => {
    const { spreadSensitivity } = require('../../src/core/privacy/sensitive');
    const { createActionItem } = require('../../src/core/actions/action-service');
    const { question } = await seedThread('top_spread');
    await request(CRISTIAN, 'PUT', '/api/sensitive', { kind: 'decision', id: question.id, sensitive: true });
    const later = await createActionItem({
      workspaceId: 'WSEN', spaceId: mine.space_id, text: 'Jess agenda la reunión con RR.HH.', ownerUserIds: ['UJ'], topicId: 'top_spread', topic: 'Reestructuración', author: { user_id: 'UC', name: 'Cristian' }
    });
    assert.deepEqual(later.owner_ids, ['UJ']);
    assert.equal(await spreadSensitivity('WSEN', ['top_spread']), 1);
    const stored = await db.collection('action_items').findOne({ workspace_id: 'WSEN', item_id: later.item_id });
    assert.equal(stored.sensitive, true);
    assert.equal(stored.private_to, 'UC');
    assert.deepEqual(stored.owner_ids, []);
    assert.equal(await spreadSensitivity('WSEN', ['top_none', null]), 0, 'threads without a sensitive item stay as they are');

    // Jess's own capture in her personal space, in the same thread (Cristian owns it): it stays hers
    const jessOwn = await createActionItem({
      workspaceId: 'WSEN', spaceId: jessSpace.space_id, text: 'Cristian revisa el organigrama', ownerUserIds: ['UC'], topicId: 'top_spread', author: { user_id: 'UJ', name: 'Jess' }
    });
    await spreadSensitivity('WSEN', ['top_spread']);
    const untouched = await db.collection('action_items').findOne({ workspace_id: 'WSEN', item_id: jessOwn.item_id });
    assert.equal(untouched.space_id, jessSpace.space_id, 'not moved into Cristian’s space');
    assert.notEqual(untouched.sensitive, true);
  });

  test('a sensitive item created directly, and editing its owners, stay private', async () => {
    const { createActionItem, updateActionItem } = require('../../src/core/actions/action-service');
    const item = await createActionItem({
      workspaceId: 'WSEN', spaceId: mine.space_id, text: 'Revisar el sueldo de Rocha', ownerUserIds: ['UJ', 'UC'], sensitive: true, author: { user_id: 'UC', name: 'Cristian' }
    });
    assert.deepEqual(item.owner_ids, ['UC']);
    assert.equal(item.private_to, 'UC');
    await updateActionItem('WSEN', item.item_id, { owners: [{ user_id: 'UJ', name: 'Jess Soto' }] });
    const stored = await db.collection('action_items').findOne({ workspace_id: 'WSEN', item_id: item.item_id });
    assert.deepEqual(stored.owner_ids, [], 'Jess as the only owner still has no access');
  });
});
