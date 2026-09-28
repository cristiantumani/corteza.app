const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

/** Minimal verified Google ID token claims */
function identity(overrides = {}) {
  return { sub: `sub-${Math.random()}`, email_verified: true, name: 'Test User', ...overrides };
}

describe('private beta', { skip }, () => {
  let db;
  let cleanup;
  let signInWithGoogle;
  let beta;
  let approveBetaTester;
  let mailer;
  const sent = [];

  before(async () => {
    process.env.BETA_REQUIRED = 'true';
    process.env.BETA_APPROVAL_SECRET = 'test-beta-secret';
    delete process.env.RESEND_API_KEY;
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    ({ signInWithGoogle } = require('../../src/auth/google-signin'));
    beta = require('../../src/core/beta/beta-access');
    ({ approveBetaTester } = require('../../src/core/beta/approve'));
    mailer = require('../../src/utils/n8n-client');
    mailer.sendBetaWelcomeEmail = async params => { sent.push(params); return { success: true }; };
  });

  after(async () => {
    delete process.env.BETA_REQUIRED;
    if (cleanup) await cleanup();
  });

  test('someone not approved gets notInBeta and nothing is saved', async () => {
    const personal = await signInWithGoogle(identity({ email: 'Solo@gmail.com' }));
    assert.deepEqual(personal, { notInBeta: true, email: 'solo@gmail.com' });

    const company = await signInWithGoogle(identity({ email: 'ceo@newco.com', hd: 'newco.com' }));
    assert.equal(company.notInBeta, true);

    assert.equal(await db.collection('users').countDocuments({ email: { $in: ['solo@gmail.com', 'ceo@newco.com'] } }), 0);
    assert.equal(await db.collection('workspaces').countDocuments({}), 0);
  });

  test('an approved email creates their workspace, and colleagues on that domain join it without approval', async () => {
    await beta.approve({ email: 'ana@acme.com', approvedVia: 'script' });
    const ana = await signInWithGoogle(identity({ email: 'ana@acme.com', hd: 'acme.com' }));
    assert.equal(ana.notInBeta, undefined);
    assert.ok(ana.sessionUser.workspace_id);

    const bob = await signInWithGoogle(identity({ email: 'bob@acme.com', hd: 'acme.com' }));
    assert.equal(bob.sessionUser.workspace_id, ana.sessionUser.workspace_id);

    // Signing in again works (existing member)
    const again = await signInWithGoogle(identity({ email: 'ana@acme.com', hd: 'acme.com' }));
    assert.equal(again.sessionUser.workspace_id, ana.sessionUser.workspace_id);
  });

  test('an approved domain lets any Google Workspace account on it create the workspace, but not a same-domain consumer account', async () => {
    await beta.approve({ domain: 'Globex.io', approvedVia: 'script' });
    const consumer = await signInWithGoogle(identity({ email: 'fake@globex.io' })); // no hd claim
    assert.equal(consumer.notInBeta, true);

    const result = await signInWithGoogle(identity({ email: 'hank@globex.io', hd: 'globex.io' }));
    assert.ok(result.sessionUser.workspace_id);
  });

  test('approving twice keeps one entry', async () => {
    const first = await beta.approve({ email: 'Twice@x.com', approvedVia: 'script' });
    const second = await beta.approve({ email: 'twice@x.com', approvedVia: 'email_link' });
    assert.equal(first.alreadyApproved, false);
    assert.equal(second.alreadyApproved, true);
    assert.equal(await db.collection('beta_access').countDocuments({ email: 'twice@x.com' }), 1);
  });

  test('the welcome email is sent once, and retried after a failure', async () => {
    process.env.RESEND_API_KEY = 'test';
    try {
      const original = mailer.sendBetaWelcomeEmail;
      mailer.sendBetaWelcomeEmail = async () => { throw new Error('Resend down'); };
      const failed = await approveBetaTester({ email: 'eva@initech.com', name: 'Eva', approvedVia: 'email_link' });
      assert.equal(failed.welcome, 'failed');
      mailer.sendBetaWelcomeEmail = original;

      const retried = await approveBetaTester({ email: 'eva@initech.com', name: 'Eva', approvedVia: 'email_link' });
      assert.deepEqual(retried, { alreadyApproved: true, welcome: 'sent' });
      assert.equal(sent.at(-1).email, 'eva@initech.com');
      assert.equal(sent.at(-1).name, 'Eva');
      assert.match(sent.at(-1).login_url, /\/auth\/login$/);

      const count = sent.length;
      const repeat = await approveBetaTester({ email: 'eva@initech.com', approvedVia: 'email_link' });
      assert.equal(repeat.welcome, 'already_sent');
      assert.equal(sent.length, count);
    } finally {
      delete process.env.RESEND_API_KEY;
    }
  });

  describe('approve link', () => {
    let server;
    let base;

    before(async () => {
      console.log = () => {}; // keep node:test output clean
      console.error = () => {};
      const app = express();
      app.use(require('../../src/http/beta'));
      await new Promise(resolve => { server = app.listen(0, resolve); });
      base = `http://127.0.0.1:${server.address().port}`;
    });

    after(() => server.close());

    test('GET only shows a confirmation; POST approves', async () => {
      const token = beta.signApprovalToken({ email: 'Zoe@Umbrella.com', name: 'Zoe', company: 'Umbrella' });
      const url = `${base}/beta/approve?t=${encodeURIComponent(token)}`;

      const confirm = await fetch(url);
      assert.equal(confirm.status, 200);
      assert.match(await confirm.text(), /Approve and send welcome/);
      assert.equal(await db.collection('beta_access').findOne({ email: 'zoe@umbrella.com' }), null);

      const approved = await fetch(url, { method: 'POST' });
      assert.equal(approved.status, 200);
      assert.match(await approved.text(), /Approved/);
      const entry = await db.collection('beta_access').findOne({ email: 'zoe@umbrella.com' });
      assert.equal(entry.name, 'Zoe');
      assert.equal(entry.company, 'Umbrella');
      assert.equal(entry.approved_via, 'email_link');

      const again = await fetch(url, { method: 'POST' });
      assert.match(await again.text(), /Already approved/);

      const result = await signInWithGoogle(identity({ email: 'zoe@umbrella.com', hd: 'umbrella.com' }));
      assert.ok(result.sessionUser.workspace_id);
    });

    test('an invalid token approves nobody', async () => {
      const response = await fetch(`${base}/beta/approve?t=forged.token`, { method: 'POST' });
      assert.equal(response.status, 400);
      assert.equal(await db.collection('beta_access').countDocuments({ approved_via: 'email_link', email: /forged/ }), 0);
    });
  });
});
