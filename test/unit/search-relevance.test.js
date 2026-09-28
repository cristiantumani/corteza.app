const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractKeywords, matchedKeywords, requiredMatches, accentInsensitivePattern } = require('../../src/core/search/relevance');
const { parseAnswer } = require('../../src/services/semantic-search');

test('keywords skip English and Spanish filler words and ignore accents', () => {
  assert.deepEqual(extractKeywords('Que hemos acordado de cara al directorio con Buk en Octubre?'), ['directorio', 'buk', 'octubre']);
  assert.deepEqual(extractKeywords('What did we decide about AEM pricing?'), ['aem', 'pricing']);
  assert.deepEqual(extractKeywords('¿Qué pasó con la reunión de ventas?'), ['paso', 'reunion', 'ventas']);
});

test('keywords match the start of a word, not the middle, without accents', () => {
  const doc = { text: 'Presentar al Directorio el forecast', tags: ['Reuniones'], source_details: { title: 'Buk weekly' } };
  assert.deepEqual(matchedKeywords(doc, ['directorio', 'reunion', 'buk', 'cast']), ['directorio', 'reunion', 'buk']);
});

test('a source needs about half of the keywords', () => {
  assert.equal(requiredMatches(1), 1);
  assert.equal(requiredMatches(2), 1);
  assert.equal(requiredMatches(3), 2);
  assert.equal(requiredMatches(5), 3);
});

test('the Mongo pattern finds a keyword with or without accents at the start of a word', () => {
  const pattern = new RegExp(accentInsensitivePattern('reunion'), 'i');
  assert.ok(pattern.test('La Reunión de ventas'));
  assert.ok(pattern.test('reuniones'));
  assert.ok(!new RegExp(accentInsensitivePattern('firm'), 'i').test('confirmar'), 'not in the middle of a word');
});

test('the answer and the sources it used are read from Claude\'s JSON', () => {
  assert.deepEqual(
    parseAnswer('Sure: {"answer": "Se presentan 3 escenarios (#74).", "used_ids": [74, "72", 999]}', [74, 72, 69]),
    { text: 'Se presentan 3 escenarios (#74).', usedIds: [74, 72] }
  );
  assert.equal(parseAnswer('no json here', [1]), null);
  assert.equal(parseAnswer('{"answer": ""}', [1]), null);
  assert.deepEqual(parseAnswer('{"answer": "Nothing covers this."}', [1]), { text: 'Nothing covers this.', usedIds: [] });
});
