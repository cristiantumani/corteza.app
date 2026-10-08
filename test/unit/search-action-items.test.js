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

test('a meeting named in the question gets its own items, from every session, not the viewer’s', () => {
  const item = (id, text, title, owner, ownerId = null) => ({ item_id: id, text, source: { title }, owners: [{ name: owner, user_id: ownerId }], owner_ids: ownerId ? [ownerId] : [] });
  const open = [
    item('i1', 'Investigar ISO 27001', 'Weekly Prod/Ing', 'Cristian Tumani', 'UC'),
    item('i2', 'Citar a Rocha', 'Weekly Jess / Cris', 'Cristian Tumani', 'UC'),
    item('g1', 'Matriz de experimentos de crecimiento', 'Weekly Product-Led Growth', 'Equipo'),
    item('g2', 'Definir feature flags con Javier', 'weekly product led growth', 'Nicolas Renz'),
    item('s1', 'Pricing en EE.UU.', 'Cabecillas Weekly Stand-up', 'Cristopher Duarte')
  ];
  const ids = result => result.items.map(i => i.item_id);

  // "tengo" isn't "my items" when a meeting is named
  const growth = selectActionItems('tengo la weekly de la célula de growth, dime cuáles son los pendientes asociados a esa reunión', open, { viewerId: 'UC' });
  assert.deepEqual(ids(growth), ['g1', 'g2'], 'both sessions of the same meeting, matched by its distinctive word');
  assert.deepEqual(growth.meetings, ['Weekly Product-Led Growth']);
  assert.deepEqual(ids(selectActionItems('pendientes de Nicolás en la weekly de growth', open)), ['g2'], 'narrowed to a person named too');
  assert.deepEqual(ids(selectActionItems('¿qué tengo pendiente?', open, { viewerId: 'UC' })), ['i1', 'i2'], 'no meeting named: still my items');
  assert.deepEqual(selectActionItems('pendientes de la weekly', open).meetings, [], '"weekly" alone names no meeting');
  assert.deepEqual(selectActionItems('qué sabemos de growth', open).meetings, [], 'not about pending work or a meeting: a topic question');
});
