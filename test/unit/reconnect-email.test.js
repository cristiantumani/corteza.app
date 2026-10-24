const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};

const { googleReconnectEmail, dailyDigestSubject, dailyDigestHtml } = require('../../src/utils/n8n-client');

describe('lost Google connection emails', () => {
  test('the reconnect email: in their language, the date and the link, nothing else', () => {
    const es = googleReconnectEmail({ since: 'lunes, 20 de octubre', lang: 'es' });
    assert.equal(es.subject, 'Corteza dejó de leer tus reuniones');
    assert.match(es.html, /lunes, 20 de octubre/);
    assert.match(es.html, /\/integrations\/google\/connect/);
    assert.match(es.html, /Reconectar Google/);

    const reminder = googleReconnectEmail({ since: 'Monday, October 20', reminder: true, lang: 'en' });
    assert.match(reminder.subject, /^Reminder:/);
    assert.match(reminder.html, /last notice/);
  });

  test('the date is escaped', () => {
    assert.ok(!googleReconnectEmail({ since: '<script>', lang: 'en' }).html.includes('<script>'));
  });

  test('the morning summary leads with the notice, and has its own subject when there is nothing else', () => {
    const summary = { meetings: 0, outcomes: {}, newActionItems: 0, dueToday: 0, overdue: 0, planItems: [], meetingPrep: [], dayLabel: 'lunes, 5 de octubre', googleLost: 'lunes, 28 de septiembre' };
    assert.equal(dailyDigestSubject(summary, 'es'), 'Corteza no está leyendo tus reuniones');
    const html = dailyDigestHtml({ workspace_name: 'Acme', summary, unsubscribe_url: 'https://x/u', lang: 'es' });
    assert.match(html, /Corteza no está leyendo tus reuniones desde el lunes, 28 de septiembre\./);
    assert.match(html, /\/integrations\/google\/connect/);
    assert.equal(dailyDigestSubject({ ...summary, googleLost: null }, 'es'), 'Planifica tu día con Corteza');
  });
});
