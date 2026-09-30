const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test'; // analytics stays off whatever the local .env says
const analytics = require('../../src/integrations/posthog/client');

test('analytics is off in tests and every helper is a no-op', () => {
  assert.equal(analytics.posthog, null);
  assert.doesNotThrow(() => {
    analytics.track('meeting_captured', { outcome_count: 3 }, 'U1');
    analytics.identify('U1', { email: 'ana@acme.com' });
    analytics.trackAiGeneration({ feature: 'extraction', response: { model: 'm' }, latencyMs: 10 });
  });
});

test('AI generation events carry tokens and latency, never the prompt or the output', () => {
  const response = {
    model: 'claude-sonnet-5',
    stop_reason: 'max_tokens',
    usage: { input_tokens: 1200, output_tokens: 300 },
    content: [{ type: 'text', text: '[{"decision_text": "Secret pricing decision"}]' }]
  };
  const props = analytics.aiGenerationProperties('extraction', response, 2500, { item_count: 1 });
  assert.equal(props.$ai_model, 'claude-sonnet-5');
  assert.equal(props.$ai_input_tokens, 1200);
  assert.equal(props.$ai_output_tokens, 300);
  assert.equal(props.$ai_latency, 2.5);
  assert.equal(props.$ai_stop_reason, 'max_tokens');
  assert.equal(props.item_count, 1);
  assert.ok(!JSON.stringify(props).includes('Secret'), 'no response content');
  assert.ok(!('$ai_input' in props) && !('$ai_output_choices' in props));
});

test('request properties keep the path and drop the query string (OAuth codes, search text)', () => {
  const props = analytics.requestProperties({ method: 'GET', originalUrl: '/auth/google/callback?state=abc&code=4/0AXsecret' });
  assert.deepEqual(props, { $current_url: '/auth/google/callback', $request_path: '/auth/google/callback', $request_method: 'GET' });
  assert.equal(analytics.requestProperties({ method: 'GET', url: '/api/decisions?search=pricing#x' }).$current_url, '/api/decisions');
});
