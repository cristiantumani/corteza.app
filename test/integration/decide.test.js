const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('decide and close (docs/specs/2026-10-decide-and-close.md)', { skip }, () => {
  let cleanup;
  let db;
  let decide;
  let mine;
  let brunos;
  const W = 'WDECIDE';
  const me = { user_id: 'UC', name: 'Cristian' };
  // About ISO → [1, 0]; anything else → [0, 1]
  const embed = async text => (/iso/i.test(text) ? [1, 0] : [0, 1]);
  const t = (key, vars = {}) => `${key}:${vars.text || ""}`;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    decide = require('../../src/core/agent/decide');
    await db.collection('workspace_members').insertMany([
      { workspace_id: W, user_id: 'UC', user_name: 'Cristian', email: 'c@ninja.io', role: 'member', removed_at: null },
      { workspace_id: W, user_id: 'UB', user_name: 'Bruno', email: 'b@ninja.io', role: 'member', removed_at: null }
    ]);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mine = await ensurePersonalSpace(W, 'UC', 'Cristian');
    brunos = await ensurePersonalSpace(W, 'UB', 'Bruno');
    const outcome = (id, type, text, extra = {}) => ({
      workspace_id: W, space_id: mine.space_id, id, type, text, capture: 'ai', resolution_status: 'open',
      embedding: /iso/i.test(text) ? [1, 0] : [0, 1], timestamp: new Date(Date.now() - 86400000).toISOString(), created_at: new Date(), ...extra
    });
    await db.collection('decisions').insertMany([
      outcome(501, 'open_question', '¿Vamos por ISO 27001 este año?', { topic_id: 'top_iso', topic: 'ISO 27001' }),
      outcome(502, 'risk', 'Perder deals enterprise sin ISO 27001'),
      outcome(503, 'open_question', '¿Subimos precios en enero?'),
      outcome(504, 'risk', 'Riesgo ISO privado de Bruno', { space_id: brunos.space_id })
    ]);
    const action = (itemId, text, extra = {}) => ({
      item_id: itemId, workspace_id: W, space_id: mine.space_id, text, owners: [{ name: 'Cristian', user_id: 'UC' }], owner_ids: ['UC'],
      status: 'open', created_by: { user_id: 'UC', name: 'Cristian' }, embedding: /iso/i.test(text) ? [1, 0] : [0, 1],
      created_at: new Date(Date.now() - 86400000), updated_at: new Date(), ...extra
    });
    await db.collection('action_items').insertMany([
      action('a_quote', 'Cotizar auditores ISO 27001'),
      // In a space Cristian can see, but Bruno's: only Bruno (or an admin) may close it
      action('a_bruno', 'Preparar políticas ISO para la auditoría', { owners: [{ name: 'Bruno', user_id: 'UB' }], owner_ids: ['UB'], created_by: { user_id: 'UB', name: 'Bruno' } })
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('preview: only open items on the subject that the person can see, with who may close them', async () => {
    let prompt = null;
    const judge = async text => {
      prompt = text;
      const label = name => (text.match(new RegExp(`(E\\d+) \\[[^\\]]+\\][^\\n]*\\n\\s+${name}`)) || [])[1];
      return JSON.stringify({
        is_decision: true,
        decision: 'No vamos por ISO 27001 por ahora.',
        links: [
          { earlier: label('¿Vamos por ISO'), relation: 'answers', confidence: 'high', reason: 'La respuesta es no.' },
          { earlier: label('Perder deals'), relation: 'drops', confidence: 'high' },
          { earlier: label('Cotizar auditores'), relation: 'drops', confidence: 'high' },
          { earlier: label('Preparar políticas'), relation: 'drops', confidence: 'high' }
        ]
      });
    };
    const preview = await decide.previewDecision({ workspaceId: W, userId: 'UC', spaceIds: [mine.space_id], admin: false, text: 'Decidimos no ir por ISO 27001' }, { embed, judge });
    assert.ok(!prompt.includes('Riesgo ISO privado de Bruno'), 'a colleague’s private item never reaches the prompt');
    assert.ok(!prompt.includes('precios'), 'other subjects are filtered out before Claude');
    assert.equal(preview.decision, 'No vamos por ISO 27001 por ahora.');
    const byText = Object.fromEntries(preview.items.map(i => [i.text, i]));
    assert.equal(byText['¿Vamos por ISO 27001 este año?'].relation, 'answers');
    assert.equal(byText['Cotizar auditores ISO 27001'].can_close, true);
    assert.equal(byText['Preparar políticas ISO para la auditoría'].can_close, false);
  });

  test('preview without anything similar open: the text as typed, no Claude call', async () => {
    const preview = await decide.previewDecision({ workspaceId: W, userId: 'UC', spaceIds: [mine.space_id], admin: false, text: 'Decidimos cambiar el logo' }, {
      embed: async () => [-1, -1], judge: async () => { throw new Error('should not be called'); }
    });
    assert.deepEqual(preview, { is_decision: true, decision: 'Decidimos cambiar el logo', items: [], related: [] });
  });

  let recorded;
  test('record: saves the decision and closes the chosen items, skipping what the person can’t change', async () => {
    const result = await decide.recordDecision({
      workspaceId: W, user: me, spaceIds: [mine.space_id], admin: false, t,
      text: 'No vamos por ISO 27001 por ahora.', rationale: 'Los clientes actuales no lo piden.',
      close: [
        { kind: 'decision', id: 501, relation: 'answers' },
        { kind: 'decision', id: 502, relation: 'drops' },
        { kind: 'action_item', id: 'a_quote', relation: 'drops' },
        { kind: 'action_item', id: 'a_bruno', relation: 'drops' }, // not his to close
        { kind: 'decision', id: 504, relation: 'drops' }, // can't see it
        { kind: 'decision', id: 503, relation: 'mitigates' } // relation doesn't fit a question
      ]
    });
    recorded = result.decision;
    assert.deepEqual(result.closed.map(c => c.id).sort(), [501, 502, 'a_quote'].sort());
    assert.equal(recorded.space_id, mine.space_id);
    assert.equal(recorded.rationale, 'Los clientes actuales no lo piden.');
    assert.equal(recorded.topic_id, 'top_iso', 'joins the thread of what it closes');

    const question = await db.collection('decisions').findOne({ workspace_id: W, id: 501 });
    assert.equal(question.resolution_status, 'resolved');
    assert.match(question.resolution_note, /^links\.resolvedNote/);
    const risk = await db.collection('decisions').findOne({ workspace_id: W, id: 502 });
    assert.match(risk.resolution_note, /^links\.droppedNote/);
    const items = await db.collection('action_items').find({ workspace_id: W }).toArray();
    assert.equal(items.find(i => i.item_id === 'a_quote').status, 'cancelled', 'no longer applies: cancelled, not done');
    assert.equal(items.find(i => i.item_id === 'a_bruno').status, 'open');
    assert.equal((await db.collection('decisions').findOne({ workspace_id: W, id: 504 })).resolution_status, 'open');
    assert.equal((await db.collection('decisions').findOne({ workspace_id: W, id: 503 })).resolution_status, 'open');
  });

  test('undo: reopens what it closed and deletes the decision (only the person who recorded it)', async () => {
    assert.deepEqual(await decide.undoDecision({ workspaceId: W, user: { user_id: 'UB', name: 'Bruno' }, spaceIds: [brunos.space_id], id: recorded.id }), { notFound: true });
    const result = await decide.undoDecision({ workspaceId: W, user: me, spaceIds: [mine.space_id], id: recorded.id });
    assert.equal(result.reopened, 3);
    assert.equal(await db.collection('decisions').findOne({ workspace_id: W, id: recorded.id }), null);
    assert.equal((await db.collection('decisions').findOne({ workspace_id: W, id: 501 })).resolution_status, 'open');
    assert.equal((await db.collection('action_items').findOne({ workspace_id: W, item_id: 'a_quote' })).status, 'open');
  });

  test('record with nothing to close: just the decision; empty text is refused', async () => {
    const result = await decide.recordDecision({ workspaceId: W, user: me, spaceIds: [mine.space_id], admin: false, t, text: 'Decidimos cambiar el logo', close: [] });
    assert.deepEqual(result.closed, []);
    assert.equal(result.decision.type, 'decision');
    assert.deepEqual(await decide.recordDecision({ workspaceId: W, user: me, spaceIds: [mine.space_id], admin: false, t, text: '  ' }), { error: 'Write the decision' });
  });
});
