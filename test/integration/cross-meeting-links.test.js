const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// Fake embeddings: designer hiring → [1, 0], anything else → [0, 1]
const embed = async text => (/dise[ñn]ador|designer|Florencia|candidatas/i.test(text) ? [1, 0] : [0, 1]);

/** Fake Claude: a new decision answers every earlier question and completes every earlier action item */
async function judge(prompt) {
  const earlier = [...prompt.matchAll(/^(E\d+) \[([^\]]+)\]/gm)].map(m => ({ label: m[1], type: m[2] }));
  const decisions = [...prompt.matchAll(/^(N\d+) \[Decision\]/gm)].map(m => m[1]);
  const links = decisions.flatMap(n => earlier.map(e => ({
    new: n, earlier: e.label,
    relation: e.type === 'Open question' ? 'answers' : e.type === 'Action item' ? 'completes' : 'none',
    reason: 'Se contrató a la diseñadora'
  })));
  return JSON.stringify({ links });
}

describe('cross-meeting links: link, close on confirm, undo, only your spaces, migration 014', { skip }, () => {
  let db;
  let cleanup;
  let server;
  let base;
  let mine;
  let colleagues;
  const sessionUser = { workspace_id: 'WCML', user_id: 'UC', user_name: 'Cristian Tumani' };
  const daysAgo = days => new Date(Date.now() - days * 24 * 3600 * 1000);

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
      { workspace_id: 'WCML', user_id: 'UC', user_name: 'Cristian Tumani', role: 'member', removed_at: null },
      { workspace_id: 'WCML', user_id: 'UM', user_name: 'Martín Marchant', role: 'member', removed_at: null }
    ]);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mine = await ensurePersonalSpace('WCML', 'UC', 'Cristian Tumani');
    colleagues = await ensurePersonalSpace('WCML', 'UM', 'Martín Marchant');

    const outcome = (id, spaceId, type, text, extra = {}) => ({
      workspace_id: 'WCML', space_id: spaceId, id, type, text, user_id: spaceId === mine.space_id ? 'UC' : 'UM',
      capture: 'ai', review_status: 'confirmed', embedding: null, timestamp: daysAgo(20).toISOString(), created_at: daysAgo(20),
      source_details: { type: 'google_meet', external_id: 'meet_old', title: 'Weekly Ops' }, ...extra
    });
    await db.collection('decisions').insertMany([
      outcome(1, mine.space_id, 'open_question', '¿Contratamos un diseñador este trimestre?', { topic_id: 'top_hiring', topic: 'Contratar diseñador' }),
      outcome(2, mine.space_id, 'risk', 'El presupuesto de marketing no alcanza'),
      outcome(3, colleagues.space_id, 'open_question', '¿Qué diseñador prefiere Martín?'),
      outcome(4, mine.space_id, 'open_question', '¿Contratamos un diseñador junior?', { resolution_status: 'resolved' })
    ]);
    await db.collection('action_items').insertOne({
      item_id: 'act_interview', workspace_id: 'WCML', space_id: mine.space_id, text: 'Entrevistar a las candidatas',
      owners: [{ name: 'Cristian Tumani', user_id: 'UC' }], owner_ids: ['UC'], status: 'open', capture: 'ai', due_date: null,
      source: { type: 'google_meet', external_id: 'meet_old', title: 'Weekly Ops', occurred_at: daysAgo(20).toISOString() },
      created_by: { user_id: 'UC', name: 'Cristian Tumani' }, created_at: daysAgo(20), updated_at: daysAgo(20)
    });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/decision-review'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    await cleanup();
  });

  test('a new decision links to open items of earlier meetings in my spaces and joins their thread', async () => {
    const { linkAcrossMeetings } = require('../../src/core/links/cross-meeting');
    await db.collection('decisions').insertOne({
      workspace_id: 'WCML', space_id: mine.space_id, id: 10, type: 'decision', text: 'Contratamos a Florencia como Product Designer',
      user_id: 'UC', capture: 'ai', review_status: null, timestamp: new Date().toISOString(), created_at: new Date(),
      topic_id: 'top_new', topic: 'Contratación', source_details: { type: 'google_meet', external_id: 'meet_new', title: 'Weekly Ops' }
    });
    const decision = await db.collection('decisions').findOne({ id: 10 });
    const result = await linkAcrossMeetings({
      workspaceId: 'WCML', spaceIds: [mine.space_id], ownerId: 'UC', meetingId: 'meet_new', occurredAt: new Date(), decisions: [decision]
    }, { embed, judge });

    const linked = result.links.map(l => `${l.earlier.kind}:${l.earlier.id}:${l.relation}`).sort();
    assert.deepEqual(linked, ['action_item:act_interview:completes', 'decision:1:answers'],
      'not the colleague\'s question (#3), the unrelated risk (#2) or the answered question (#4)');
    const saved = await db.collection('decisions').findOne({ id: 10 });
    assert.deepEqual(saved.resolves.map(r => `${r.kind}:${r.id}:${r.status}`).sort(), ['action_item:act_interview:suggested', 'decision:1:suggested']);
    assert.equal(saved.resolves[0].reason, 'Se contrató a la diseñadora');
    assert.equal(saved.topic_id, 'top_hiring', 'joins the earlier thread');
    const action = await db.collection('action_items').findOne({ item_id: 'act_interview' });
    assert.equal(action.topic_id, 'top_hiring', 'the earlier action item joins the thread too');
    assert.equal((await db.collection('decisions').findOne({ id: 1 })).resolution_status, undefined, 'nothing is closed yet');
  });

  test('GET links describes what it may close; confirm closes only the checked ones; undo reopens', async () => {
    const links = await request('GET', '/api/decisions/10/links');
    assert.equal(links.status, 200);
    assert.deepEqual(links.body.may_close.map(l => l.id).sort(), [1, 'act_interview'].sort());
    const question = links.body.may_close.find(l => l.id === 1);
    assert.equal(question.text, '¿Contratamos un diseñador este trimestre?');
    assert.equal(question.meeting, 'Weekly Ops');

    const confirmed = await request('POST', '/api/decisions/10/review', { action: 'confirm', close: [{ kind: 'decision', id: 1 }, { kind: 'decision', id: 3 }] });
    assert.equal(confirmed.status, 200);
    assert.deepEqual(confirmed.body.closed, [{ kind: 'decision', id: 1 }], 'a colleague\'s item or one not suggested is never closed');
    const answered = await db.collection('decisions').findOne({ id: 1 });
    assert.equal(answered.resolution_status, 'resolved');
    assert.match(answered.resolution_note, /Contratamos a Florencia/);
    assert.equal((await db.collection('decisions').findOne({ id: 3 })).resolution_status, undefined);
    assert.equal((await db.collection('action_items').findOne({ item_id: 'act_interview' })).status, 'open', 'unchecked: stays open');

    const after = await request('GET', '/api/decisions/10/links');
    assert.deepEqual(after.body.may_close.map(l => l.id), ['act_interview'], 'the closed one is no longer offered');

    const undo = await request('POST', '/api/decisions/10/links/reopen', { items: [{ kind: 'decision', id: 1 }] });
    assert.deepEqual(undo.body.reopened, [{ kind: 'decision', id: 1 }]);
    assert.equal((await db.collection('decisions').findOne({ id: 1 })).resolution_status, 'open');

    const closeLater = await request('POST', '/api/decisions/10/links/close', { close: [{ kind: 'action_item', id: 'act_interview' }] });
    assert.deepEqual(closeLater.body.closed, [{ kind: 'action_item', id: 'act_interview' }]);
    assert.equal((await db.collection('action_items').findOne({ item_id: 'act_interview' })).status, 'done');
  });

  test('a colleague can\'t read or close another person\'s links', async () => {
    sessionUser.user_id = 'UM';
    sessionUser.user_name = 'Martín Marchant';
    try {
      assert.equal((await request('GET', '/api/decisions/10/links')).status, 404);
      assert.equal((await request('POST', '/api/decisions/10/links/close', { close: [{ kind: 'decision', id: 1 }] })).status, 404);
    } finally {
      sessionUser.user_id = 'UC';
      sessionUser.user_name = 'Cristian Tumani';
    }
  });

  test('migration 014 links meetings still waiting for review, once', async () => {
    await db.collection('decisions').insertOne({
      workspace_id: 'WCML', space_id: mine.space_id, id: 20, type: 'decision', text: 'Florencia empieza el lunes como diseñadora',
      user_id: 'UC', capture: 'ai', review_status: null, timestamp: new Date().toISOString(), created_at: new Date(),
      source_details: { type: 'google_meet', external_id: 'meet_pending', title: 'Weekly Ops', occurred_at: new Date().toISOString() }
    });
    await db.collection('decisions').updateOne({ id: 10 }, { $set: { review_status: 'confirmed' } });
    const { linkPendingMeetings } = require('../../scripts/migrations/014-cross-meeting-links');
    const dry = await linkPendingMeetings(db, { workspaceId: 'WCML', apply: false }, { embed, judge });
    assert.equal(dry.meetings, 1);
    assert.ok(dry.links > 0);
    assert.equal((await db.collection('decisions').findOne({ id: 20 })).resolves, undefined, 'dry run writes nothing');

    const applied = await linkPendingMeetings(db, { workspaceId: 'WCML', apply: true }, { embed, judge });
    assert.equal(applied.meetings, 1);
    const saved = await db.collection('decisions').findOne({ id: 20 });
    assert.ok(saved.resolves.some(r => r.kind === 'decision' && r.id === 1 && r.relation === 'answers'));
    assert.ok(saved.links_checked_at);

    const again = await linkPendingMeetings(db, { workspaceId: 'WCML', apply: true }, { embed, judge });
    assert.equal(again.meetings, 0, 'already checked');
  });
});
