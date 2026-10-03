const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// This file always runs with encryption on, whatever the environment
process.env.FIELD_ENCRYPTION = 'on';
process.env.FIELD_ENCRYPTION_STRICT = 'true';
process.env.DATA_KEK = process.env.DATA_KEK || crypto.randomBytes(32).toString('hex');

const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('field encryption: sealed in the database, plain for the app', { skip }, () => {
  let db;
  let raw;
  let cleanup;
  let keys;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    const database = require('../../src/config/database');
    db = database.getDatabase();
    raw = database.getRawDatabase();
    keys = require('../../src/core/crypto/keys');
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('outcomes and action items are stored encrypted and read back as plain text', async () => {
    await db.collection('decisions').insertOne({
      workspace_id: 'WENC', space_id: 'S1', id: 1, type: 'open_question', text: '¿Conviene certificarnos en ISO 27001?',
      rationale: 'Clientes enterprise lo piden', tags: ['iso'], source_details: { title: 'Comité', external_id: 'm1' },
      timestamp: new Date().toISOString()
    });
    const actions = require('../../src/core/actions/action-service');
    const item = await actions.createActionItem({
      workspaceId: 'WENC', spaceId: 'S1', text: 'Investigar requisitos de ISO 27001', ownerUserIds: [],
      source: { type: 'google_meet', external_id: 'm1', title: 'Comité' }
    });
    assert.equal(item.text, 'Investigar requisitos de ISO 27001', 'the caller gets plain text back');

    const storedDecision = await raw.collection('decisions').findOne({ workspace_id: 'WENC', id: 1 });
    assert.match(storedDecision.text, /^enc1:WENC:k1:/);
    assert.ok(!JSON.stringify(storedDecision).includes('ISO 27001'), 'no plain content in the database');
    assert.deepEqual(storedDecision.tags, ['iso']);
    assert.equal(storedDecision.source_details.external_id, 'm1');
    const storedItem = await raw.collection('action_items').findOne({ item_id: item.item_id });
    assert.match(storedItem.text, /^enc1:/);
    assert.match(storedItem.source.title, /^enc1:/);

    const decision = await db.collection('decisions').findOne({ workspace_id: 'WENC', id: 1 });
    assert.equal(decision.text, '¿Conviene certificarnos en ISO 27001?');
    assert.equal(decision.source_details.title, 'Comité');
    const listed = await db.collection('action_items').find({ workspace_id: 'WENC' }).sort({ created_at: -1 }).limit(5).toArray();
    assert.equal(listed[0].text, 'Investigar requisitos de ISO 27001');
  });

  test('updates are encrypted too, and a filter on an encrypted field is refused', async () => {
    await db.collection('decisions').updateOne({ workspace_id: 'WENC', id: 1 }, { $set: { resolution_note: 'Sí, en Q1', resolution_status: 'resolved' } });
    const stored = await raw.collection('decisions').findOne({ workspace_id: 'WENC', id: 1 });
    assert.match(stored.resolution_note, /^enc1:/);
    assert.equal(stored.resolution_status, 'resolved');
    assert.equal((await db.collection('decisions').findOne({ workspace_id: 'WENC', id: 1 })).resolution_note, 'Sí, en Q1');
    await assert.rejects(() => db.collection('decisions').findOne({ workspace_id: 'WENC', text: 'x' }), /encrypted field/);
  });

  test('keyword search still finds encrypted outcomes', async () => {
    const { keywordSearch } = require('../../src/services/semantic-search');
    const results = await keywordSearch('certificación ISO', { workspace_id: 'WENC', space_id: 'S1' });
    assert.deepEqual(results.all.map(result => result.id), [1]);
    assert.equal(results.all[0].text, '¿Conviene certificarnos en ISO 27001?');
  });

  test('a value copied into another workspace does not decrypt', async () => {
    const stored = await raw.collection('decisions').findOne({ workspace_id: 'WENC', id: 1 });
    await db.collection('decisions').insertOne({ workspace_id: 'WOTHER', space_id: 'S9', id: 1, text: 'propio' });
    const relabeled = stored.text.replace('enc1:WENC:', 'enc1:WOTHER:');
    await raw.collection('decisions').updateOne({ workspace_id: 'WOTHER', id: 1 }, { $set: { text: relabeled } });
    const { UNAVAILABLE } = require('../../src/core/crypto/fields');
    assert.equal((await db.collection('decisions').findOne({ workspace_id: 'WOTHER', id: 1 })).text, UNAVAILABLE);
  });

  test('migration 012 encrypts plain data left from before, is safe to repeat, and --check finds nothing left', async () => {
    const { encryptCollection } = require('../../scripts/migrations/012-encrypt-workspace-data');
    await raw.collection('decisions').insertOne({ workspace_id: 'WENC', space_id: 'S1', id: 2, text: 'Texto antiguo sin cifrar', rationale: 'por algo' });
    assert.deepEqual(await encryptCollection(raw, 'decisions', { apply: false }), { documents: 3, plain: 1, encrypted: 0, skipped: 0 });
    assert.deepEqual(await encryptCollection(raw, 'decisions', { apply: true }), { documents: 3, plain: 1, encrypted: 1, skipped: 0 });
    const stored = await raw.collection('decisions').findOne({ workspace_id: 'WENC', id: 2 });
    assert.match(stored.text, /^enc1:/);
    assert.match(stored.rationale, /^enc1:/);
    assert.equal((await db.collection('decisions').findOne({ workspace_id: 'WENC', id: 2 })).text, 'Texto antiguo sin cifrar');
    assert.equal((await encryptCollection(raw, 'decisions', { apply: false })).plain, 0, 'nothing plain left');
  });

  test('destroying a workspace key makes its data unreadable for good (crypto-shredding)', async () => {
    assert.equal(await keys.destroyWorkspaceKeys('WENC'), 1);
    const { UNAVAILABLE } = require('../../src/core/crypto/fields');
    assert.equal((await db.collection('decisions').findOne({ workspace_id: 'WENC', id: 1 })).text, UNAVAILABLE);
    const stored = await raw.collection('workspace_keys').findOne({ workspace_id: 'WENC' });
    assert.equal(stored.wrapped_key, undefined);
    await assert.rejects(() => db.collection('decisions').insertOne({ workspace_id: 'WENC', id: 3, text: 'nuevo' }), /destroyed/);
  });
});
