const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};

describe('Migration 013: tags saved as text become a list', { skip }, () => {
  let cleanup;
  let db;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getRawDatabase();
    await db.collection('decisions').insertMany([
      { id: 1, workspace_id: 'WTAG', tags: 'ISO, seguridad' },
      { id: 2, workspace_id: 'WTAG', tags: ['pricing'] },
      { id: 3, workspace_id: 'WTAG' }
    ]);
  });

  after(async () => { await cleanup(); });

  test('dry run counts, --apply fixes, a second run finds nothing', async () => {
    const { normalizeStoredTags } = require('../../scripts/migrations/013-normalize-tags');
    assert.deepEqual(await normalizeStoredTags(db, { apply: false }), { found: 1, fixed: 0 });
    assert.equal((await db.collection('decisions').findOne({ id: 1 })).tags, 'ISO, seguridad', 'dry run changes nothing');

    assert.deepEqual(await normalizeStoredTags(db, { apply: true }), { found: 1, fixed: 1 });
    assert.deepEqual((await db.collection('decisions').findOne({ id: 1 })).tags, ['iso', 'seguridad']);
    assert.deepEqual((await db.collection('decisions').findOne({ id: 2 })).tags, ['pricing'], 'lists are left alone');

    assert.deepEqual(await normalizeStoredTags(db, { apply: true }), { found: 0, fixed: 0 });
  });
});
