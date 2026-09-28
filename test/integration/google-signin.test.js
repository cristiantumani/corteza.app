const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

/** Minimal verified Google ID token claims */
function identity(overrides = {}) {
  return { sub: `sub-${Math.random()}`, email_verified: true, name: 'Test User', ...overrides };
}

describe('Google sign-in: workspace resolution', { skip }, () => {
  let db;
  let cleanup;
  let signInWithGoogle;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    ({ signInWithGoogle } = require('../../src/auth/google-signin'));
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('rejects unverified emails', async () => {
    const result = await signInWithGoogle(identity({ email: 'x@acme.com', hd: 'acme.com', email_verified: false }));
    assert.match(result.error, /not verified/);
  });

  test('first user of a new Google domain creates the workspace as admin, with their own private space', async () => {
    const result = await signInWithGoogle(identity({ sub: 'ana', email: 'Ana@Acme.com', name: 'Ana', hd: 'acme.com' }));

    assert.equal(result.error, undefined);
    assert.equal(result.needsOnboarding, true);
    const { workspace_id: workspaceId, email } = result.sessionUser;
    assert.equal(email, 'ana@acme.com');

    const workspace = await db.collection('workspaces').findOne({ workspace_id: workspaceId });
    assert.equal(workspace.google_domain, 'acme.com');
    const member = await db.collection('workspace_members').findOne({ workspace_id: workspaceId, email: 'ana@acme.com' });
    assert.equal(member.role, 'admin');
    assert.ok(await db.collection('workspace_admins').findOne({ workspace_id: workspaceId, user_id: member.user_id }));
    const personal = await db.collection('workspace_spaces').findOne({ workspace_id: workspaceId, personal_for: member.user_id });
    assert.equal(personal.visibility, 'private');
    assert.ok(await db.collection('space_members').findOne({ space_id: personal.space_id, user_id: member.user_id, role: 'owner', removed_at: null }));
    assert.equal(await db.collection('workspace_spaces').findOne({ workspace_id: workspaceId, is_default: true }), null, 'no shared General space');

    // The dashboard (/auth/me) and admin-only endpoints must see them as admin without Slack
    const { isAdmin } = require('../../src/services/permissions');
    assert.equal(await isAdmin(null, workspaceId, member.user_id), true);
  });

  test('a colleague on the same domain joins that workspace as a member', async () => {
    const acme = await db.collection('workspaces').findOne({ google_domain: 'acme.com' });
    const result = await signInWithGoogle(identity({ sub: 'bob', email: 'bob@acme.com', name: 'Bob', hd: 'acme.com' }));

    assert.equal(result.sessionUser.workspace_id, acme.workspace_id);
    assert.equal(result.needsOnboarding, false);
    const member = await db.collection('workspace_members').findOne({ email: 'bob@acme.com' });
    assert.equal(member.role, 'member');
    assert.equal(await db.collection('workspace_admins').findOne({ user_id: member.user_id }), null);
    const { isAdmin, canAccessSpace } = require('../../src/services/permissions');
    assert.equal(await isAdmin(null, acme.workspace_id, member.user_id), false);

    // Colleagues are separated: Bob gets his own space and can't see Ana's
    const ana = await db.collection('workspace_members').findOne({ email: 'ana@acme.com' });
    const bobSpace = await db.collection('workspace_spaces').findOne({ workspace_id: acme.workspace_id, personal_for: member.user_id });
    const anaSpace = await db.collection('workspace_spaces').findOne({ workspace_id: acme.workspace_id, personal_for: ana.user_id });
    assert.ok(bobSpace);
    assert.notEqual(bobSpace.space_id, anaSpace.space_id);
    assert.equal(await canAccessSpace(null, acme.workspace_id, anaSpace.space_id, member.user_id), false);
    assert.equal(await canAccessSpace(null, acme.workspace_id, bobSpace.space_id, ana.user_id), false);
  });

  test('signing in again returns the same workspace and user_id', async () => {
    const first = await db.collection('workspace_members').findOne({ email: 'bob@acme.com' });
    const result = await signInWithGoogle(identity({ sub: 'bob', email: 'bob@acme.com', name: 'Bob', hd: 'acme.com' }));
    assert.equal(result.sessionUser.user_id, first.user_id);
    assert.equal(await db.collection('workspace_members').countDocuments({ email: 'bob@acme.com' }), 1);
  });

  test('an account with an @acme.com email but no hd claim does NOT join the acme workspace', async () => {
    const acme = await db.collection('workspaces').findOne({ google_domain: 'acme.com' });
    const result = await signInWithGoogle(identity({ sub: 'fake', email: 'fake@acme.com', name: 'Fake' }));
    assert.notEqual(result.sessionUser.workspace_id, acme.workspace_id);
  });

  test('a consumer account gets a personal workspace', async () => {
    const result = await signInWithGoogle(identity({ sub: 'carla', email: 'carla@gmail.com', name: 'Carla' }));
    const workspace = await db.collection('workspaces').findOne({ workspace_id: result.sessionUser.workspace_id });
    assert.equal(workspace.google_domain, null);
    assert.equal(workspace.name, "Carla's workspace");
  });

  test('two first users of a new domain at the same time end up in one workspace', async () => {
    const results = await Promise.all([
      signInWithGoogle(identity({ sub: 'r1', email: 'r1@race.io', hd: 'race.io' })),
      signInWithGoogle(identity({ sub: 'r2', email: 'r2@race.io', hd: 'race.io' }))
    ]);
    assert.equal(results[0].sessionUser.workspace_id, results[1].sessionUser.workspace_id);
    assert.equal(await db.collection('workspaces').countDocuments({ google_domain: 'race.io' }), 1);
  });

  test('an existing (legacy) membership is linked by email and its admin claims the domain', async () => {
    await db.collection('workspace_members').insertOne({
      membership_id: 'mem_legacy', workspace_id: 'T0LEGACY', workspace_name: 'Ninja', user_id: 'U_LEGACY',
      // role overwritten by the old onboarding bug; workspace_admins is what counts
      user_name: 'Cris', email: 'cris@ninja.io', role: 'product-manager', removed_at: null, onboarding_completed: true
    });
    await db.collection('workspace_admins').insertOne({
      workspace_id: 'T0LEGACY', user_id: 'U_LEGACY', role: 'admin', deactivated_at: null
    });
    await db.collection('decisions').insertOne({ workspace_id: 'T0LEGACY', id: 1, user_id: 'U_LEGACY', text: 'Old decision' });

    const result = await signInWithGoogle(identity({ sub: 'cris', email: 'cris@ninja.io', name: 'Cris', hd: 'ninja.io' }));

    assert.equal(result.sessionUser.workspace_id, 'T0LEGACY');
    assert.equal(result.sessionUser.user_id, 'U_LEGACY', 'keeps the legacy user_id so old decisions stay theirs');
    const workspace = await db.collection('workspaces').findOne({ workspace_id: 'T0LEGACY' });
    assert.equal(workspace.google_domain, 'ninja.io');
    assert.equal(workspace.slack_team_id, 'T0LEGACY');

    // A colleague now joins the legacy workspace automatically
    const colleague = await signInWithGoogle(identity({ sub: 'dana', email: 'dana@ninja.io', hd: 'ninja.io' }));
    assert.equal(colleague.sessionUser.workspace_id, 'T0LEGACY');
  });

  test('invite link joins the invite workspace with the invite role and space', async () => {
    await db.collection('workspace_invites').insertOne({
      invite_id: 'inv_ok', workspace_id: 'T0LEGACY', workspace_name: 'Ninja', role: 'member',
      space_id: 'sp_eng', space_role: 'member', status: 'active', uses_count: 0, max_uses: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(), invited_by: 'U_LEGACY', invited_by_name: 'Cris'
    });

    const result = await signInWithGoogle(identity({ sub: 'eve', email: 'eve@gmail.com', name: 'Eve' }), { inviteId: 'inv_ok' });

    assert.equal(result.sessionUser.workspace_id, 'T0LEGACY');
    const member = await db.collection('workspace_members').findOne({ workspace_id: 'T0LEGACY', email: 'eve@gmail.com' });
    assert.equal(member.role, 'member');
    assert.ok(await db.collection('space_members').findOne({ space_id: 'sp_eng', user_id: member.user_id }));
    assert.equal((await db.collection('workspace_invites').findOne({ invite_id: 'inv_ok' })).uses_count, 1);
  });

  test('invites addressed to an email reject other accounts; expired invites are refused', async () => {
    await db.collection('workspace_invites').insertMany([
      {
        invite_id: 'inv_for_frank', workspace_id: 'T0LEGACY', workspace_name: 'Ninja', role: 'member',
        email: 'frank@ninja.io', status: 'active', uses_count: 0, expires_at: new Date(Date.now() + 86400000).toISOString()
      },
      {
        invite_id: 'inv_expired', workspace_id: 'T0LEGACY', workspace_name: 'Ninja', role: 'admin',
        status: 'active', uses_count: 0, expires_at: new Date(Date.now() - 1000).toISOString()
      }
    ]);

    const wrongAccount = await signInWithGoogle(identity({ sub: 'mallory', email: 'mallory@gmail.com' }), { inviteId: 'inv_for_frank' });
    assert.match(wrongAccount.error, /frank@ninja.io/);

    const expired = await signInWithGoogle(identity({ sub: 'gus', email: 'gus@gmail.com' }), { inviteId: 'inv_expired' });
    assert.match(expired.error, /expired/);
    assert.equal(await db.collection('workspace_members').findOne({ email: 'gus@gmail.com', workspace_id: 'T0LEGACY' }), null);
  });
});
