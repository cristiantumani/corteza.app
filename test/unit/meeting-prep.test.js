const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMeetingPrep, sameName } = require('../../src/core/briefs/meeting-prep');
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

test('each meeting lists my items shared with the people in it, from the same meeting, and theirs', () => {
  const prep = buildMeetingPrep({
    userId: 'UC',
    selfEmail: 'cristian@ninja.io',
    members,
    events: [
      event('Weekly Comercial', [['juan@ninja.io', 'Juan Pérez'], ['ana@cliente.com', 'Ana López']]),
      event('Solo focus time', []),
      event('Lunch with Pedro', [['pedro@gmail.com', 'Pedro']])
    ],
    mine: [
      item('m1', 'Send the pricing deck', [{ user_id: 'UC', name: 'Cristian' }, { user_id: 'UJ', name: 'Juan' }], { due_date: '2026-10-03' }),
      item('m2', 'Review the Q4 budget', [{ user_id: 'UC', name: 'Cristian' }], { source: { title: 'weekly comercial' } }),
      item('m3', 'Unrelated', [{ user_id: 'UC', name: 'Cristian' }], { source: { title: 'Board' } })
    ],
    others: [
      item('o1', 'Juan sends the contract', [{ user_id: 'UJ', name: 'Juan' }]),
      item('o2', 'Ana confirms the date', [{ user_id: null, name: 'Ana' }]),
      item('o3', 'Martín books the venue', [{ user_id: 'UM', name: 'Martín' }])
    ]
  });

  assert.equal(prep.length, 1, 'meetings with nobody else, or with nothing open, are left out');
  assert.equal(prep[0].title, 'Weekly Comercial');
  assert.deepEqual(prep[0].people, ['Juan Pérez', 'Ana López']);
  assert.deepEqual(prep[0].items.map(i => [i.item_id, i.owner]), [['m1', null], ['m2', null], ['o1', 'Juan'], ['o2', 'Ana']]);
  assert.equal(prep[0].items[0].due_date, '2026-10-03');
  assert.equal(prep[0].more, 0);
});

test('long lists are cut at 5 items per meeting', () => {
  const others = Array.from({ length: 7 }, (_, i) => item(`o${i}`, `Task ${i}`, [{ user_id: 'UJ', name: 'Juan' }]));
  const [meeting] = buildMeetingPrep({ userId: 'UC', selfEmail: 'cristian@ninja.io', members, events: [event('1:1 Juan', [['juan@ninja.io', 'Juan']])], mine: [], others });
  assert.equal(meeting.items.length, 5);
  assert.equal(meeting.more, 2);
});

test('the local day is bounded in the person\'s time zone, across daylight saving changes', () => {
  const santiago = localDayBounds(new Date('2026-10-02T11:00:00Z'), 'America/Santiago');
  assert.equal(santiago.start.toISOString(), '2026-10-02T03:00:00.000Z');
  assert.equal(santiago.end.toISOString(), '2026-10-03T03:00:00.000Z');
  const dstDay = localDayBounds(new Date('2026-03-29T12:00:00Z'), 'Europe/Amsterdam');
  assert.equal(dstDay.end - dstDay.start, 23 * 60 * 60 * 1000);
});

test('the morning summary has a "prepare for today\'s meetings" section, escaped', () => {
  const summary = {
    dayLabel: 'Friday', today: '2026-10-02', meetings: 0, outcomes: {}, newActionItems: 0, dueToday: 0, toReview: 0, overdue: 0, noDueDate: 0, planItems: [],
    meetingPrep: [{ time: '11:00 AM', title: 'Weekly <Comercial>', people: ['Juan Pérez'], items: [{ item_id: 'm1', text: 'Send the deck', due_date: '2026-10-03', owner: null }, { item_id: 'o1', text: 'Sign <b>', due_date: null, owner: 'Juan' }], more: 1 }]
  };
  const html = dailyDigestHtml({ workspace_name: 'Ninja', unsubscribe_url: 'u', summary });
  assert.match(html, /Prepare for today's meetings/);
  assert.match(html, /11:00 AM · Weekly &lt;Comercial&gt;/);
  assert.match(html, /With Juan Pérez/);
  assert.match(html, /Sign &lt;b&gt;/);
  assert.match(html, /You · due Oct 3/);
  assert.match(html, /and 1 more/);
  const overdue = dailyDigestHtml({ workspace_name: 'Ninja', unsubscribe_url: 'u', summary: { ...summary, meetingPrep: [{ ...summary.meetingPrep[0], items: [{ item_id: 'x', text: 'Late', due_date: '2026-09-30', owner: 'Juan' }] }] } });
  assert.match(overdue, /overdue since Sep 30/);
  assert.equal(dailyDigestSubject(summary), 'Your day: 1 meeting to prepare');
});
