const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectActionItems } = require('../../src/core/search/action-items');

const item = (text, owners, extra = {}) => ({
  item_id: text, text, owners: owners.map(name => ({ name, user_id: name === 'Cristian Tumani' ? 'U1' : null })),
  owner_ids: owners.includes('Cristian Tumani') ? ['U1'] : [], status: 'open', ...extra
});
const items = [
  item('Enviar el deck del directorio a Buk', ['Nicolle Reveco']),
  item('Revisar contratos de soporte', ['Cristian Tumani']),
  item('Preparar demo para el piloto', ['Nicolle Reveco', 'Martín Marchant']),
  item('Actualizar pricing en la web', ['Martín Marchant'], { source: { title: 'Weekly Ops' } })
];
const texts = result => result.items.map(i => i.text);

test('a person named in the question gets their open items, with or without accents', () => {
  const result = selectActionItems("What's still pending from Nicolle?", items);
  assert.deepEqual(texts(result), ['Enviar el deck del directorio a Buk', 'Preparar demo para el piloto']);
  assert.deepEqual(result.people, ['Nicolle Reveco']);
  assert.deepEqual(texts(selectActionItems('pendientes de martin', items)), ['Preparar demo para el piloto', 'Actualizar pricing en la web']);
});

test('"my/mis pendientes" returns the viewer\'s items', () => {
  assert.deepEqual(texts(selectActionItems('What are my open action items?', items, { viewerId: 'U1' })), ['Revisar contratos de soporte']);
  assert.deepEqual(texts(selectActionItems('¿Cuáles son mis pendientes?', items, { viewerId: 'U1' })), ['Revisar contratos de soporte']);
});

test('pending work on a topic matches by text; with no topic, all open items', () => {
  assert.deepEqual(texts(selectActionItems('pendientes del directorio', items)), ['Enviar el deck del directorio a Buk']);
  assert.equal(selectActionItems('Show me all open action items', items).items.length, 4);
});

test('questions that are not about pending work only get items on their topic', () => {
  const result = selectActionItems('¿Qué decidimos sobre pricing?', items);
  assert.equal(result.aboutPending, false);
  assert.deepEqual(texts(result), ['Actualizar pricing en la web']);
  assert.deepEqual(texts(selectActionItems('Why did we choose MongoDB?', items)), []);
});
