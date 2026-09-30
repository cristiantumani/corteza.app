const { test } = require('node:test');
const assert = require('node:assert/strict');
const { digestDay, hasNews } = require('../../src/jobs/daily-digest');
const { dailyDigestSubject } = require('../../src/utils/n8n-client');

test('sends on weekdays from the digest hour (UTC), never on weekends', () => {
  delete process.env.DAILY_DIGEST_HOUR_UTC;
  assert.equal(digestDay(new Date('2026-09-30T21:59:00Z')), null, 'Wednesday before 22:00');
  assert.equal(digestDay(new Date('2026-09-30T22:05:00Z')), '2026-09-30');
  assert.equal(digestDay(new Date('2026-10-03T22:05:00Z')), null, 'Saturday');
  process.env.DAILY_DIGEST_HOUR_UTC = '18';
  assert.equal(digestDay(new Date('2026-09-30T18:00:00Z')), '2026-09-30');
  delete process.env.DAILY_DIGEST_HOUR_UTC;
});

test('only news triggers an email; reminders alone never do', () => {
  assert.equal(hasNews({ meetings: 0, newActionItems: 0, overdue: 5, toReview: 3 }), false);
  assert.equal(hasNews({ meetings: 1, newActionItems: 0 }), true);
  assert.equal(hasNews({ meetings: 0, newActionItems: 2 }), true);
});

test('the subject gives the day in numbers', () => {
  assert.equal(dailyDigestSubject({ meetings: 3, outcomes: { decision: 5 }, newActionItems: 1, overdue: 2 }),
    'Your day in Corteza: 3 meetings, 5 decisions, 1 new action item, 2 overdue');
  assert.equal(dailyDigestSubject({ meetings: 0, outcomes: {}, newActionItems: 2, overdue: 0 }), 'Your day in Corteza: 2 new action items');
});
