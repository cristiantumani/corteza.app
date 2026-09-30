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

test('owners become a list and decision_ref an index; a single owner_name still works', () => {
  const { normalizeItem } = require('../../src/services/claude');
  const both = normalizeItem({ decision_text: 'x', decision_type: 'action_item', owner_names: ['Martín', ' Felipe ', ''], decision_ref: 0 });
  assert.deepEqual(both.owner_names, ['Martín', 'Felipe']);
  assert.equal(both.owner_name, 'Martín');
  assert.equal(both.decision_ref, 0);
  const legacy = normalizeItem({ decision_text: 'x', owner_name: 'Ana', decision_ref: 'first' });
  assert.deepEqual(legacy.owner_names, ['Ana']);
  assert.equal(legacy.decision_ref, null);
});

test('low business relevance items are dropped, and action items keep pointing at their decision', () => {
  const items = parseDecisionResponse(JSON.stringify([
    { decision_text: 'Se decide reprogramar la reunión para las 15:45', decision_type: 'decision', confidence: 0.9, business_relevance: 'low' },
    { decision_text: 'Se aprueba el reajuste salarial', decision_type: 'decision', confidence: 0.95, business_relevance: 'high' },
    { decision_text: 'José traspasa la base de datos al nuevo computador', decision_type: 'action_item', confidence: 0.8, business_relevance: 'low' },
    { decision_text: 'Finanzas aplica el reajuste en la próxima liquidación', decision_type: 'action_item', confidence: 0.9, business_relevance: 'high', decision_ref: 1 },
    { decision_text: 'Coordinar la reunión de seguimiento', decision_type: 'action_item', confidence: 0.7, business_relevance: 'medium', decision_ref: 0 }
  ]));
  assert.deepEqual(items.map(i => i.decision_text), [
    'Se aprueba el reajuste salarial',
    'Finanzas aplica el reajuste en la próxima liquidación',
    'Coordinar la reunión de seguimiento'
  ]);
  assert.equal(items[1].decision_ref, 0, 'still linked to the salary decision, now first');
  assert.equal(items[2].decision_ref, null, 'its decision was dropped');
});

test('items without a relevance label are kept (older responses)', () => {
  const items = parseDecisionResponse(JSON.stringify([{ decision_text: 'Launch on the 15th', decision_type: 'decision', confidence: 0.9 }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].business_relevance, null);
});

test('a response cut off at max_tokens keeps the complete items', () => {
  const cut = '```json\n[\n  {"decision_text": "Launch on the 15th", "decision_type": "decision", "confidence": 0.9, "tags": ["a"]},\n'
    + '  {"decision_text": "Ana sends the deck", "decision_type": "action_item", "confidence": 0.9},\n'
    + '  {"decision_text": "Pricing moves to Q4", "decision_type": "decision", "rationale": "Because the cust';
  assert.deepEqual(parseLeadingJsonArray(cut.replace(/^```json\n/, '')).map(item => item.decision_text), ['Launch on the 15th', 'Ana sends the deck']);
  assert.deepEqual(parseDecisionResponse(cut).map(item => item.decision_text), ['Launch on the 15th', 'Ana sends the deck']);
  assert.throws(() => parseLeadingJsonArray('[{"decision_text": "cut in the first ite'));
});
