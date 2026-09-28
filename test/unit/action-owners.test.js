const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchMember, normalizeName } = require('../../src/core/actions/owners');

const members = [
  { user_id: 'U1', user_name: 'Martín Marchant', email: 'martin@acme.com' },
  { user_id: 'U2', user_name: 'Felipe Silva', email: 'felipe@acme.com' },
  { user_id: 'U3', user_name: 'Ana Ruiz', email: 'ana@acme.com' },
  { user_id: 'U4', user_name: 'Ana Gómez', email: 'ana.g@acme.com' },
  { user_id: 'U5', user_name: null, email: 'noname@acme.com' }
];

test('names are compared without case, accents or extra spaces', () => {
  assert.equal(normalizeName('  Martín   MARCHANT '), 'martin marchant');
});

test('spoken names match members by full name, unique first name or prefix', () => {
  assert.equal(matchMember('Martin Marchant', members).user_id, 'U1');
  assert.equal(matchMember('Martín', members).user_id, 'U1');
  assert.equal(matchMember('felipe', members).user_id, 'U2');
  assert.equal(matchMember('Ana Ruiz', members).user_id, 'U3');
  assert.equal(matchMember('Felipe Silva Rojas', members).user_id, 'U2', 'longer spoken name');
});

test('ambiguous or unknown names are not matched', () => {
  assert.equal(matchMember('Ana', members), null, 'two members called Ana');
  assert.equal(matchMember('Carla', members), null);
  assert.equal(matchMember('', members), null);
});

test('owners picked by hand keep their order and drop people who are not members', async () => {
  const { ownersFromUserIds } = require('../../src/core/actions/owners');
  const owners = await ownersFromUserIds('W1', ['U2', 'U9', 'U1', 'U2'], members);
  assert.deepEqual(owners.map(owner => owner.user_id), ['U2', 'U1']);
  assert.equal(owners[0].name, 'Felipe Silva');
  assert.deepEqual(await ownersFromUserIds('W1', [], members), []);
  const noName = await ownersFromUserIds('W1', ['U5'], members);
  assert.equal(noName[0].name, 'noname@acme.com', 'falls back to the email');
});
