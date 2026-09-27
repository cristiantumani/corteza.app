const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.BASE_URL = 'https://app.example.com';

const google = require('../../src/integrations/google/oauth');
const { safeReturnPath } = require('../../src/auth/routes');

test('sign-in URL asks only for openid/email/profile and carries state and nonce', () => {
  const url = new URL(google.buildSignInUrl({ state: 'st4te', nonce: 'n0nce' }));

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), 'test-client.apps.googleusercontent.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/auth/google/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), ['email', 'openid', 'profile']);
  assert.equal(url.searchParams.get('state'), 'st4te');
  assert.equal(url.searchParams.get('nonce'), 'n0nce');
});

test('random tokens are unique and URL-safe', () => {
  const a = google.randomToken();
  const b = google.randomToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
});

test('post-login return paths must be same-site relative paths', () => {
  assert.equal(safeReturnPath('/dashboard?space=1'), '/dashboard?space=1');
  assert.equal(safeReturnPath('/settings'), '/settings');
  assert.equal(safeReturnPath('//evil.com'), null);
  assert.equal(safeReturnPath('/\\evil.com'), null);
  assert.equal(safeReturnPath('https://evil.com'), null);
  assert.equal(safeReturnPath(undefined), null);
  assert.equal(safeReturnPath(['/a']), null);
});
