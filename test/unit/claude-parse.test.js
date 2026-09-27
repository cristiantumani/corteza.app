const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLeadingJsonArray, parseDecisionResponse } = require('../../src/services/claude');

test('an array followed by an explanation is parsed', () => {
  const response = '[]\n\nThe transcript appears to be heavily corrupted, so no decisions meet the criteria.';
  assert.deepEqual(parseLeadingJsonArray(response), []);
  assert.deepEqual(parseDecisionResponse(response), []);
});

test('prose before the array and brackets inside strings are handled', () => {
  const response = 'Here are the decisions:\n[{"decision_text": "Use [beta] flag \\"now\\"", "n": [1, 2]}]\nLet me know!';
  assert.deepEqual(parseLeadingJsonArray(response), [{ decision_text: 'Use [beta] flag "now"', n: [1, 2] }]);
});

test('plain JSON still parses, and text without JSON still fails', () => {
  assert.deepEqual(parseLeadingJsonArray('[{"a":1}]'), [{ a: 1 }]);
  assert.throws(() => parseLeadingJsonArray('No decisions found.'));
});
