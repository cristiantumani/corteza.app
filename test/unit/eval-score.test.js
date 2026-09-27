const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreFixture, summarize } = require('../../scripts/eval/score');

test('items match expected ones by type and keywords, once each', () => {
  const extracted = [
    { decision_type: 'decision', decision_text: 'Launch moves to October 22' },
    { decision_type: 'action_item', decision_text: 'Carla updates the press kit', owner_name: 'Carla Diaz', due_date: '2026-09-23' },
    { decision_type: 'decision', decision_text: 'The logo uses an 8px grid' }
  ];
  const expected = [
    { type: 'decision', match: ['22'] },
    { type: 'action_item', match: ['press kit'], owner: 'Carla Díaz', due_date: '2026-09-23' },
    { type: 'risk', match: ['billing'] }
  ];
  const result = scoreFixture(extracted, expected);
  assert.equal(result.matched.length, 2);
  assert.deepEqual(result.missed.map(m => m.type), ['risk']);
  assert.equal(result.extra[0].decision_text, 'The logo uses an 8px grid');

  const summary = summarize([result]);
  assert.equal(summary.byType.decision.precision, 0.5);
  assert.equal(summary.byType.decision.recall, 1);
  assert.equal(summary.byType.risk.recall, 0);
  assert.equal(summary.ownerAccuracy, 1, 'accent-insensitive owner match');
  assert.equal(summary.dueDateAccuracy, 1);
});

test('rationale context and outcome phrasing are measured', () => {
  const extracted = [
    { decision_type: 'decision', decision_text: 'Se decide comenzar una investigación técnica sobre IA y Excel', rationale: 'A raíz de la nueva estrategia presentada' },
    { decision_type: 'decision', decision_text: 'Se propuso subir el descuento anual al 20%', rationale: null }
  ];
  const expected = [
    { type: 'decision', match: ['investigacion', 'excel'], rationale_match: ['estrategia'] },
    { type: 'decision', match: ['20'], rationale_match: ['anual'] }
  ];
  const summary = summarize([scoreFixture(extracted, expected)]);
  assert.equal(summary.rationaleAccuracy, 0.5);
  assert.equal(summary.decisionsAsOutcomes, 0.5, '"Se propuso…" counts as narration');
});
