const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};

const LONG = 'Se decide comenzar una investigación técnica sobre cómo implementar una experiencia interactiva con IA y Excel para los usuarios del curso';
const LONG_TASK = 'Martín Marchant y Felipe Silva se comprometen a preparar y enviar al resto del equipo una propuesta con los nuevos precios antes del viernes';

describe('Migration 016: long AI-captured outcomes become short headlines', { skip }, () => {
  let cleanup;
  let db;
  const calls = [];
  // Stands in for Claude: shortens every item it gets
  const rewrite = async items => {
    calls.push(items.length);
    return { rewrites: items.map(item => ({ text: `Corto: ${item.type}`, rationale: item.rationale ? 'Por qué corto' : null })), response: null };
  };

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    await db.collection('decisions').insertMany([
      { workspace_id: 'WS16', id: 1, type: 'decision', capture: 'ai', text: LONG, rationale: 'A raíz de la nueva estrategia presentada al inicio de la reunión, el producto necesita diferenciarse con IA frente a la competencia directa' },
      // Already short: left alone
      { workspace_id: 'WS16', id: 2, type: 'risk', capture: 'ai', text: 'La factura de octubre puede llegar tarde', rationale: null },
      // Typed by hand, or edited by hand: never rewritten
      { workspace_id: 'WS16', id: 3, type: 'decision', capture: 'manual', text: LONG },
      { workspace_id: 'WS16', id: 4, type: 'decision', capture: 'ai', text: LONG, text_edited_at: new Date() }
    ]);
    await db.collection('action_items').insertMany([
      { workspace_id: 'WS16', item_id: 'act_long', capture: 'ai', text: LONG_TASK, rationale: null, status: 'open' }
    ]);
  });

  after(async () => { await cleanup(); });

  test('dry run rewrites a sample in memory only; --apply keeps the original; a second run finds nothing; --undo restores', async () => {
    const { shortenOutcomes, undoShorten } = require('../../scripts/migrations/016-shorten-outcomes');

    const dry = await shortenOutcomes(db, { apply: false, sample: 10, rewrite });
    assert.equal(dry.found, 2, 'the long decision and the long action item');
    assert.equal(dry.pairs.length, 2);
    assert.equal(dry.rewritten, 0);
    assert.equal((await db.collection('decisions').findOne({ id: 1 })).text, LONG, 'dry run writes nothing');

    const applied = await shortenOutcomes(db, { apply: true, rewrite });
    assert.equal(applied.rewritten, 2);
    const decision = await db.collection('decisions').findOne({ id: 1 });
    assert.equal(decision.text, 'Corto: decision');
    assert.equal(decision.rationale, 'Por qué corto');
    assert.equal(decision.original_text, LONG, 'the original is kept (and decrypts)');
    assert.ok(decision.shortened_at);
    const task = await db.collection('action_items').findOne({ item_id: 'act_long' });
    assert.equal(task.text, 'Corto: action_item');
    assert.equal(task.rationale, null);
    for (const id of [2, 3, 4]) {
      const row = await db.collection('decisions').findOne({ id });
      assert.equal(row.shortened_at, undefined, `#${id} untouched`);
    }

    assert.equal((await shortenOutcomes(db, { apply: true, rewrite })).found, 0, 'a second run finds nothing');

    assert.equal(await undoShorten(db), 2);
    const restored = await db.collection('decisions').findOne({ id: 1 });
    assert.equal(restored.text, LONG);
    assert.equal(restored.original_text, undefined);
    assert.equal((await db.collection('action_items').findOne({ item_id: 'act_long' })).text, LONG_TASK);
  });

  test('editing an outcome or an action item by hand marks it', async () => {
    const actions = require('../../src/core/actions/action-service');
    await actions.updateActionItem('WS16', 'act_long', { text: 'Martín envía los precios' });
    assert.ok((await db.collection('action_items').findOne({ item_id: 'act_long' })).text_edited_at);
  });
});
