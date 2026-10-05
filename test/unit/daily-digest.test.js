const { test } = require('node:test');
const assert = require('node:assert/strict');
const { digestDay, hasNews, sinceLabel, timeZoneResolver } = require('../../src/jobs/daily-digest');
const { dailyDigestSubject, dailyDigestHtml } = require('../../src/utils/n8n-client');

test("sends weekday mornings from 8:00 in the person's own time zone, never on weekends", () => {
  delete process.env.DAILY_DIGEST_HOUR;
  // 11:00 UTC on Wednesday = 8:00 in Santiago (UTC-3), 13:00 in Madrid
  const wednesday = new Date('2026-09-30T11:00:00Z');
  assert.equal(digestDay(wednesday, 'America/Santiago'), '2026-09-30');
  assert.equal(digestDay(wednesday, 'Europe/Madrid'), null, 'past the morning window there');
  assert.equal(digestDay(new Date('2026-09-30T06:00:00Z'), 'Europe/Madrid'), '2026-09-30', '8:00 in Madrid');
  assert.equal(digestDay(new Date('2026-09-30T10:59:00Z'), 'America/Santiago'), null, '7:59 in Santiago');
  // The local date, not UTC's: 8:00 Thursday in Tokyo is still Wednesday in UTC
  assert.equal(digestDay(new Date('2026-09-30T23:00:00Z'), 'Asia/Tokyo'), '2026-10-01');
  assert.equal(digestDay(new Date('2026-10-03T11:00:00Z'), 'America/Santiago'), null, 'Saturday');
  assert.equal(digestDay(new Date('2026-09-30T08:30:00Z')), '2026-09-30', 'UTC without a time zone');
  assert.equal(digestDay(new Date('2026-09-30T08:30:00Z'), 'Not/AZone'), '2026-09-30', 'invalid zones fall back to UTC');

  process.env.DAILY_DIGEST_HOUR = '7';
  assert.equal(digestDay(new Date('2026-09-30T07:00:00Z'), 'UTC'), '2026-09-30');
  delete process.env.DAILY_DIGEST_HOUR;
});

test("people without a time zone get their workspace's most common one, else the default", () => {
  delete process.env.DAILY_DIGEST_DEFAULT_TIMEZONE;
  const zoneOf = timeZoneResolver([
    { workspace_id: 'W1', timezone: 'America/Santiago' },
    { workspace_id: 'W1', timezone: 'America/Santiago' },
    { workspace_id: 'W1', timezone: 'Europe/Madrid' },
    { workspace_id: 'W2', timezone: 'bogus' }
  ]);
  assert.equal(zoneOf({ workspace_id: 'W1', timezone: 'Europe/Madrid' }), 'Europe/Madrid', 'their own first');
  assert.equal(zoneOf({ workspace_id: 'W1' }), 'America/Santiago');
  assert.equal(zoneOf({ workspace_id: 'W2' }), 'UTC');

  process.env.DAILY_DIGEST_DEFAULT_TIMEZONE = 'America/Bogota';
  assert.equal(timeZoneResolver([])({ workspace_id: 'W3' }), 'America/Bogota');
  delete process.env.DAILY_DIGEST_DEFAULT_TIMEZONE;
});

test("the email says since when: yesterday, or Friday on Monday", () => {
  const monday = new Date('2026-10-05T11:00:00Z');
  assert.equal(sinceLabel(new Date('2026-10-02T11:00:00Z'), monday, 'America/Santiago'), 'Friday');
  assert.equal(sinceLabel(new Date('2026-10-04T11:00:00Z'), monday, 'America/Santiago'), 'yesterday');
});

test('only news or something due today triggers an email; reminders alone never do', () => {
  assert.equal(hasNews({ meetings: 0, newActionItems: 0, dueToday: 0, overdue: 5, toReview: 3 }), false);
  assert.equal(hasNews({ meetings: 1, newActionItems: 0, dueToday: 0 }), true);
  assert.equal(hasNews({ meetings: 0, newActionItems: 2, dueToday: 0 }), true);
  assert.equal(hasNews({ meetings: 0, newActionItems: 0, dueToday: 1 }), true);
});

test('the subject leads with the day ahead, then what happened since the last summary', () => {
  assert.equal(dailyDigestSubject({ since: 'yesterday', meetings: 3, outcomes: { decision: 5 }, newActionItems: 1, dueToday: 2, overdue: 2 }),
    'Your day: 2 due today, 2 overdue · since yesterday: 3 meetings, 5 decisions, 1 new action item');
  assert.equal(dailyDigestSubject({ since: 'Friday', meetings: 0, outcomes: {}, newActionItems: 2, overdue: 0 }), 'Since Friday: 2 new action items');
  assert.equal(dailyDigestSubject({ meetings: 0, outcomes: {}, newActionItems: 0, overdue: 0 }), 'Plan your day with Corteza');
});

test("the email lists the person's items, escaped, each linking to it in Corteza", () => {
  const html = dailyDigestHtml({
    workspace_name: 'Acme',
    unsubscribe_url: 'https://app.corteza.app/digest/unsubscribe?x',
    summary: {
      dayLabel: 'Thursday, October 1', today: '2026-10-01', since: 'yesterday',
      meetings: 1, outcomes: { decision: 1 }, newActionItems: 0, dueToday: 1, overdue: 1, toReview: 0, noDueDate: 0,
      planItems: [
        { item_id: 'act_1', text: 'Ship <script>alert(1)</script>', due_date: '2026-10-01', meeting: 'Weekly' },
        { item_id: 'act_2', text: 'Old one', due_date: '2026-09-28', meeting: null }
      ]
    }
  });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Ship &lt;script&gt;/);
  assert.match(html, /\/actions\?item=act_1/);
  assert.match(html, /Due today/);
  assert.match(html, /was due Sep 28/);
  assert.doesNotMatch(html, /See all/, 'every due item is already listed');
});

test('an item that is a next step on an open question says which one, escaped', () => {
  const html = dailyDigestHtml({
    workspace_name: 'Acme', unsubscribe_url: 'u',
    summary: {
      dayLabel: 'Friday', today: '2026-10-02', meetings: 0, outcomes: {}, newActionItems: 0, dueToday: 1, overdue: 0, toReview: 0, noDueDate: 0,
      planItems: [
        { item_id: 'act_1', text: 'Research the ISO 27001 requirements', due_date: '2026-10-02', meeting: null, next_step_on: 'Should we get <ISO 27001>?' },
        { item_id: 'act_2', text: 'Send the deck', due_date: '2026-10-02', meeting: null, next_step_on: null }
      ]
    }
  });
  assert.match(html, /Next step on: Should we get &lt;ISO 27001&gt;\?/);
  assert.equal(html.match(/Next step on:/g).length, 1);
});

test('the morning summary footer links to Buy me a coffee', () => {
  const { dailyDigestHtml } = require('../../src/utils/n8n-client');
  const html = dailyDigestHtml({ workspace_name: 'Ninja', unsubscribe_url: 'u', summary: { dayLabel: 'Friday', today: '2026-10-02', meetings: 0, outcomes: {}, newActionItems: 0, dueToday: 1, toReview: 0, overdue: 0, noDueDate: 0, planItems: [] } });
  assert.match(html, /href="https:\/\/buymeacoffee\.com\/corteza\.app"/);
});

test('with a morning partner, its line is the subject and opens the email; the counts move to the preheader', () => {
  const { dailyDigestHtml } = require('../../src/utils/n8n-client');
  const summary = {
    dayLabel: 'Monday, October 5', today: '2026-10-05', since: 'Friday', meetings: 1, outcomes: { decision: 1 },
    newActionItems: 0, dueToday: 0, toReview: 0, overdue: 1, noDueDate: 0, assignedBy: [], meetingPrep: [],
    planItems: [{ item_id: 'a1', text: 'Send the <deck>', due_date: '2026-10-01', meeting: null, next_step_on: null }]
  };
  const params = { workspace_name: 'Acme', summary, unsubscribe_url: 'https://x/u' };
  const classic = dailyDigestHtml(params);
  assert.equal(dailyDigestHtml({ ...params, partner: null }), classic);
  assert.ok(classic.includes('Good morning. Here'));
  assert.ok(!classic.includes('src=digest'), 'Classic links are unchanged');
  assert.ok(!classic.includes('Not mine?'));

  const partner = { voice: 'sarcastic', subject: 'An <overdue> item sends its regards.', opener: 'An <overdue> item sends its regards.', followUp: 'It’s been very patient.' };
  const html = dailyDigestHtml({ ...params, partner });
  assert.ok(html.includes('An &lt;overdue&gt; item sends its regards.'), 'the opener, escaped');
  assert.ok(html.includes('It’s been very patient.'));
  assert.ok(!html.includes('Good morning. Here'));
  assert.ok(html.includes('display: none; max-height: 0;') && html.includes('Your day: 1 overdue'), 'the counts are the preheader');
  assert.ok(html.includes('Send the &lt;deck&gt;'), 'the list is unchanged');
  assert.ok(html.includes('/actions?item=a1&src=digest&voice=sarcastic'), 'clicks say which voice brought them');
  assert.ok(html.includes('Not mine?'));
});

test('in Spanish: the whole summary, subject and dates', () => {
  const { dailyDigestHtml, dailyDigestSubject } = require('../../src/utils/n8n-client');
  const summary = {
    dayLabel: 'lunes, 5 de octubre', today: '2026-10-05', since: 'el viernes', meetings: 2, outcomes: { decision: 1, risk: 1 },
    newActionItems: 1, dueToday: 1, toReview: 2, overdue: 1, noDueDate: 1, assignedBy: [{ name: 'Bruno', count: 1 }], meetingPrep: [],
    planItems: [{ item_id: 'a1', text: 'Enviar la propuesta', due_date: '2026-10-01', meeting: null, next_step_on: '¿Quién aprueba?' }]
  };
  assert.equal(dailyDigestSubject(summary, 'es'), 'Tu día: 1 vence hoy, 1 atrasado · desde el viernes: 2 reuniones, 1 decisión, 1 pendiente nuevo');
  const html = dailyDigestHtml({ workspace_name: 'Acme', summary, unsubscribe_url: 'https://x/u', lang: 'es' });
  for (const text of ['Buenos días. Este es tu día.', 'Lo que tienes hoy', 'Atrasado · vencía el 1 oct', 'Siguiente paso para: ¿Quién aprueba?',
    '2 resultados por revisar', '1 pendiente sin fecha', 'Desde el viernes', 'También se capturó: 1 riesgo.', '1 pendiente nuevo que te asignaron tus colegas.',
    'Planificar mi día en Corteza', 'date de baja de los resúmenes de la mañana']) {
    assert.ok(html.includes(text), `missing: ${text}`);
  }
  assert.ok(!/Good morning|On your plate|Overdue/.test(html), 'no English left');
});
