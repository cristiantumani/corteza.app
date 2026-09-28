const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

describe('personal spaces', { skip }, () => {
  let db;
  let cleanup;
  let spaces;
  let actions;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    spaces = require('../../src/services/spaces');
    actions = require('../../src/core/actions/action-service');
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('ensurePersonalSpace is idempotent and makes the person its owner', async () => {
    const first = await spaces.ensurePersonalSpace('WP', 'U1', 'Ana');
    const second = await spaces.ensurePersonalSpace('WP', 'U1', 'Ana');
    assert.equal(first.space_id, second.space_id);
    assert.equal(first.visibility, 'private');
    assert.equal(await db.collection('workspace_spaces').countDocuments({ workspace_id: 'WP', personal_for: 'U1' }), 1);
    assert.equal(await db.collection('space_members').countDocuments({ space_id: first.space_id, user_id: 'U1', role: 'owner', removed_at: null }), 1);
  });

  test("an action item from a colleague's personal space reaches its owner, who can see it but not the rest", async () => {
    const anaSpace = await spaces.ensurePersonalSpace('WP', 'U1', 'Ana');
    await spaces.ensurePersonalSpace('WP', 'U2', 'Bob');
    const members = [{ user_id: 'U1', user_name: 'Ana' }, { user_id: 'U2', user_name: 'Bob' }];
    await actions.createActionItem({ workspaceId: 'WP', spaceId: anaSpace.space_id, text: 'Bob sends the deck', ownerUserIds: ['U2'], members, author: { user_id: 'U1', name: 'Ana' } });
    await actions.createActionItem({ workspaceId: 'WP', spaceId: anaSpace.space_id, text: 'Ana books the room', ownerUserIds: ['U1'], members, author: { user_id: 'U1', name: 'Ana' } });

    const { getUserAccessibleSpaces } = require('../../src/services/permissions');
    const bobSpaces = await getUserAccessibleSpaces(null, 'WP', 'U2');
    assert.ok(!bobSpaces.includes(anaSpace.space_id));
    const bobSees = await actions.listActionItems('WP', { spaceIds: bobSpaces, viewerId: 'U2', status: 'all' });
    assert.deepEqual(bobSees.map(item => item.text), ['Bob sends the deck']);
  });

  test('migration 007: a one-member workspace moves everything out of General and archives it', async () => {
    const { migrate } = require('../../scripts/migrations/007-personal-spaces');
    await db.collection('workspace_members').insertOne({ workspace_id: 'WSOLO', user_id: 'S1', user_name: 'Solo', email: 'solo@x.com', removed_at: null });
    const general = await spaces.ensureDefaultSpace('WSOLO');
    await db.collection('decisions').insertMany([
      { workspace_id: 'WSOLO', space_id: general.space_id, id: 1, text: 'mine', user_id: 'S1' },
      { workspace_id: 'WSOLO', space_id: general.space_id, id: 2, text: 'from a removed colleague', user_id: 'GONE' }
    ]);
    await db.collection('action_items').insertOne({ workspace_id: 'WSOLO', space_id: general.space_id, item_id: 'a1', decision_id: 1, text: 'x', owner_ids: [] });
    await db.collection('google_connections').insertOne({ workspace_id: 'WSOLO', user_id: 'S1', settings: { space_id: general.space_id } });

    const [dry] = await migrate({ apply: false, workspaceId: 'WSOLO' });
    assert.deepEqual({ created: dry.personalSpacesCreated, moved: dry.moved, archived: dry.generalArchived }, { created: 1, moved: 2, archived: true });
    assert.equal(await db.collection('workspace_spaces').countDocuments({ workspace_id: 'WSOLO', personal_for: 'S1' }), 0, 'dry run changes nothing');

    await migrate({ apply: true, workspaceId: 'WSOLO' });
    const personal = await db.collection('workspace_spaces').findOne({ workspace_id: 'WSOLO', personal_for: 'S1' });
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: 'WSOLO', space_id: personal.space_id }), 2);
    assert.equal((await db.collection('action_items').findOne({ item_id: 'a1' })).space_id, personal.space_id);
    assert.equal((await db.collection('workspace_spaces').findOne({ space_id: general.space_id })).archived, true);
    assert.equal((await db.collection('google_connections').findOne({ workspace_id: 'WSOLO' })).settings.space_id, null);

    const [again] = await migrate({ apply: true, workspaceId: 'WSOLO' });
    assert.equal(again.moved, 0, 'idempotent');
  });

  test('migration 007: with several members, each outcome goes to the person who captured it', async () => {
    const { migrate } = require('../../scripts/migrations/007-personal-spaces');
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WTEAM', user_id: 'T1', user_name: 'Ana', email: 'ana@t.com', removed_at: null },
      { workspace_id: 'WTEAM', user_id: 'T2', user_name: 'Bob', email: 'bob@t.com', removed_at: null }
    ]);
    const general = await spaces.ensureDefaultSpace('WTEAM');
    await db.collection('decisions').insertMany([
      { workspace_id: 'WTEAM', space_id: general.space_id, id: 1, text: 'Ana', user_id: 'T1' },
      { workspace_id: 'WTEAM', space_id: general.space_id, id: 2, text: 'Bob', user_id: 'T2' },
      { workspace_id: 'WTEAM', space_id: general.space_id, id: 3, text: 'Slack', user_id: 'USLACK' }
    ]);

    await migrate({ apply: true, workspaceId: 'WTEAM' });
    const spaceOf = async id => (await db.collection('decisions').findOne({ workspace_id: 'WTEAM', id })).space_id;
    const ana = await db.collection('workspace_spaces').findOne({ workspace_id: 'WTEAM', personal_for: 'T1' });
    const bob = await db.collection('workspace_spaces').findOne({ workspace_id: 'WTEAM', personal_for: 'T2' });
    assert.equal(await spaceOf(1), ana.space_id);
    assert.equal(await spaceOf(2), bob.space_id);
    assert.equal(await spaceOf(3), general.space_id, 'outcomes with no member author stay in General');
    assert.equal((await db.collection('workspace_spaces').findOne({ space_id: general.space_id })).archived, false);
  });

  test('keep-only script removes everyone else, their access and connections, and keeps outcomes unless asked', async () => {
    const { keepOnlyMember } = require('../../scripts/workspace-keep-only');
    const wid = 'WKEEP';
    await db.collection('workspace_members').insertMany([
      { workspace_id: wid, user_id: 'K1', user_name: 'Cristian', email: 'me@ninja.com', role: 'member', removed_at: null },
      { workspace_id: wid, user_id: 'K2', user_name: 'Colleague', email: 'colleague@ninja.com', role: 'admin', removed_at: null },
      { workspace_id: wid, user_id: 'K3', user_name: 'Me personal', email: 'me@gmail.com', role: 'member', removed_at: null }
    ]);
    await db.collection('workspace_admins').insertOne({ workspace_id: wid, user_id: 'K2', role: 'admin', deactivated_at: null });
    await db.collection('google_connections').insertOne({ workspace_id: wid, user_id: 'K2', status: 'active' });
    await db.collection('users').insertMany([{ user_id: 'uK2', email: 'colleague@ninja.com' }, { user_id: 'uK1', email: 'me@ninja.com' }]);
    await db.collection('sessions').insertOne({ _id: 's1', session: JSON.stringify({ user: { user_id: 'K2', workspace_id: wid } }) });
    await db.collection('workspace_invites').insertOne({ workspace_id: wid, invite_id: 'inv1', status: 'active' });
    await db.collection('decisions').insertOne({ workspace_id: wid, space_id: 'sp_x', id: 1, text: 'theirs', user_id: 'K2' });

    const dry = await keepOnlyMember({ email: 'ME@ninja.com', apply: false });
    assert.deepEqual(dry.remove.map(m => m.email).sort(), ['colleague@ninja.com', 'me@gmail.com']);
    assert.equal(dry.connections, 1);
    assert.equal(await db.collection('workspace_members').countDocuments({ workspace_id: wid }), 3, 'dry run changes nothing');

    await keepOnlyMember({ email: 'me@ninja.com', apply: true });
    assert.deepEqual((await db.collection('workspace_members').find({ workspace_id: wid }).toArray()).map(m => m.email), ['me@ninja.com']);
    assert.equal(await db.collection('workspace_admins').countDocuments({ workspace_id: wid, user_id: 'K2' }), 0);
    const { isAdmin } = require('../../src/services/permissions');
    assert.equal(await isAdmin(null, wid, 'K1'), true, 'the person kept is admin');
    assert.equal(await db.collection('google_connections').countDocuments({ workspace_id: wid }), 0, 'their meetings stop being captured');
    assert.equal(await db.collection('sessions').countDocuments({ _id: 's1' }), 0, 'they are signed out');
    assert.equal(await db.collection('users').countDocuments({ email: 'colleague@ninja.com' }), 0);
    assert.equal(await db.collection('users').countDocuments({ email: 'me@ninja.com' }), 1);
    assert.equal((await db.collection('workspace_invites').findOne({ invite_id: 'inv1' })).status, 'revoked');
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: wid, user_id: 'K2' }), 1, 'outcomes kept by default');
  });

  test('merge-into-personal moves every other space the person sees into their personal space and archives it', async () => {
    const { mergeIntoPersonal } = require('../../scripts/merge-into-personal');
    const wid = 'WMERGE';
    await db.collection('workspace_members').insertOne({ workspace_id: wid, user_id: 'M1', user_name: 'Cris', email: 'cris@x.com', removed_at: null });
    await db.collection('workspace_admins').insertOne({ workspace_id: wid, user_id: 'M1', role: 'admin', deactivated_at: null });
    await db.collection('workspace_spaces').insertMany([
      { workspace_id: wid, space_id: 'sp_ceo', name: 'CEO Space', visibility: 'private', archived: false },
      { workspace_id: wid, space_id: 'sp_growth', name: 'Product Growth', visibility: 'public', archived: false },
      { workspace_id: wid, space_id: 'sp_colleague', name: 'My space', personal_for: 'OTHER', visibility: 'private', archived: false }
    ]);
    await db.collection('decisions').insertMany([
      { workspace_id: wid, space_id: 'sp_ceo', id: 1, text: 'a' },
      { workspace_id: wid, space_id: 'sp_growth', id: 2, text: 'b' },
      { workspace_id: wid, space_id: 'sp_colleague', id: 3, text: 'not mine' }
    ]);
    await db.collection('action_items').insertOne({ workspace_id: wid, space_id: 'sp_growth', item_id: 'm1', text: 'x', owner_ids: [] });

    const dry = await mergeIntoPersonal({ email: 'CRIS@x.com', apply: false });
    assert.deepEqual(dry.spaces.map(s => [s.name, s.outcomes]).sort(), [['CEO Space', 1], ['Product Growth', 1]]);
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: wid, space_id: 'sp_ceo' }), 1, 'dry run changes nothing');

    await mergeIntoPersonal({ email: 'cris@x.com', apply: true });
    const personal = await db.collection('workspace_spaces').findOne({ workspace_id: wid, personal_for: 'M1' });
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: wid, space_id: personal.space_id }), 2);
    assert.equal((await db.collection('action_items').findOne({ item_id: 'm1' })).space_id, personal.space_id);
    assert.equal(await db.collection('workspace_spaces').countDocuments({ workspace_id: wid, space_id: { $in: ['sp_ceo', 'sp_growth'] }, archived: true }), 2);
    assert.equal((await db.collection('decisions').findOne({ workspace_id: wid, id: 3 })).space_id, 'sp_colleague', "a colleague's personal space is never touched");

    const { listSpacesForUser } = require('../../src/core/spaces/list-spaces');
    const left = await listSpacesForUser({ workspaceId: wid, userId: 'M1', userName: 'Cris', isAdminUser: true });
    assert.deepEqual(left.map(s => s.space_id), [personal.space_id], 'one space left, so the app hides the space controls');
  });
});
