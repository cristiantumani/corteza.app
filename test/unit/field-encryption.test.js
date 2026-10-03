const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const aead = require('../../src/core/crypto/aead');
const fields = require('../../src/core/crypto/fields');

const keyA = crypto.randomBytes(32);
const keyB = crypto.randomBytes(32);
const sealA = plain => aead.encryptValue(keyA, 'WA', 'k1', plain);
const getKey = async (workspaceId) => (workspaceId === 'WA' ? keyA : workspaceId === 'WB' ? keyB : null);

test('a sealed value round-trips, names its workspace and key, and hides the text', () => {
  const sealed = sealA('Se decide lanzar en octubre');
  assert.ok(aead.isSealed(sealed));
  assert.ok(!sealed.includes('octubre'));
  const header = aead.parseValue(sealed);
  assert.equal(header.workspaceId, 'WA');
  assert.equal(header.keyId, 'k1');
  assert.equal(aead.decryptPayload(keyA, 'WA', header.payload), 'Se decide lanzar en octubre');
  assert.notEqual(sealA('same'), sealA('same'), 'a fresh IV each time');
});

test('a tampered value, another key or another workspace fails to decrypt', () => {
  const header = aead.parseValue(sealA('secret'));
  const bytes = Buffer.from(header.payload, 'base64url');
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => aead.decryptPayload(keyA, 'WA', bytes.toString('base64url')));
  assert.throws(() => aead.decryptPayload(keyB, 'WA', header.payload));
  assert.throws(() => aead.decryptPayload(keyA, 'WB', header.payload), 'the workspace is bound to the value');
});

test('sealing a document encrypts only content fields, nested and in arrays, and leaves the input untouched', () => {
  const doc = { workspace_id: 'WA', id: 7, type: 'decision', text: 'Lanzar en octubre', tags: ['launch'], rationale: '', source_details: { title: 'Weekly', url: 'https://meet' } };
  const sealed = fields.sealDocument('decisions', doc, sealA);
  assert.ok(aead.isSealed(sealed.text));
  assert.ok(aead.isSealed(sealed.source_details.title));
  assert.equal(sealed.source_details.url, 'https://meet');
  assert.deepEqual(sealed.tags, ['launch'], 'tags stay plain in phase 1');
  assert.equal(sealed.rationale, '', 'empty strings stay as they are');
  assert.equal(sealed.id, 7);
  assert.equal(doc.text, 'Lanzar en octubre', 'the input is not mutated');
  assert.equal(doc.source_details.title, 'Weekly');

  const imports = fields.sealDocument('meet_imports', { workspace_id: 'WA', items: [{ title: 'Weekly', status: 'queued' }, { title: null }] }, sealA);
  assert.ok(aead.isSealed(imports.items[0].title));
  assert.equal(imports.items[0].status, 'queued');
  assert.equal(imports.items[1].title, null);
  assert.equal(fields.sealDocument('decisions', sealed, sealA).text, sealed.text, 'already sealed values are not sealed twice');
});

test('updates are sealed in $set (whole objects, dotted and positional keys), $setOnInsert and $push', () => {
  const update = fields.sealUpdate('decisions', {
    $set: { text: 'Nuevo texto', review_status: 'confirmed', source_details: { title: 'Weekly', type: 'google_meet' } },
    $setOnInsert: { evidence_quote: 'dijo X' }
  }, sealA);
  assert.ok(aead.isSealed(update.$set.text));
  assert.equal(update.$set.review_status, 'confirmed');
  assert.ok(aead.isSealed(update.$set.source_details.title));
  assert.equal(update.$set.source_details.type, 'google_meet');
  assert.ok(aead.isSealed(update.$setOnInsert.evidence_quote));

  const positional = fields.sealUpdate('meet_imports', { $set: { 'items.3.title': 'Weekly', 'items.3.status': 'done' } }, sealA);
  assert.ok(aead.isSealed(positional.$set['items.3.title']));
  assert.equal(positional.$set['items.3.status'], 'done');

  const push = fields.sealUpdate('ai_context', { $push: { documents: { doc_id: 'd1', name: 'Org chart', text: 'Ana: CFO' } } }, sealA);
  assert.ok(aead.isSealed(push.$push.documents.text));
  assert.equal(push.$push.documents.name, 'Org chart');

  assert.equal(fields.updateWritesContent('decisions', { $set: { review_status: 'confirmed' } }), false);
  assert.equal(fields.updateWritesContent('decisions', { $set: { 'source_details.title': 'x' } }), true);
  assert.equal(fields.updateWritesContent('ai_context', { $push: { documents: {} } }), true);
});

test('opening a result decrypts every sealed value at any depth; unknown keys read as unavailable', async () => {
  const sealedB = aead.encryptValue(keyB, 'WB', 'k1', 'de B');
  const opened = await fields.openValue({ text: sealA('hola'), nested: { list: [sealA('uno'), 'plain'] }, other: sealedB, date: new Date(0) }, getKey);
  assert.equal(opened.text, 'hola');
  assert.deepEqual(opened.nested.list, ['uno', 'plain']);
  assert.equal(opened.other, 'de B');
  assert.ok(opened.date instanceof Date);

  const orphan = aead.encryptValue(crypto.randomBytes(32), 'WGONE', 'k1', 'x');
  assert.equal((await fields.openValue({ text: orphan }, getKey)).text, fields.UNAVAILABLE);
  const moved = { ...aead.parseValue(sealA('movido')) };
  const forged = `enc1:WB:k1:${moved.payload}`; // WA's ciphertext relabeled as WB's
  assert.equal((await fields.openValue({ text: forged }, getKey)).text, fields.UNAVAILABLE);
});

test('filters on encrypted fields are detected, including inside $or and dotted paths', () => {
  assert.deepEqual(fields.encryptedFilterKeys('decisions', { workspace_id: 'W', $or: [{ text: /x/ }, { tags: 'a' }] }), ['text']);
  assert.deepEqual(fields.encryptedFilterKeys('decisions', { 'source_details.title': 'Weekly', 'source_details.external_id': 'm1' }), ['source_details.title']);
  assert.deepEqual(fields.encryptedFilterKeys('action_items', { owner_ids: 'U1', status: 'open' }), []);
});
