const { test } = require('node:test');
const assert = require('node:assert/strict');
const { outcomeGroup, countByType, describeOutcomes } = require('../../src/core/decisions/types');
const { validateQueryParams } = require('../../src/middleware/validation');

test('extracted types are their own group; notes from older captures are "other"', () => {
  assert.equal(outcomeGroup('decision'), 'decision');
  assert.equal(outcomeGroup('risk'), 'risk');
  assert.equal(outcomeGroup('context'), 'other');
  assert.equal(outcomeGroup('learning'), 'other');
  assert.equal(outcomeGroup(undefined), 'other');
});

test('outcomes are counted by type', () => {
  const items = [{ type: 'decision' }, { type: 'decision' }, { type: 'open_question' }, { type: 'explanation' }];
  assert.deepEqual(countByType(items), { decision: 2, open_question: 1, other: 1 });
  assert.deepEqual(countByType([]), {});
});

test('outcomes are described per type, in a fixed order', () => {
  assert.equal(describeOutcomes({ risk: 1, decision: 3, action_item: 2 }), '3 decisions, 1 risk and 2 action items');
  assert.equal(describeOutcomes({ decision: 1 }), '1 decision');
  assert.equal(describeOutcomes({ open_question: 2, other: 1 }), '2 open questions and 1 note');
  assert.equal(describeOutcomes({}), '');
});

test('the decisions list accepts one type or several separated by commas', () => {
  assert.equal(validateQueryParams({ type: 'Risk' }).type, 'risk');
  assert.deepEqual(validateQueryParams({ type: 'open_question,risk' }).type, ['open_question', 'risk']);
  assert.equal(validateQueryParams({ type: 'risk,bogus' }).type, 'risk');
  assert.equal(validateQueryParams({ type: 'bogus' }).type, undefined);
  assert.equal(validateQueryParams({ type: ['risk'] }).type, undefined, 'repeated params are ignored');
});
