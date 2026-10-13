const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRows, paginate } = require('../../src/core/meetings/meetings');

const counts = (decision = 0, action_item = 0, open_question = 0, risk = 0) => ({ decision, action_item, open_question, risk });

describe('meetings view: rows (docs/specs/2026-10-meetings-view.md)', () => {
  test('one row per meeting, newest first, with counts, review and what can be captured again', () => {
    const rows = buildRows({
      ingestions: [
        { external_id: 'm1', title: 'Weekly', status: 'completed', created_at: new Date('2026-10-12T10:00:00Z') },
        { external_id: 'm2', title: 'Ana / Bruno', status: 'skipped', skip_reason: 'one_on_one', created_at: new Date('2026-10-12T15:00:00Z') },
        { external_id: 'm3', title: 'No notes', status: 'skipped', skip_reason: 'no_transcript', created_at: new Date('2026-10-11T15:00:00Z') },
        { external_id: 'm4', title: 'Broken', status: 'failed', created_at: new Date('2026-10-10T15:00:00Z') },
        // Imported later, but the meeting happened earlier: sorted by when it happened
        { external_id: 'm5', title: 'Old import', status: 'completed', created_at: new Date('2026-10-13T08:00:00Z'), occurred_at: new Date('2026-09-20T10:00:00Z') }
      ],
      byMeeting: new Map([['m1', { counts: counts(2, 1, 1, 0), to_review: 2, occurred_at: '2026-10-12T09:00:00Z', url: 'https://meet.google.com/x' }]]),
      manualDays: new Map([['2026-10-12', { counts: counts(1), to_review: 0 }]])
    });
    assert.deepEqual(rows.map(row => row.id), ['m2', 'm1', 'manual:2026-10-12', 'm3', 'm4', 'm5']);
    const weekly = rows.find(row => row.id === 'm1');
    assert.deepEqual(weekly.counts, counts(2, 1, 1, 0));
    assert.equal(weekly.to_review, 2);
    assert.equal(weekly.occurred_at, '2026-10-12T09:00:00.000Z', 'when the meeting happened, from its outcomes');
    assert.equal(weekly.url, 'https://meet.google.com/x');
    assert.equal(rows.find(row => row.id === 'm2').can_capture, true, 'a skipped 1:1 can be captured anyway');
    assert.equal(rows.find(row => row.id === 'm3').can_capture, false, 'nothing to read');
    assert.equal(rows.find(row => row.id === 'm4').can_capture, true, 'a failed one can be tried again');
    assert.equal(rows.find(row => row.id === 'manual:2026-10-12').kind, 'manual');
  });

  test('paginate: strictly older than before, and where the next page starts', () => {
    const rows = ['2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09'].map((day, i) => ({ id: `r${i}`, occurred_at: `${day}T10:00:00.000Z` }));
    const first = paginate(rows, null, 2);
    assert.deepEqual(first.meetings.map(row => row.id), ['r0', 'r1']);
    assert.equal(first.next_before, '2026-10-11T10:00:00.000Z');
    const second = paginate(rows, first.next_before, 2);
    assert.deepEqual(second.meetings.map(row => row.id), ['r2', 'r3']);
    assert.equal(second.next_before, null);
  });
});
