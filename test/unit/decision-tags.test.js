const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTags } = require('../../src/core/decisions/tags');
const { matchedKeywords } = require('../../src/core/search/relevance');

test('normalizeTags turns text, lists and junk into a clean list', () => {
  assert.deepEqual(normalizeTags('ISO, seguridad ,, iso'), ['iso', 'seguridad'], 'the extension sends "a, b"');
  assert.deepEqual(normalizeTags(['Pricing', ' pagos ', '', null, 3]), ['pricing', 'pagos']);
  assert.deepEqual(normalizeTags(null), []);
  assert.deepEqual(normalizeTags(undefined), []);
  assert.deepEqual(normalizeTags({ a: 1 }), []);
});

test('keyword search matches outcomes whose tags were saved as text instead of failing', () => {
  const doc = { text: 'Auditoría externa en noviembre', tags: 'iso, seguridad' };
  assert.deepEqual(matchedKeywords(doc, ['iso', 'auditoria']), ['iso', 'auditoria']);
});
