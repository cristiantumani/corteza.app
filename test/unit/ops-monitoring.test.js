const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { scrubEvent, redactMessage } = require('../../src/integrations/sentry/client');
const { classifyAiFailure, watchedFetch } = require('../../src/integrations/anthropic/client');

describe('Sentry scrubbing (docs/specs/2026-10-ops-monitoring.md)', () => {
  test('keeps the error and internal ids, drops request data, user, breadcrumbs and extra', () => {
    const event = scrubEvent({
      request: { method: 'POST', url: 'https://app.corteza.app/api/decide?text=secret', data: '{"text":"Decidimos"}', cookies: { sid: 'x' }, headers: { authorization: 'y' } },
      user: { id: 'U1', email: 'ana@acme.example', ip_address: '1.2.3.4' },
      breadcrumbs: [{ message: 'GET /api/threads/top_1' }],
      extra: { body: 'meeting text' },
      contexts: { runtime: { name: 'node' }, os: { name: 'linux' }, culture: { locale: 'es' } },
      tags: { workspace_id: 'W1', user_id: 'U1', job: 'daily_digest', email: 'ana@acme.example' },
      exception: { values: [{ type: 'SyntaxError', value: 'Unexpected token \'D\', "Decidimos no ir por ISO" is not valid JSON' }] }
    });
    assert.deepEqual(event.request, { method: 'POST', url: 'https://app.corteza.app/api/decide' });
    assert.equal(event.user, undefined);
    assert.equal(event.breadcrumbs, undefined);
    assert.equal(event.extra, undefined);
    assert.deepEqual(Object.keys(event.contexts).sort(), ['os', 'runtime']);
    assert.deepEqual(event.tags, { workspace_id: 'W1', user_id: 'U1', job: 'daily_digest' });
    assert.ok(!event.exception.values[0].value.includes('Decidimos'), 'quoted content is redacted');
  });

  test('redactMessage: quoted text goes, the rest stays, at most 300 characters', () => {
    assert.equal(redactMessage('Bad "Plan anual" and \'x\' and “y”'), 'Bad "…" and "…" and "…"');
    assert.equal(redactMessage('a'.repeat(400)).length, 300);
  });
});

describe('Claude failures that need an alert', () => {
  test('classifyAiFailure: credit, auth, everything else ignored', () => {
    const body = (type, message) => JSON.stringify({ type: 'error', error: { type, message } });
    assert.deepEqual(classifyAiFailure(400, body('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')), { type: 'ai_credit', reason: 'credit balance too low' });
    assert.deepEqual(classifyAiFailure(401, body('authentication_error', 'invalid x-api-key')), { type: 'ai_auth', reason: 'authentication_error' });
    assert.equal(classifyAiFailure(403, 'not json').type, 'ai_auth');
    assert.equal(classifyAiFailure(400, body('invalid_request_error', 'max_tokens too large')), null);
    assert.equal(classifyAiFailure(429, body('rate_limit_error', 'slow down')), null);
    assert.equal(classifyAiFailure(500, ''), null);
  });

  test('watchedFetch raises on a billing error, resolves on the next success, and returns the response untouched', async () => {
    const calls = [];
    const responses = [
      new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }), { status: 400 }),
      new Response('{"ok":true}', { status: 200 })
    ];
    const fetch = watchedFetch({
      fetch: async () => responses.shift(),
      raise: async (type, detail) => calls.push(['raise', type, detail.status]),
      resolve: async type => calls.push(['resolve', type])
    });
    const failed = await fetch('https://api.anthropic.com/v1/messages');
    assert.equal(failed.status, 400);
    assert.match(await failed.text(), /credit balance/, 'the SDK can still read the body');
    await fetch('https://api.anthropic.com/v1/messages');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['raise', 'ai_credit', 400], ['resolve', 'ai_credit']]);
  });
});
