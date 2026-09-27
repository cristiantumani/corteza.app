const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
const {
  getDigestPeriod,
  buildDigestStats,
  getUnsubscribeUrl,
  verifyUnsubscribe
} = require('../../src/jobs/weekly-digest');
const { escapeHtml } = require('../../src/utils/n8n-client');

test('digest period is the previous Monday–Sunday (UTC)', () => {
  const period = getDigestPeriod(new Date('2026-09-23T12:00:00Z')); // a Wednesday
  assert.equal(period.start.toISOString(), '2026-09-14T00:00:00.000Z');
  assert.equal(period.end.toISOString(), '2026-09-21T00:00:00.000Z');
  assert.equal(period.previousStart.toISOString(), '2026-09-07T00:00:00.000Z');
  assert.equal(period.weekKey, '2026-09-14');
  assert.equal(period.label, 'Sep 14 – Sep 20');
});

test('Monday 00:00 UTC starts a new digest period', () => {
  const period = getDigestPeriod(new Date('2026-09-21T00:00:00Z'));
  assert.equal(period.start.toISOString(), '2026-09-14T00:00:00.000Z');
});

test('buildDigestStats counts types, contributors and tags, and truncates long text', () => {
  const decisions = [
    { text: 'x'.repeat(250), type: 'decision', creator: 'Ana', tags: ['google', 'drive'], space_id: 's1' },
    { text: 'Use Resend', type: 'decision', creator: 'Bob', tags: ['google'], space_id: 's2' },
    { text: 'Scope review risk', type: 'risk', creator: 'Ana', tags: [] }
  ];
  const stats = buildDigestStats(decisions, 1, new Map([['s1', 'General']]), 'Sep 14 – Sep 20');

  assert.equal(stats.thisWeek, 3);
  assert.equal(stats.change, 2);
  assert.deepEqual(stats.byType, [['decision', 2], ['risk', 1]]);
  assert.deepEqual(stats.topContributors[0], ['Ana', 2]);
  assert.deepEqual(stats.topTags[0], ['google', 2]);
  assert.equal(stats.recent[0].text.length, 200);
  assert.equal(stats.recent[0].space, 'General');
  assert.equal(stats.recent[1].space, null);
});

test('unsubscribe links are signed per workspace and user', () => {
  const url = new URL(getUnsubscribeUrl('W1', 'U1'));
  const token = url.searchParams.get('t');

  assert.equal(verifyUnsubscribe('W1', 'U1', token), true);
  assert.equal(verifyUnsubscribe('W1', 'U2', token), false);
  assert.equal(verifyUnsubscribe('W2', 'U1', token), false);
  assert.equal(verifyUnsubscribe('W1', 'U1', 'not-hex'), false);
  assert.equal(verifyUnsubscribe('W1', 'U1', undefined), false);
});

test('escapeHtml escapes markup and quotes', () => {
  assert.equal(escapeHtml('<b>"A" & \'B\'</b>'), '&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});
