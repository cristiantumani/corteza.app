const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ownerIdsFor } = require('../../src/core/privacy/sensitive');
const { normalizeItem } = require('../../src/services/claude');

test('a sensitive action item grants access only to whoever it is private to', () => {
  const owners = [{ user_id: 'UJ', name: 'Jess' }, { user_id: 'UC', name: 'Cristian' }, { user_id: null, name: 'Rocha' }];
  assert.deepEqual(ownerIdsFor(owners, false, 'UC'), ['UJ', 'UC']);
  assert.deepEqual(ownerIdsFor(owners, true, 'UC'), ['UC']);
  assert.deepEqual(ownerIdsFor([{ user_id: 'UJ', name: 'Jess' }], true, 'UC'), [], 'Jess keeps her name, not access');
  assert.deepEqual(ownerIdsFor(owners, true, null), []);
  assert.deepEqual(ownerIdsFor([], false, 'UC'), []);
});

test('the extraction’s sensitive flag is true only when the model says true', () => {
  assert.equal(normalizeItem({ decision_text: 'x', sensitive: true }).sensitive, true);
  assert.equal(normalizeItem({ decision_text: 'x', sensitive: 'true' }).sensitive, false);
  assert.equal(normalizeItem({ decision_text: 'x' }).sensitive, false);
});
