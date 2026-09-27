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

test('v2 items are normalized: invalid due dates dropped, evidence kept as legacy context', () => {
  const { normalizeItem } = require('../../src/services/claude');
  const item = normalizeItem({
    decision_text: 'Ana sends the pricing deck', decision_type: 'action_item', confidence: 0.9,
    owner_name: '  Ana ', due_date: 'next Friday', evidence_quote: 'I will send it Friday', rationale: ''
  });
  assert.equal(item.owner_name, 'Ana');
  assert.equal(item.due_date, null);
  assert.equal(item.rationale, null);
  assert.equal(item.context, 'I will send it Friday');
  assert.equal(normalizeItem({ decision_text: 'x', due_date: '2026-10-02' }).due_date, '2026-10-02');
});

test('v2 types pass validation; unknown types do not', () => {
  const { parseDecisionResponse } = require('../../src/services/claude');
  const items = parseDecisionResponse(JSON.stringify([
    { decision_text: 'Launch on the 15th', decision_type: 'decision', confidence: 0.95 },
    { decision_text: 'Ana sends the deck', decision_type: 'action_item', confidence: 0.9, owner_name: 'Ana', due_date: '2026-10-02' },
    { decision_text: 'Who owns support?', decision_type: 'open_question', confidence: 0.7 },
    { decision_text: 'Vendor may slip', decision_type: 'risk', confidence: 0.6 },
    { decision_text: 'Nope', decision_type: 'gossip', confidence: 0.9 }
  ]));
  assert.deepEqual(items.map(i => i.decision_type), ['decision', 'action_item', 'open_question', 'risk']);
  assert.equal(items[1].owner_name, 'Ana');
});

test('text is read from text blocks only (thinking blocks come first on current models)', () => {
  const { responseText } = require('../../src/services/claude');
  assert.equal(responseText({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '[]' }] }), '[]');
});

test('temperature is only sent to models that still accept it', () => {
  const { SAMPLING_MODELS } = require('../../src/services/claude');
  for (const model of ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-3-5-sonnet-20241022']) {
    assert.ok(SAMPLING_MODELS.test(model), model);
  }
  for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-fable-5-1']) {
    assert.ok(!SAMPLING_MODELS.test(model), model);
  }
});
