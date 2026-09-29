const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const LONG_TEXT = Array(80).fill('We agreed to move the launch to Friday').join('. ');

function fakeExtract(decisions) {
  return async () => ({ decisions, model: 'fake' });
}

describe('colleagues in the same meeting each capture it', { skip }, () => {
  let db;
  let cleanup;
  let pipeline;
  let actions;
  let spaces;
  const WS = 'WSHARED';
  const MEETING = 'conferenceRecords/shared';

  /** The same meeting, as seen by one person's Google Meet connection */
  async function transcriptFor(userId, name) {
    const space = await spaces.ensurePersonalSpace(WS, userId, name);
    return {
      workspaceId: WS, source: 'google_meet', externalId: MEETING, title: 'Launch sync',
      text: LONG_TEXT, occurredAt: new Date().toISOString(),
      spaceId: space.space_id, spaceName: space.name, author: { user_id: userId, name }
    };
  }

  const extracted = [
    { decision_text: 'Move launch to Friday', decision_type: 'decision', tags: ['launch'], confidence: 0.9 },
    { decision_text: 'Bob sends the checklist', decision_type: 'action_item', confidence: 0.9, owner_names: ['Bob'], due_date: null, decision_ref: 0 }
  ];

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    pipeline = require('../../src/ingestion/pipeline');
    actions = require('../../src/core/actions/action-service');
    spaces = require('../../src/services/spaces');
    await db.collection('workspace_members').insertMany([
      { workspace_id: WS, user_id: 'UA', user_name: 'Ana Ruiz', email: 'ana@acme.com', removed_at: null },
      { workspace_id: WS, user_id: 'UB', user_name: 'Bob Chen', email: 'bob@acme.com', removed_at: null }
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test("the second person isn't blocked by the first: each gets the outcomes in their own space", async () => {
    const noDueDates = async () => {};
    const ana = await pipeline.ingestTranscript(await transcriptFor('UA', 'Ana'), { extract: fakeExtract(extracted), requestDueDates: noDueDates });
    assert.equal(ana.status, 'completed');

    // Bob's poller hasn't handled it yet, even though Ana's has
    assert.equal(await pipeline.isHandled(WS, 'UA', 'google_meet', MEETING), true);
    assert.equal(await pipeline.isHandled(WS, 'UB', 'google_meet', MEETING), false);

    const bob = await pipeline.ingestTranscript(await transcriptFor('UB', 'Bob'), { extract: fakeExtract(extracted), requestDueDates: noDueDates });
    assert.equal(bob.status, 'completed');

    const again = await pipeline.ingestTranscript(await transcriptFor('UB', 'Bob'), { extract: fakeExtract(extracted), requestDueDates: noDueDates });
    assert.equal(again.status, 'duplicate', 'still once per person');

    const anaSpace = await spaces.ensurePersonalSpace(WS, 'UA', 'Ana');
    const bobSpace = await spaces.ensurePersonalSpace(WS, 'UB', 'Bob');
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: WS, space_id: anaSpace.space_id }), 1);
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: WS, space_id: bobSpace.space_id }), 1);

    const statuses = await pipeline.getStatuses(WS, 'UB', 'google_meet', [MEETING]);
    assert.equal(statuses.get(MEETING).status, 'completed');
  });

  test("the owner sees their own copy of an action item, not the colleague's too", async () => {
    const { getUserAccessibleSpaces } = require('../../src/services/permissions');
    const bobSpaces = await getUserAccessibleSpaces(null, WS, 'UB');
    const bobSees = await actions.listActionItems(WS, { spaceIds: bobSpaces, viewerId: 'UB', status: 'all' });
    assert.equal(bobSees.length, 1);
    assert.ok(bobSpaces.includes(bobSees[0].space_id), "Bob's own capture");

    // Marking his copy done doesn't bring Ana's copy back into his open list
    await actions.updateActionItem(WS, bobSees[0].item_id, { status: 'done' });
    assert.equal((await actions.listActionItems(WS, { spaceIds: bobSpaces, viewerId: 'UB', status: 'open' })).length, 0);

    // Ana, who captured it too, sees her copy (owned by Bob)
    const anaSpaces = await getUserAccessibleSpaces(null, WS, 'UA');
    const anaSees = await actions.listActionItems(WS, { spaceIds: anaSpaces, viewerId: 'UA', status: 'all' });
    assert.equal(anaSees.length, 1);
    assert.deepEqual(anaSees[0].owner_ids, ['UB']);
  });

  test("an owner who didn't capture the meeting still sees the colleague's item", async () => {
    await db.collection('workspace_members').insertOne({ workspace_id: WS, user_id: 'UC', user_name: 'Carla Soto', email: 'carla@acme.com', removed_at: null });
    const anaSpace = await spaces.ensurePersonalSpace(WS, 'UA', 'Ana');
    await actions.createActionItem({
      workspaceId: WS, spaceId: anaSpace.space_id, text: 'Carla books the venue', ownerUserIds: ['UC'],
      source: { type: 'google_meet', external_id: 'conferenceRecords/other' }, author: { user_id: 'UA', name: 'Ana' }
    });
    const carlaSees = await actions.listActionItems(WS, { spaceIds: [], viewerId: 'UC', status: 'open' });
    assert.deepEqual(carlaSees.map(item => item.text), ['Carla books the venue']);
  });

  test("due dates: a colleague with Google Meet connected is asked by their own capture, not by others'", async () => {
    const dueDates = require('../../src/core/actions/due-date-requests');
    await db.collection('google_connections').insertOne({ workspace_id: WS, user_id: 'UB', status: 'active' });
    const item = owner => ({ item_id: `i_${owner.user_id}`, status: 'open', due_date: null, owners: [owner], owner_ids: [owner.user_id] });
    const bobItem = item({ name: 'Bob', user_id: 'UB', email: 'bob@acme.com' });
    const carlaItem = item({ name: 'Carla', user_id: 'UC', email: 'carla@acme.com' });
    const sent = [];
    const send = async params => { sent.push(params.email); };

    const fromAna = { workspaceId: WS, title: 'Launch sync', occurredAt: new Date().toISOString(), author: { user_id: 'UA', name: 'Ana' } };
    await dueDates.requestMissingDueDates([bobItem, carlaItem], fromAna, { send });
    assert.deepEqual(sent, ['carla@acme.com'], 'Bob is asked by his own capture; Carla has no connection');

    const fromBob = { ...fromAna, author: { user_id: 'UB', name: 'Bob' } };
    await dueDates.requestMissingDueDates([item({ name: 'Bob', user_id: 'UB', email: 'bob@acme.com' })], fromBob, { send });
    assert.deepEqual(sent, ['carla@acme.com', 'bob@acme.com']);
  });
});
