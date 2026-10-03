const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.warn = () => {};

describe('uploaded transcripts: the text is never kept', { skip }, () => {
  let db;
  let cleanup;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('migration 011 removes the stored text and keeps the hash for duplicate detection', async () => {
    const { removeTranscriptText } = require('../../scripts/migrations/011-remove-uploaded-transcript-text');
    await db.collection('meeting_transcripts').insertMany([
      { workspace_id: 'W1', transcript_id: 't1', file_name: 'weekly.txt', content: 'Secret pricing talk', content_preview: 'Secret', content_hash: 'abc', word_count: 3 },
      { workspace_id: 'W1', transcript_id: 't2', file_name: 'new.txt', content_hash: 'def', word_count: 10 }
    ]);

    assert.deepEqual(await removeTranscriptText(db, { apply: false }), { found: 1, cleaned: 0 }, 'dry run changes nothing');
    assert.equal((await db.collection('meeting_transcripts').findOne({ transcript_id: 't1' })).content, 'Secret pricing talk');

    assert.deepEqual(await removeTranscriptText(db, { apply: true }), { found: 1, cleaned: 1 });
    const cleaned = await db.collection('meeting_transcripts').findOne({ transcript_id: 't1' });
    assert.equal(cleaned.content, undefined);
    assert.equal(cleaned.content_preview, undefined);
    assert.equal(cleaned.content_hash, 'abc');
    assert.equal(cleaned.file_name, 'weekly.txt');
    assert.deepEqual(await removeTranscriptText(db, { apply: true }), { found: 0, cleaned: 0 }, 'safe to run twice');
  });
});
