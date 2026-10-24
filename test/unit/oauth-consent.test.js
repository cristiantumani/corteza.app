const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formActionFor } = require('../../src/http/oauth-consent');
const { buildCsp } = require('../../src/middleware/auth');

test('the consent form may end at the assistant’s redirect URI', () => {
  assert.deepEqual(formActionFor('https://claude.ai/api/mcp/auth_callback'), ['https://claude.ai']);
  assert.deepEqual(formActionFor('http://localhost:6274/oauth/callback'), ['http://localhost:6274']);
  assert.deepEqual(formActionFor('cursor://anysphere.cursor-mcp/oauth/callback'), ['cursor:']);
  assert.deepEqual(formActionFor('not a url'), []);
  assert.deepEqual(formActionFor(undefined), []);
});

test('buildCsp keeps form-action self and adds only what is asked', () => {
  assert.match(buildCsp(), /form-action 'self';/);
  assert.match(buildCsp({ formAction: ['https://claude.ai'] }), /form-action 'self' https:\/\/claude\.ai;/);
});
