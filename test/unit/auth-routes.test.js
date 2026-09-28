const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');

process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.BASE_URL = 'https://app.example.com';

// The routes log every sign-in; keep test output clean (heavy stdout output can
// confuse the node:test runner's IPC with the parent process)
console.log = () => {};
console.error = () => {};

// Stub Google token verification and workspace resolution; the routes are what's under test
const verifyCalls = [];
const oauth = require('../../src/integrations/google/oauth');
oauth.verifySignInCode = async ({ code, nonce }) => {
  verifyCalls.push({ code, nonce });
  if (code === 'bad') throw new Error('invalid_grant');
  return { sub: 's', email: 'ana@acme.com', email_verified: true, hd: 'acme.com' };
};
const signin = require('../../src/auth/google-signin');
let signInResult = null;
let lastInviteId;
signin.signInWithGoogle = async (identity, { inviteId }) => {
  lastInviteId = inviteId;
  return signInResult;
};

const router = require('../../src/auth/routes');

describe('auth routes', () => {
  let server;
  let base;

  before(async () => {
    const app = express();
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use(router);
    app.get('/whoami', (req, res) => res.json(req.session.user || null));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  /** Starts sign-in and returns { cookie, state, location } */
  async function start(query = '') {
    const response = await fetch(`${base}/auth/google${query}`, { redirect: 'manual' });
    const location = response.headers.get('location');
    return { cookie: response.headers.get('set-cookie').split(';')[0], state: new URL(location).searchParams.get('state'), location };
  }

  function callback(cookie, params) {
    return fetch(`${base}/auth/google/callback?${new URLSearchParams(params)}`, { headers: { cookie }, redirect: 'manual' });
  }

  test('start redirects to Google with state and nonce', async () => {
    const { location, state } = await start();
    const url = new URL(location);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.ok(state);
    assert.ok(url.searchParams.get('nonce'));
  });

  test('callback with a wrong state is rejected', async () => {
    const { cookie } = await start();
    const response = await callback(cookie, { code: 'c', state: 'forged' });
    assert.match(response.headers.get('location'), /^\/auth\/login\?error=/);
    assert.equal(verifyCalls.length, 0);
  });

  test('callback without the sign-in cookie is rejected', async () => {
    const { state } = await start();
    const response = await callback('', { code: 'c', state });
    assert.match(response.headers.get('location'), /session%20expired/);
  });

  test('successful sign-in creates a new session and honours the return path and invite', async () => {
    signInResult = {
      sessionUser: { user_id: 'U1', workspace_id: 'W1', email: 'ana@acme.com' },
      needsOnboarding: false
    };
    const { cookie, state } = await start('?return=%2Fsettings&invite=inv_1');
    const response = await callback(cookie, { code: 'good', state });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/settings');
    assert.equal(lastInviteId, 'inv_1');
    assert.equal(verifyCalls.at(-1).code, 'good');

    const newCookie = response.headers.get('set-cookie').split(';')[0];
    assert.notEqual(newCookie, cookie, 'session ID is regenerated on login');
    const whoami = await (await fetch(`${base}/whoami`, { headers: { cookie: newCookie } })).json();
    assert.equal(whoami.workspace_id, 'W1');

    // The state can't be replayed
    const replay = await callback(cookie, { code: 'good', state });
    assert.match(replay.headers.get('location'), /^\/auth\/login\?error=/);
  });

  test('new workspace creators go to onboarding', async () => {
    signInResult = { sessionUser: { user_id: 'U2', workspace_id: 'W2' }, needsOnboarding: true };
    const { cookie, state } = await start();
    const response = await callback(cookie, { code: 'good', state });
    assert.equal(response.headers.get('location'), '/auth/onboarding');
  });

  test('sign-in errors and Google failures go back to the login page with a message', async () => {
    signInResult = { error: 'Invite has expired' };
    let { cookie, state } = await start();
    let response = await callback(cookie, { code: 'good', state });
    assert.equal(response.headers.get('location'), '/auth/login?error=Invite%20has%20expired');

    ({ cookie, state } = await start());
    response = await callback(cookie, { code: 'bad', state });
    assert.match(response.headers.get('location'), /Google%20sign-in%20failed/);

    ({ cookie, state } = await start());
    response = await callback(cookie, { error: 'access_denied', state });
    assert.match(response.headers.get('location'), /cancelled/);
  });

  test('people without beta access go to the early access form with their email, and get no session', async () => {
    signInResult = { notInBeta: true, email: 'new@other.com' };
    const { cookie, state } = await start();
    const response = await callback(cookie, { code: 'good', state });

    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin + location.pathname, 'https://corteza.app/early-access');
    assert.equal(location.searchParams.get('email'), 'new@other.com');
    assert.equal(location.searchParams.get('from'), 'signin');
    const whoami = await (await fetch(`${base}/whoami`, { headers: { cookie } })).json();
    assert.equal(whoami, null);
  });
});
