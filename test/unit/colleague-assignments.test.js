const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeText, cosine, similarityThreshold } = require('../../src/core/actions/colleague-assignments');
const { dailyDigestHtml } = require('../../src/utils/n8n-client');

test('item texts compare without case, accents or punctuation', () => {
  assert.equal(normalizeText('  Cristian envía el DECK, de precios! '), 'cristian envia el deck de precios');
  assert.equal(normalizeText(null), '');
});

test('cosine similarity', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [1, 0, 0]), 0, 'different sizes never match');
  assert.equal(cosine(null, [1]), 0);
});

test('ACTION_DUPLICATE_SIMILARITY tunes the threshold within (0, 1)', () => {
  const before = process.env.ACTION_DUPLICATE_SIMILARITY;
  try {
    delete process.env.ACTION_DUPLICATE_SIMILARITY;
    assert.equal(similarityThreshold(), 0.86);
    process.env.ACTION_DUPLICATE_SIMILARITY = '0.9';
    assert.equal(similarityThreshold(), 0.9);
    process.env.ACTION_DUPLICATE_SIMILARITY = '3';
    assert.equal(similarityThreshold(), 0.86);
  } finally {
    if (before === undefined) delete process.env.ACTION_DUPLICATE_SIMILARITY;
    else process.env.ACTION_DUPLICATE_SIMILARITY = before;
  }
});

test('the morning summary names the colleagues who assigned new items, escaped', () => {
  const html = dailyDigestHtml({
    workspace_name: 'Ninja',
    unsubscribe_url: 'https://corteza.app/u',
    summary: { dayLabel: 'Friday', today: '2026-10-02', since: 'yesterday', meetings: 0, outcomes: {}, newActionItems: 3, dueToday: 0, toReview: 0, overdue: 0, noDueDate: 0, planItems: [], assignedBy: [{ name: 'Martín <b>', count: 2 }, { name: 'Ana', count: 1 }] }
  });
  assert.match(html, /3 new action items assigned to you by colleagues/);
  assert.match(html, /Martín &lt;b&gt; \(2\), Ana \(1\)/);
  const none = dailyDigestHtml({ workspace_name: 'Ninja', unsubscribe_url: 'u', summary: { dayLabel: 'Friday', today: '2026-10-02', meetings: 0, outcomes: {}, newActionItems: 0, dueToday: 0, toReview: 0, overdue: 0, noDueDate: 0, planItems: [] } });
  assert.doesNotMatch(none, /assigned to you by colleagues/);
});
