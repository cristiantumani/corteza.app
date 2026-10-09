const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMeetingPrep, hasContent, sameName, sameTitle, unrelatedTitles } = require('../../src/core/briefs/meeting-prep');
const { meetingCodeOf } = require('../../src/integrations/google/calendar-client');
const { localDayBounds } = require('../../src/core/users/timezone');
const { dailyDigestHtml, dailyDigestSubject } = require('../../src/utils/n8n-client');

const members = [
  { user_id: 'UC', user_name: 'Cristian Tumani', email: 'cristian@ninja.io' },
  { user_id: 'UJ', user_name: 'Juan Pérez', email: 'juan@ninja.io' },
  { user_id: 'UM', user_name: 'Martín Marchant', email: 'martin@ninja.io' }
];
const event = (title, attendees, start = '2026-10-02T14:00:00Z') => ({
  id: title, title, start,
  attendees: [{ email: 'cristian@ninja.io', name: 'Cristian', self: true }, ...attendees.map(([email, name]) => ({ email, name, self: false }))]
});
const item = (id, text, owners, extra = {}) => ({ item_id: id, text, due_date: null, owners, ...extra });

test('names said in a meeting match calendar attendees by full or first name', () => {
  assert.ok(sameName('Juan Pérez', 'juan perez'));
  assert.ok(sameName('Juan', 'Juan Pérez'));
  assert.ok(!sameName('Juan Pérez', 'Juan Soto'), 'two full names must match in full');
  assert.ok(!sameName('', 'Juan'));
});

const TODAY = '2026-10-08';
const weekly = event('Weekly Product-Led Growth', [['juan@ninja.io', 'Juan Pérez'], ['martin@ninja.io', 'Martín Marchant']], '2026-10-08T19:15:00Z');
const oneOnOne = event('Cristian / Juan', [['juan@ninja.io', 'Juan Pérez']], '2026-10-08T15:00:00Z');
const fromMeet = (record, title, occurredAt = '2026-10-01T19:15:00Z') => ({ external_id: record, title, occurred_at: occurredAt });
const records = new Map([
  ['Weekly Product-Led Growth', [{ name: 'conferenceRecords/w1', startTime: '2026-09-24T19:16:00Z' }, { name: 'conferenceRecords/w2', startTime: '2026-10-01T19:15:30Z' }]],
  ['Cristian / Juan', [{ name: 'conferenceRecords/o1', startTime: '2026-10-06T15:00:00Z' }]]
]);
const build = (extra = {}) => buildMeetingPrep({ userId: 'UC', selfEmail: 'cristian@ninja.io', members, records, actions: [], outcomes: [], today: TODAY, events: [weekly, oneOnOne], ...extra });

test('a meeting shows what came out of its own earlier sessions, everyone’s, never what its attendees own elsewhere', () => {
  const actions = [
    item('a1', 'Juan benchmarks the industry', [{ user_id: 'UJ', name: 'Juan Pérez' }], { status: 'open', due_date: '2026-10-07', source: fromMeet('conferenceRecords/w2', 'Weekly Product-Led Growth') }),
    item('a2', 'Prepare the pricing page', [{ user_id: 'UC', name: 'Cristian' }], { status: 'open', due_date: '2026-10-10', source: fromMeet('conferenceRecords/w1', 'Weekly Product-Led Growth') }),
    item('a3', 'Find cheaper tools than Asana', [{ user_id: 'UJ', name: 'Juan Pérez' }], { status: 'open', source: fromMeet('conferenceRecords/o1', 'Cristian / Juan') }),
    item('a4', 'Unassigned follow-up', [], { status: 'open', source: { title: 'weekly product led growth' } })
  ];
  const [weeklyPrep, oneOnOnePrep] = build({ actions });

  assert.equal(weeklyPrep.kind, 'series');
  assert.equal(weeklyPrep.last_met, '2026-10-01T19:15:30.000Z');
  assert.deepEqual(weeklyPrep.items.map(i => [i.item_id, i.mine, i.owner]), [
    ['a1', false, 'Juan Pérez'], // overdue first
    ['a2', true, null],
    ['a4', false, null] // matched by title (an upload), no owner
  ]);
  assert.ok(!weeklyPrep.items.some(i => i.item_id === 'a3'), 'the 1:1 item stays in the 1:1, although Juan is in the weekly');
  assert.deepEqual(oneOnOnePrep.items.map(i => i.item_id), ['a3']);
  assert.equal(oneOnOnePrep.suggested, false);
});

test('each meeting carries its end time and how many of its items are overdue (Home)', () => {
  const ending = { ...weekly, end: '2026-10-08T20:00:00Z' };
  const actions = [
    item('o1', 'Late one', [{ user_id: 'UJ', name: 'Juan Pérez' }], { status: 'open', due_date: '2026-10-01', source: fromMeet('conferenceRecords/w2', 'Weekly Product-Led Growth') }),
    item('o2', 'Due later', [{ user_id: 'UJ', name: 'Juan Pérez' }], { status: 'open', due_date: '2026-10-20', source: fromMeet('conferenceRecords/w2', 'Weekly Product-Led Growth') })
  ];
  const [prep] = build({ events: [ending], actions });
  assert.equal(prep.end, '2026-10-08T20:00:00Z');
  assert.equal(prep.overdue, 1);
  assert.equal(build({ events: [oneOnOne] })[0].end, null);
});

test('closed since last time, and the open questions and risks of the meeting', () => {
  const actions = [
    item('d1', 'Ship the onboarding emails', [{ user_id: 'UM', name: 'Martín Marchant' }], { status: 'done', completed_at: '2026-10-03T12:00:00Z', source: fromMeet('conferenceRecords/w2', 'Weekly Product-Led Growth') }),
    item('d2', 'Closed before last time', [{ user_id: 'UM', name: 'Martín' }], { status: 'done', completed_at: '2026-09-28T12:00:00Z', source: fromMeet('conferenceRecords/w1', 'Weekly Product-Led Growth') })
  ];
  const outcomes = [
    { id: 1, type: 'open_question', text: 'Do we charge for the API?', owner_name: 'Juan', resolution_status: 'open', source_details: fromMeet('conferenceRecords/w2', 'Weekly Product-Led Growth') },
    { id: 2, type: 'risk', text: 'Churn after the price change', resolution_status: 'resolved', resolved_at: '2026-10-05T10:00:00Z', resolved_by: { name: 'Cristian' }, source_details: fromMeet('conferenceRecords/w1', 'Weekly Product-Led Growth') },
    { id: 3, type: 'open_question', text: 'From another meeting', resolution_status: 'open', source_details: fromMeet('conferenceRecords/zz', 'Board') }
  ];
  const [weeklyPrep] = build({ actions, outcomes });
  assert.deepEqual(weeklyPrep.questions, [{ type: 'open_question', text: 'Do we charge for the API?', owner: 'Juan' }]);
  assert.deepEqual(weeklyPrep.closed.map(c => [c.type, c.text, c.owner]), [
    ['risk', 'Churn after the price change', 'Cristian'],
    ['action_item', 'Ship the onboarding emails', 'Martín Marchant']
  ]);
  assert.deepEqual(weeklyPrep.items, []);
  assert.ok(hasContent(weeklyPrep));
});

test('a meeting without history is listed with nothing; a 1:1 without history suggests what we share', () => {
  const board = event('Directorio LATAM', [['juan@ninja.io', 'Juan Pérez'], ['martin@ninja.io', 'Martín']], '2026-10-08T23:00:00Z');
  const coffee = event('Café con Juan', [['juan@ninja.io', 'Juan Pérez']], '2026-10-08T13:00:00Z');
  const actions = [
    item('a3', 'Find cheaper tools than Asana', [{ user_id: 'UJ', name: 'Juan Pérez' }], { status: 'open', source: fromMeet('conferenceRecords/o1', 'Cristian / Juan') }),
    item('a5', 'Martín books the venue', [{ user_id: 'UM', name: 'Martín' }], { status: 'open', source: fromMeet('conferenceRecords/x', 'Offsite') })
  ];
  const [boardPrep, coffeePrep] = build({ events: [board, coffee], actions, records: new Map([['Directorio LATAM', []]]) });
  assert.equal(boardPrep.kind, 'new');
  assert.deepEqual(boardPrep.items, [], 'nothing from the attendees');
  assert.ok(!hasContent(boardPrep));
  assert.equal(coffeePrep.kind, 'new');
  assert.equal(coffeePrep.suggested, true);
  assert.deepEqual(coffeePrep.items.map(i => i.item_id), ['a3']);
});

test('a personal Meet room reused for unrelated meetings doesn’t mix them; copies show once; long lists are cut', () => {
  const actions = [
    item('p1', 'From a sales call in the same room', [{ user_id: 'UJ', name: 'Juan' }], { status: 'open', source: fromMeet('conferenceRecords/w2', 'Llamada Acme ventas') }),
    item('p2', 'Untitled capture of the weekly', [{ user_id: 'UJ', name: 'Juan' }], { status: 'open', source: fromMeet('conferenceRecords/w2', 'Google Meet on 2026-10-01 19:15 UTC') }),
    ...Array.from({ length: 7 }, (_, i) => item(`t${i}`, `Task ${i}`, [{ user_id: 'UJ', name: 'Juan' }], { status: 'open', source: fromMeet('conferenceRecords/w2', 'Weekly Product-Led Growth') })),
    item('t0-copy', 'Task 0', [{ user_id: 'UM', name: 'Martín' }], { status: 'open', source: fromMeet('conferenceRecords/w2', 'Weekly Product-Led Growth') })
  ];
  const [weeklyPrep] = build({ actions, events: [weekly] });
  const shown = [...weeklyPrep.items.map(i => i.item_id)];
  assert.ok(!shown.includes('p1'));
  assert.equal(weeklyPrep.items.length, 5);
  assert.equal(weeklyPrep.more, 3, '8 distinct items: p2 and Task 0..6');
  assert.ok(!shown.includes('t0-copy'));
  assert.ok(unrelatedTitles('Llamada Acme ventas', 'Weekly Product-Led Growth'));

  // Same generic title, another Meet link: another meeting (title only helps when the history is unknown)
  const sync = event('Sync', [['juan@ninja.io', 'Juan']], '2026-10-08T20:00:00Z');
  const otherSync = item('s1', 'From the other Sync', [{ user_id: 'UJ', name: 'Juan' }], { status: 'open', source: fromMeet('conferenceRecords/other', 'Sync') });
  assert.deepEqual(build({ events: [sync], actions: [otherSync], records: new Map([['Sync', [{ name: 'conferenceRecords/mine', startTime: '2026-10-01T20:00:00Z' }]]]) })[0].items, []);
  assert.equal(build({ events: [sync], actions: [otherSync], records: new Map([['Sync', null]]) })[0].items.length, 1);
  assert.ok(!unrelatedTitles('Weekly PLG', 'Weekly Product-Led Growth'));
  assert.ok(sameTitle('Weekly Product-Led Growth', 'weekly product led growth'));
});

test('the Meet code comes from the event’s Meet link or conference data', () => {
  assert.equal(meetingCodeOf({ hangoutLink: 'https://meet.google.com/abc-defg-hij' }), 'abc-defg-hij');
  assert.equal(meetingCodeOf({ conferenceData: { conferenceSolution: { key: { type: 'hangoutsMeet' } }, conferenceId: 'XYZ-ABCD-EFG' } }), 'xyz-abcd-efg');
  assert.equal(meetingCodeOf({ conferenceData: { conferenceSolution: { key: { type: 'addOn' } }, conferenceId: '123"; drop' } }), null);
  assert.equal(meetingCodeOf({}), null);
});

test('the local day is bounded in the person\'s time zone, across daylight saving changes', () => {
  const santiago = localDayBounds(new Date('2026-10-02T11:00:00Z'), 'America/Santiago');
  assert.equal(santiago.start.toISOString(), '2026-10-02T03:00:00.000Z');
  assert.equal(santiago.end.toISOString(), '2026-10-03T03:00:00.000Z');
  const dstDay = localDayBounds(new Date('2026-03-29T12:00:00Z'), 'Europe/Amsterdam');
  assert.equal(dstDay.end - dstDay.start, 23 * 60 * 60 * 1000);
});

test('the morning summary shows each meeting’s own open items, questions and closed ones, escaped', () => {
  const summary = {
    dayLabel: 'Friday', today: '2026-10-02', meetings: 0, outcomes: {}, newActionItems: 0, dueToday: 0, toReview: 0, overdue: 0, noDueDate: 0, planItems: [],
    meetingPrep: [
      {
        time: '11:00 AM', title: 'Weekly <Comercial>', people: ['Juan Pérez'], kind: 'series', last_met: '2026-09-25', suggested: false, more: 1,
        items: [{ item_id: 'm1', text: 'Send the deck', due_date: '2026-10-03', mine: true, owner: null }, { item_id: 'o1', text: 'Sign <b>', due_date: null, mine: false, owner: 'Juan' }, { item_id: 'u1', text: 'Nobody’s', due_date: null, mine: false, owner: null }],
        questions: [{ type: 'risk', text: 'Churn <risk>', owner: null }],
        closed: [{ type: 'action_item', text: 'Booked the venue', owner: 'Martín' }]
      },
      { time: '3:00 PM', title: 'Directorio', people: ['Ana'], kind: 'new', last_met: null, suggested: false, more: 0, items: [], questions: [], closed: [] },
      { time: '5:00 PM', title: 'Café', people: ['Juan Pérez'], kind: 'new', last_met: null, suggested: true, more: 0, items: [{ item_id: 's1', text: 'Shared task', due_date: null, mine: false, owner: 'Juan Pérez' }], questions: [], closed: [] }
    ]
  };
  const html = dailyDigestHtml({ workspace_name: 'Ninja', unsubscribe_url: 'u', summary });
  assert.match(html, /Prepare for today’s meetings/);
  assert.match(html, /11:00 AM · Weekly &lt;Comercial&gt;/);
  assert.match(html, /With Juan Pérez · Last time: Sep 25/);
  assert.match(html, /Sign &lt;b&gt;/);
  assert.match(html, /You · due Oct 3/);
  assert.match(html, /No owner/);
  assert.match(html, /Risk/);
  assert.match(html, /Churn &lt;risk&gt;/);
  assert.match(html, /Closed since last time/);
  assert.match(html, /Booked the venue/);
  assert.match(html, /and 1 more/);
  assert.match(html, /No action items connected to this meeting yet\.<\/div>/);
  assert.match(html, /Suggested, since you’re meeting Juan Pérez/);
  const overdue = dailyDigestHtml({ workspace_name: 'Ninja', unsubscribe_url: 'u', summary: { ...summary, meetingPrep: [{ ...summary.meetingPrep[0], items: [{ item_id: 'x', text: 'Late', due_date: '2026-09-30', mine: false, owner: 'Juan' }] }] } });
  assert.match(overdue, /overdue since Sep 30/);
  assert.equal(dailyDigestSubject(summary), 'Your day: 2 meetings to prepare', 'meetings with nothing to show don’t count');
  const es = dailyDigestHtml({ workspace_name: 'Ninja', unsubscribe_url: 'u', summary, lang: 'es' });
  assert.match(es, /Última vez: 25 sept/);
  assert.match(es, /Cerrado desde la última vez/);
});
