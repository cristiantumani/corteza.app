const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { ageDays, pickNextStep, describeNextStep, statusFor, summarize, groupByMeeting } = require('../../src/core/topics/thread-view');

const NOW = new Date('2026-10-12T12:00:00Z');

describe('thread view: status line (docs/specs/2026-10-thread-as-unit.md)', () => {
  test('ageDays: whole days, never negative, null without a date', () => {
    assert.equal(ageDays('2026-10-12T08:00:00Z', NOW), 0);
    assert.equal(ageDays('2026-09-30T12:00:00Z', NOW), 12);
    assert.equal(ageDays('2026-10-20T12:00:00Z', NOW), 0);
    assert.equal(ageDays(null, NOW), null);
    assert.equal(ageDays('not a date', NOW), null);
  });

  test('pickNextStep: earliest due date, then undated (oldest first), only open ones', () => {
    const actions = [
      { item_id: 'a', status: 'open', due_date: null },
      { item_id: 'b', status: 'open', due_date: '2026-10-20' },
      { item_id: 'c', status: 'done', due_date: '2026-10-01' },
      { item_id: 'd', status: 'open', due_date: '2026-10-16' }
    ];
    assert.equal(pickNextStep(actions).item_id, 'd');
    assert.equal(pickNextStep([actions[0], { item_id: 'e', status: 'open' }]).item_id, 'a');
    assert.equal(pickNextStep([actions[2]]), null);
    assert.equal(pickNextStep([]), null);
  });

  test('describeNextStep: first owner, mine, overdue', () => {
    const step = describeNextStep({ item_id: 'x', text: 'Cotizar', owners: [{ name: null }, { name: 'Ana' }], mine: false, due_date: '2026-10-02' }, '2026-10-12');
    assert.deepEqual(step, { item_id: 'x', text: 'Cotizar', owner: 'Ana', mine: false, due_date: '2026-10-02', overdue: true });
    assert.equal(describeNextStep({ item_id: 'y', text: 'T', owners: [], mine: true, due_date: null }, '2026-10-12').owner, null);
    assert.equal(describeNextStep({ item_id: 'y', text: 'T', owners: [], due_date: '2026-10-12' }, '2026-10-12').overdue, false);
  });

  test('statusFor: open questions and risks only; next step and decisions from the thread', () => {
    const thread = {
      outcomes: [{ id: 1, type: 'open_question' }, { id: 2, type: 'decision' }, { id: 3, type: 'decision' }],
      actions: [{ item_id: 'a', status: 'open', due_date: '2026-10-16', owners: [{ name: 'Ana' }], text: 'Cotizar' }]
    };
    const status = statusFor({ type: 'open_question', timestamp: '2026-09-30T12:00:00Z' }, thread, NOW);
    assert.equal(status.age_days, 12);
    assert.equal(status.in_thread, true);
    assert.equal(status.next_step.owner, 'Ana');
    assert.equal(status.next_step.overdue, false);
    assert.equal(status.may_answer, 2);

    const lone = statusFor({ type: 'risk', timestamp: '2026-10-12T00:00:00Z' }, undefined, NOW);
    assert.deepEqual(lone, { age_days: 0, in_thread: false, next_step: null, may_answer: 0 });
    assert.equal(statusFor({ type: 'risk', resolution_status: 'resolved' }, thread, NOW), null);
    assert.equal(statusFor({ type: 'decision' }, thread, NOW), null);
  });

  test('summarize: open counts, overdue next steps and last activity', () => {
    const summary = summarize(
      [
        { type: 'open_question', resolution_status: 'open', timestamp: '2026-09-18T10:00:00Z' },
        { type: 'open_question', timestamp: '2026-09-20T10:00:00Z' },
        { type: 'open_question', resolution_status: 'resolved', timestamp: '2026-09-18T10:00:00Z', resolved_at: new Date('2026-10-07T10:00:00Z') },
        { type: 'risk', resolution_status: 'open', timestamp: '2026-09-18T10:00:00Z' },
        { type: 'decision', timestamp: '2026-10-01T10:00:00Z' }
      ],
      [
        { status: 'open', due_date: '2026-10-02', created_at: new Date('2026-09-18T10:00:00Z') },
        { status: 'open', due_date: null, created_at: new Date('2026-09-18T10:00:00Z') },
        { status: 'done', due_date: '2026-09-01', created_at: new Date('2026-09-18T10:00:00Z') }
      ],
      NOW
    );
    assert.deepEqual(summary, { open_questions: 2, risks: 1, next_steps: 2, overdue: 1, last_activity: '2026-10-07T10:00:00.000Z' });
    assert.deepEqual(summarize([], [], NOW), { open_questions: 0, risks: 0, next_steps: 0, overdue: 0, last_activity: null });
  });

  test('groupByMeeting: by meeting and day, oldest first', () => {
    const groups = groupByMeeting([
      { id: 1, meeting: 'Weekly', date: '2026-09-25T10:00:00Z' },
      { id: 2, meeting: 'Weekly', date: '2026-09-18T10:00:00Z' },
      { id: 3, meeting: 'Weekly', date: '2026-09-18T11:00:00Z' },
      { id: 4, meeting: null, date: '2026-09-20T10:00:00Z' }
    ]);
    assert.deepEqual(groups.map(g => [g.title, g.items.map(i => i.id)]), [['Weekly', [2, 3]], [null, [4]], ['Weekly', [1]]]);
  });
});
