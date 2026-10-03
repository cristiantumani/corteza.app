const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let sent;
let originalFetch;
let mailer;

beforeEach(() => {
  sent = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: 'email_1' }) };
  };
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.BETA_FROM;
  // The mailer keeps a reference to fetch: load it fresh with the stub in place
  delete require.cache[require.resolve('../../src/utils/n8n-client')];
  console.log = () => {};
  mailer = require('../../src/utils/n8n-client');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('the beta welcome email comes from Cristian, so testers can reply to a person', async () => {
  await mailer.sendBetaWelcomeEmail({ email: 'ana@acme.com', name: 'Ana', login_url: 'https://app.corteza.app/auth/login' });
  assert.equal(sent[0].from, 'Cristian from Corteza <cristian@corteza.app>');
  assert.equal(sent[0].reply_to, undefined, 'replies go to the sender');
});

test('BETA_FROM and a reply-to address override the defaults', async () => {
  process.env.BETA_FROM = 'Founder <founder@corteza.app>';
  await mailer.sendBetaWelcomeEmail({ email: 'ana@acme.com', login_url: 'u', reply_to: 'team@corteza.app' });
  assert.equal(sent[0].from, 'Founder <founder@corteza.app>');
  assert.equal(sent[0].reply_to, 'team@corteza.app');
});

test('the morning summary still comes from noreply', async () => {
  await mailer.sendDailyDigestEmail({
    email: 'ana@acme.com', workspace_name: 'Acme', unsubscribe_url: 'u',
    summary: { dayLabel: 'Friday', today: '2026-10-02', meetings: 0, outcomes: {}, newActionItems: 0, dueToday: 1, overdue: 0, toReview: 0, noDueDate: 0, planItems: [] }
  });
  assert.equal(sent[0].from, 'Corteza <noreply@corteza.app>');
});
