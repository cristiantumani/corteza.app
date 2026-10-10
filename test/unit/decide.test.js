const { test } = require('node:test');
const assert = require('node:assert/strict');
const { looksLikeDecision, parseReply, buildPrompt, canCloseItem } = require('../../src/core/agent/decide');

// Decide and close (docs/specs/2026-10-decide-and-close.md)

test('typed decisions are recognized; questions and searches are not', () => {
  for (const text of [
    'Hemos decidido no ir por ISO27001',
    'Decidimos no ir por ISO 27001 por ahora',
    'no vamos con la certificación SOC 2 este año',
    'Acordamos contratar a Ana como Head of Sales',
    'We decided to drop the enterprise plan',
    "We won't pursue ISO 27001 for now"
  ]) assert.ok(looksLikeDecision(text), text);
  for (const text of [
    '¿Vamos por ISO 27001?',
    'qué pendientes tiene Ana',
    'Weekly Product Led Growth',
    'what did we decide about pricing?',
    'iso',
    '',
    null
  ]) assert.ok(!looksLikeDecision(text), String(text));
});

test('Claude’s reply keeps known items, relations that fit each type, and confidence', () => {
  const byLabel = new Map([
    ['E1', { label: 'E1', kind: 'decision', id: 1, type: 'open_question' }],
    ['E2', { label: 'E2', kind: 'decision', id: 2, type: 'risk' }],
    ['E3', { label: 'E3', kind: 'action_item', id: 'a3', type: 'action_item' }],
    ['E4', { label: 'E4', kind: 'decision', id: 4, type: 'decision' }]
  ]);
  const reply = JSON.stringify({
    is_decision: true,
    decision: 'No vamos por ISO 27001 por ahora.',
    links: [
      { earlier: 'E1', relation: 'answers', confidence: 'high', reason: 'La respuesta es no.' },
      { earlier: 'E2', relation: 'answers', confidence: 'high', reason: 'Wrong relation for a risk' },
      { earlier: 'E3', relation: 'drops', confidence: 'low', reason: 'Ya no hace falta cotizar.' },
      { earlier: 'E4', relation: 'drops', confidence: 'high' },
      { earlier: 'E9', relation: 'answers', confidence: 'high' },
      { earlier: 'E1', relation: 'drops', confidence: 'high' }
    ]
  });
  const parsed = parseReply(`Here you go:\n${reply}`, byLabel);
  assert.equal(parsed.isDecision, true);
  assert.equal(parsed.decision, 'No vamos por ISO 27001 por ahora.');
  assert.deepEqual(parsed.links.map(l => [l.candidate.label, l.relation, l.confidence]), [
    ['E1', 'answers', 'high'],
    ['E2', 'none', 'low'], // "answers" doesn't fit a risk: only same subject
    ['E3', 'drops', 'low'],
    ['E4', 'none', 'low'] // an earlier decision is never closed
  ], 'unknown labels and repeats are left out');
  assert.equal(parseReply('not json', byLabel), null);
  assert.equal(parseReply('{"is_decision": false, "links": []}', byLabel).isDecision, false);
});

test('the prompt carries the statement and every candidate, without ids', () => {
  const prompt = buildPrompt('Decidimos no ir por ISO 27001', [{ label: 'E1', type: 'open_question', text: '¿Vamos por ISO 27001?', meeting: 'Weekly', date: '2026-09-01T10:00:00Z' }]);
  assert.match(prompt, /Decidimos no ir por ISO 27001/);
  assert.match(prompt, /E1 \[Open question\] · 2026-09-01 · meeting "Weekly"/);
});

test('an action item can be closed by its owners, its author or an admin', () => {
  assert.ok(canCloseItem({ owner_ids: ['U1'] }, 'U1', false));
  assert.ok(canCloseItem({ owner_ids: ['U2'], author_id: 'U1' }, 'U1', false));
  assert.ok(canCloseItem({ owner_ids: ['U2'] }, 'U1', true));
  assert.ok(!canCloseItem({ owner_ids: ['U2'], author_id: 'U3' }, 'U1', false));
});
