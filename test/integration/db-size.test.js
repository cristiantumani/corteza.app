const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('db-size script', { skip }, () => {
  let db;
  let cleanup;
  let dbSize;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    dbSize = require('../../scripts/db-size');
    await db.collection('decisions').insertMany([
      { workspace_id: 'W1', id: 1, text: 'with a vector', embedding: Array.from({ length: 1536 }, (_, i) => i / 1536) },
      { workspace_id: 'W1', id: 2, text: 'without one' }
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('collectionSize reports documents, data and index sizes', async () => {
    const size = await dbSize.collectionSize(db, 'decisions');
    assert.equal(size.name, 'decisions');
    assert.equal(size.count, 2);
    assert.ok(size.size > 1536 * 8, 'data includes the embedding');
    assert.ok(size.indexSize > 0, 'the _id index');
  });

  test('embeddingSize counts only outcomes with an embedding', async () => {
    const { withEmbedding, bytes } = await dbSize.embeddingSize(db);
    assert.equal(withEmbedding, 1);
    assert.ok(bytes > 1536 * 8);
  });

  test('the script prints a table and the Atlas free tier usage', async () => {
    const { stdout } = await promisify(execFile)('node', [path.join(__dirname, '../../scripts/db-size.js')], { env: { ...process.env } });
    assert.match(stdout, /decisions\s+2/);
    assert.match(stdout, /Atlas free tier \(M0\) limit: 512\.00 MB/);
    assert.match(stdout, /Embeddings: 1 outcome/);
  });

  test('formatBytes', () => {
    assert.equal(dbSize.formatBytes(0), '0 B');
    assert.equal(dbSize.formatBytes(2048), '2.0 KB');
    assert.equal(dbSize.formatBytes(5 * 1024 * 1024), '5.00 MB');
  });
});
