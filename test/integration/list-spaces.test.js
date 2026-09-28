const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.error = () => {};

describe('listSpacesForUser', { skip }, () => {
  let db;
  let cleanup;
  let listSpacesForUser;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    ({ listSpacesForUser } = require('../../src/core/spaces/list-spaces'));

    await db.collection('workspace_spaces').insertMany([
      { workspace_id: 'WSP', space_id: 'sp_pub', name: 'Product', visibility: 'public', archived: false, created_by: 'U2', created_at: new Date('2026-01-02') },
      { workspace_id: 'WSP', space_id: 'sp_priv', name: 'Board', visibility: 'private', archived: false, created_by: 'U2', created_at: new Date('2026-01-03') },
      { workspace_id: 'WSP', space_id: 'sp_old', name: 'Old', visibility: 'public', archived: true, created_by: 'U2', created_at: new Date('2026-01-04') }
    ]);
    await db.collection('space_members').insertOne({ workspace_id: 'WSP', space_id: 'sp_priv', user_id: 'U3', role: 'admin', removed_at: null });
    await db.collection('decisions').insertMany([
      { workspace_id: 'WSP', space_id: 'sp_pub', id: 1, text: 'a' },
      { workspace_id: 'WSP', space_id: 'sp_pub', id: 2, text: 'b' },
      { workspace_id: 'WSP', space_id: 'sp_priv', id: 3, text: 'c' },
      { workspace_id: 'WOTHER', space_id: 'sp_pub', id: 1, text: 'other workspace' }
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('members see public spaces and the private ones they belong to, with counts and roles', async () => {
    const outsider = await listSpacesForUser({ workspaceId: 'WSP', userId: 'U1', userName: 'Ana', isAdminUser: false });
    const names = outsider.map(space => space.name);
    assert.ok(names.includes('General'), 'default space is created');
    assert.ok(names.includes('Product'));
    assert.ok(!names.includes('Board'), 'private space hidden from non-members');
    assert.ok(!names.includes('Old'), 'archived spaces hidden');
    const product = outsider.find(space => space.space_id === 'sp_pub');
    assert.equal(product.decision_count, 2, 'counts only this workspace');
    assert.equal(product.user_role, 'member');
    assert.equal(product.can_create, true);
    assert.equal(product.can_modify, false);

    const member = await listSpacesForUser({ workspaceId: 'WSP', userId: 'U3', userName: 'Carla', isAdminUser: false });
    const board = member.find(space => space.space_id === 'sp_priv');
    assert.equal(board.user_role, 'admin');
    assert.equal(board.decision_count, 1);
    assert.equal(board.can_modify, true);
  });

  test('workspace admins see every space, default first', async () => {
    const spaces = await listSpacesForUser({ workspaceId: 'WSP', userId: 'U9', userName: 'Admin', isAdminUser: true });
    assert.equal(spaces[0].is_default, true);
    assert.ok(spaces.some(space => space.space_id === 'sp_priv'));
    assert.equal(spaces.find(space => space.space_id === 'sp_priv').can_create, false, 'admins manage private spaces they are not members of, but cannot post');
    assert.ok(spaces.every(space => space.can_modify));
  });
});
