const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

describe('login tokens, workspace membership and default spaces', { skip }, () => {
  let db;
  let cleanup;
  let loginTokens;
  let spaces;
  let dashboardAuth;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    const database = require('../../src/config/database');
    db = database.getDatabase();
    loginTokens = require('../../src/services/login-tokens');
    spaces = require('../../src/services/spaces');
    dashboardAuth = require('../../src/routes/dashboard-auth');
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  /** Calls GET /auth/token with a fake Express req/res and resolves with the response */
  function tokenLogin(token) {
    return new Promise((resolve, reject) => {
      const req = {
        query: { token },
        session: { save: cb => cb(null) }
      };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        send(body) { resolve({ status: this.statusCode, body, session: req.session }); }
      };
      dashboardAuth.handleTokenLogin(req, res).catch(reject);
    });
  }

  test('login tokens are one-time and stored hashed', async () => {
    const token = await loginTokens.createLoginToken({ user_id: 'U1', workspace_id: 'W1', origin: 'email' });

    const stored = await db.collection('login_tokens').findOne({});
    assert.equal(stored.token, undefined);
    assert.notEqual(stored.token_hash, token);

    assert.equal((await loginTokens.peekLoginToken(token)).user_id, 'U1');
    assert.equal((await loginTokens.consumeLoginToken(token)).user_id, 'U1');
    assert.equal(await loginTokens.consumeLoginToken(token), null);
    assert.equal(await loginTokens.consumeLoginToken('bogus'), null);
  });

  test('expired login tokens are rejected', async () => {
    const token = await loginTokens.createLoginToken({ user_id: 'U1', workspace_id: 'W1', origin: 'email' }, -1000);
    assert.equal(await loginTokens.consumeLoginToken(token), null);
  });

  test('ensureDefaultSpace creates one public default space, even when called concurrently', async () => {
    const results = await Promise.all([
      spaces.ensureDefaultSpace('WSPACE'),
      spaces.ensureDefaultSpace('WSPACE'),
      spaces.ensureDefaultSpace('WSPACE')
    ]);

    const defaults = await db.collection('workspace_spaces').find({ workspace_id: 'WSPACE', is_default: true }).toArray();
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].visibility, 'public');
    assert.ok(results.every(space => space.space_id === defaults[0].space_id));
  });

  test('first magic-link user of a new workspace becomes admin and gets a default space', async () => {
    const token = await dashboardAuth.generateLoginToken('UA', 'Ana', 'WNEW', 'new', 'ana@new.com', 'email');
    const response = await tokenLogin(token);

    assert.equal(response.status, 200);
    assert.equal(response.session.user.workspace_id, 'WNEW');
    assert.match(response.body, /\/auth\/onboarding/);

    const member = await db.collection('workspace_members').findOne({ workspace_id: 'WNEW', user_id: 'UA' });
    assert.equal(member.role, 'admin');
    assert.ok(await db.collection('workspace_admins').findOne({ workspace_id: 'WNEW', user_id: 'UA' }));
    assert.ok(await db.collection('workspace_spaces').findOne({ workspace_id: 'WNEW', is_default: true }));
  });

  test('magic link cannot be used to join an existing workspace', async () => {
    const token = await dashboardAuth.generateLoginToken('UMAL', 'Mallory', 'WNEW', 'new', 'mallory@evil.com', 'email');
    const response = await tokenLogin(token);

    assert.equal(response.status, 403);
    assert.equal(response.session.user, undefined);
    assert.equal(await db.collection('workspace_members').findOne({ user_id: 'UMAL' }), null);
    assert.equal(await db.collection('workspace_admins').findOne({ user_id: 'UMAL' }), null);
  });

  test('Slack /login joins an existing workspace as a regular member', async () => {
    const token = await dashboardAuth.generateLoginToken('USLACK', 'Sam', 'WNEW', 'new', null, 'slack');
    const response = await tokenLogin(token);

    assert.equal(response.status, 200);
    const member = await db.collection('workspace_members').findOne({ workspace_id: 'WNEW', user_id: 'USLACK' });
    assert.equal(member.role, 'member');
    assert.equal(await db.collection('workspace_admins').findOne({ user_id: 'USLACK' }), null);
  });

  test('existing members log in normally', async () => {
    await db.collection('workspace_members').updateOne({ user_id: 'UA' }, { $set: { onboarding_completed: true } });
    const token = await dashboardAuth.generateLoginToken('UA', 'Ana', 'WNEW', 'new', 'ana@new.com', 'password');
    const response = await tokenLogin(token);

    assert.equal(response.status, 200);
    assert.match(response.body, /\/dashboard/);
  });

  test('password reset tokens cannot be used to log in', async () => {
    const token = await dashboardAuth.generateLoginToken('UA', 'Ana', 'WNEW', 'new', 'ana@new.com', 'password_reset');
    const response = await tokenLogin(token);
    assert.equal(response.status, 401);
  });
});
