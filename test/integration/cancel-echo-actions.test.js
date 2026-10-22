const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};

describe('Migration 015: action items that repeat a risk or open question are cancelled', { skip }, () => {
  let cleanup;
  let db;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    const meet = id => ({ type: 'google_meet', external_id: id });
    await db.collection('decisions').insertMany([
      { id: 1, workspace_id: 'WE', type: 'open_question', text: '¿Cómo rediseñar las páginas de precios?', source_details: meet('m1') },
      { id: 2, workspace_id: 'WE', type: 'risk', text: 'La factura de octubre puede llegar tarde.', source_details: meet('m1') },
      { id: 3, workspace_id: 'WE', type: 'decision', text: 'Lanzamos el 22 de octubre', source_details: meet('m1') }
    ]);
    const item = (itemId, text, meetingId, status = 'open', workspaceId = 'WE') => ({
      item_id: itemId, workspace_id: workspaceId, text, status, source: meet(meetingId)
    });
    await db.collection('action_items').insertMany([
      item('act_q', 'Cómo rediseñar las páginas de precios'),
      item('act_r', 'la factura de octubre puede llegar tarde'),
      item('act_real', 'Ana rediseña la página de precios antes del viernes', 'm1'),
      item('act_decision', 'Lanzamos el 22 de octubre', 'm1'),
      item('act_other_meeting', '¿Cómo rediseñar las páginas de precios?', 'm2'),
      item('act_other_ws', '¿Cómo rediseñar las páginas de precios?', 'm1', 'open', 'WX'),
      item('act_done', 'La factura de octubre puede llegar tarde', 'm1', 'done')
    ].map(row => (row.source.external_id ? row : { ...row, source: meet('m1') })));
  });

  after(async () => { await cleanup(); });

  test('dry run lists them, --apply cancels only those, a second run finds nothing', async () => {
    const { cancelEchoes } = require('../../scripts/migrations/015-cancel-echo-action-items');
    const dry = await cancelEchoes(db, { apply: false });
    assert.deepEqual(dry.echoes.map(echo => echo.item_id).sort(), ['act_q', 'act_r']);
    assert.equal(dry.cancelled, 0);
    assert.equal((await db.collection('action_items').findOne({ item_id: 'act_q' })).status, 'open', 'dry run changes nothing');

    const applied = await cancelEchoes(db, { apply: true });
    assert.equal(applied.cancelled, 2);
    const q = await db.collection('action_items').findOne({ item_id: 'act_q' });
    assert.equal(q.status, 'cancelled');
    assert.equal(q.cancelled_by, 'migration_015');
    for (const id of ['act_real', 'act_decision', 'act_other_meeting', 'act_other_ws']) {
      assert.equal((await db.collection('action_items').findOne({ item_id: id })).status, 'open', id);
    }
    assert.equal((await db.collection('action_items').findOne({ item_id: 'act_done' })).status, 'done');

    assert.equal((await cancelEchoes(db, { apply: true })).echoes.length, 0);
  });
});
