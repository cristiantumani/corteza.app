const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('action items a colleague\'s meeting assigns: duplicates and "new" notices', { skip }, () => {
  let db;
  let cleanup;
  let actions;
  let assignments;
  let cristianSpace;
  let martinSpace;

  const members = [
    { workspace_id: 'WCOL', user_id: 'UC', user_name: 'Cristian Tumani', email: 'cristian@ninja.io', removed_at: null },
    { workspace_id: 'WCOL', user_id: 'UM', user_name: 'Martín Marchant', email: 'martin@ninja.io', removed_at: null }
  ];
  const martin = { user_id: 'UM', name: 'Martín Marchant' };
  const cristian = { user_id: 'UC', name: 'Cristian Tumani' };

  // Fake embeddings: the pricing deck, the weekly report and everything else point three ways
  const embed = async text => (/deck|precios|pricing/i.test(text) ? [1, 0.05, 0, 0] : /reporte/i.test(text) ? [0, 0, 0, 1] : [0, 0.1, 1, 0]);

  /** An item from Martín's capture of a meeting, owned by Cristian */
  function fromMartinsMeeting(text, meeting = 'conferenceRecords/m1') {
    return actions.createActionItem({
      workspaceId: 'WCOL', spaceId: martinSpace.space_id, text, ownerNames: ['Cristian'], capture: 'ai', author: martin,
      source: { type: 'google_meet', external_id: meeting, title: 'Weekly', occurred_at: new Date() }
    });
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    actions = require('../../src/core/actions/action-service');
    assignments = require('../../src/core/actions/colleague-assignments');
    await db.collection('workspace_members').insertMany(members);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    cristianSpace = await ensurePersonalSpace('WCOL', 'UC', 'Cristian Tumani');
    martinSpace = await ensurePersonalSpace('WCOL', 'UM', 'Martín Marchant');
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('an item the owner already finished is not shown again, and the colleague\'s copy is done too', async () => {
    const mine = await actions.createActionItem({
      workspaceId: 'WCOL', spaceId: cristianSpace.space_id, text: 'Enviar el deck de precios a Acme', ownerUserIds: ['UC'], author: cristian
    });
    await db.collection('action_items').updateOne({ item_id: mine.item_id }, { $set: { status: 'done', completed_at: new Date() } });

    // Worded differently in Martín's meeting, same task
    const copy = await fromMartinsMeeting('Cristian envía a Acme el deck con los precios');
    const totals = await assignments.reviewColleagueAssignments([copy], { embed });
    assert.deepEqual(totals, { duplicates: 1, completedEarlier: 1, newForOwners: 0 });

    const saved = await db.collection('action_items').findOne({ item_id: copy.item_id });
    assert.equal(saved.status, 'done');
    assert.equal(saved.completed_earlier, true);
    assert.deepEqual(saved.owner_duplicates, [{ user_id: 'UC', item_id: mine.item_id, status: 'done' }]);
    assert.deepEqual(saved.unseen_by, []);
    assert.equal(copy.embedding, undefined, 'the embedding is stored, not handed back');

    // Cristian sees only his own copy; Martín sees his, done
    const cristiansList = await actions.listActionItems('WCOL', { spaceIds: [cristianSpace.space_id], viewerId: 'UC', status: 'all' });
    assert.deepEqual(cristiansList.map(item => item.item_id), [mine.item_id]);
    const martinsList = await actions.listActionItems('WCOL', { spaceIds: [martinSpace.space_id], viewerId: 'UM', status: 'all' });
    assert.equal(martinsList.find(item => item.item_id === copy.item_id).status, 'done');
    assert.ok(martinsList.every(item => item.embedding === undefined && item.owner_duplicates === undefined));
  });

  test('a new item is flagged for its owner until they open Action items', async () => {
    const item = await fromMartinsMeeting('Cristian revisa el contrato con el abogado', 'conferenceRecords/m2');
    const totals = await assignments.reviewColleagueAssignments([item], { embed });
    assert.deepEqual(totals, { duplicates: 0, completedEarlier: 0, newForOwners: 1 });

    assert.deepEqual(await assignments.unseenFromColleagues('WCOL', 'UC'), { count: 1, from: [{ name: 'Martín Marchant', count: 1 }] });
    const list = await actions.listActionItems('WCOL', { spaceIds: [cristianSpace.space_id], viewerId: 'UC' });
    const shown = list.find(entry => entry.item_id === item.item_id);
    assert.equal(shown.new_from_colleague, true);
    assert.equal(shown.unseen_by, undefined, 'colleagues\' ids stay on the server');

    assert.equal(await assignments.markColleagueAssignmentsSeen('WCOL', 'UC'), 1);
    assert.deepEqual(await assignments.unseenFromColleagues('WCOL', 'UC'), { count: 0, from: [] });
    const after = await actions.listActionItems('WCOL', { spaceIds: [cristianSpace.space_id], viewerId: 'UC' });
    assert.equal(after.find(entry => entry.item_id === item.item_id).new_from_colleague, false);
  });

  test('an open item the owner already has is hidden as a duplicate, without closing it', async () => {
    const mine = await actions.createActionItem({
      workspaceId: 'WCOL', spaceId: cristianSpace.space_id, text: 'Preparar el pricing para el directorio', ownerUserIds: ['UC'], author: cristian
    });
    const copy = await fromMartinsMeeting('Cristian prepara los precios para el directorio', 'conferenceRecords/m3');
    await assignments.reviewColleagueAssignments([copy], { embed });

    const saved = await db.collection('action_items').findOne({ item_id: copy.item_id });
    assert.equal(saved.status, 'open');
    assert.equal(saved.owner_duplicates[0].item_id, mine.item_id);
    const list = await actions.listActionItems('WCOL', { spaceIds: [cristianSpace.space_id], viewerId: 'UC' });
    assert.ok(!list.some(item => item.item_id === copy.item_id));
  });

  test('items from the same capture are never duplicates of each other; without embeddings only the same text matches', async () => {
    const first = await fromMartinsMeeting('Cristian llama a Acme', 'conferenceRecords/m4');
    const second = await fromMartinsMeeting('Cristian llama a Acme', 'conferenceRecords/m4');
    await assignments.reviewColleagueAssignments([first, second], { embed: null });
    const saved = await db.collection('action_items').find({ item_id: { $in: [first.item_id, second.item_id] } }).toArray();
    assert.ok(saved.every(item => item.owner_duplicates.length === 0), 'siblings from one meeting are two items');

    const reworded = await fromMartinsMeeting('Cristian contacta a Acme por teléfono', 'conferenceRecords/m5');
    const exact = await fromMartinsMeeting('cristian llama a ACME.', 'conferenceRecords/m6');
    await assignments.reviewColleagueAssignments([reworded, exact], { embed: null });
    assert.equal((await db.collection('action_items').findOne({ item_id: reworded.item_id })).owner_duplicates.length, 0);
    assert.equal((await db.collection('action_items').findOne({ item_id: exact.item_id })).owner_duplicates.length, 1);
  });

  test('a weekly meeting\'s recurring task is new each week, not a duplicate of last week\'s', async () => {
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const previous = await actions.createActionItem({
      workspaceId: 'WCOL', spaceId: cristianSpace.space_id, text: 'Cristian envía el reporte semanal', ownerUserIds: ['UC'], author: cristian,
      source: { type: 'google_meet', external_id: 'conferenceRecords/w1', title: 'Weekly', occurred_at: lastWeek }
    });
    await db.collection('action_items').updateOne({ item_id: previous.item_id }, { $set: { status: 'done' } });
    const thisWeek = await fromMartinsMeeting('Cristian envía el reporte semanal', 'conferenceRecords/w2');
    await assignments.reviewColleagueAssignments([thisWeek], { embed });
    const saved = await db.collection('action_items').findOne({ item_id: thisWeek.item_id });
    assert.equal(saved.status, 'open');
    assert.deepEqual(saved.owner_duplicates, []);
    assert.deepEqual(saved.unseen_by, ['UC']);
  });

  test('the morning summary leaves duplicates out and says who assigned the new ones', async () => {
    await assignments.markColleagueAssignmentsSeen('WCOL', 'UC');
    const { buildDailySummary } = require('../../src/jobs/daily-digest');
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const summary = await buildDailySummary('WCOL', 'UC', since, new Date());
    const visible = await actions.listActionItems('WCOL', { spaceIds: [cristianSpace.space_id], viewerId: 'UC', status: 'all' });
    assert.equal(summary.newActionItems, visible.length, 'same items as the list: copies of ones he had are left out');
    const fromMartin = visible.filter(item => item.created_by && item.created_by.user_id === 'UM').length;
    assert.deepEqual(summary.assignedBy, [{ name: 'Martín Marchant', count: fromMartin }]);
  });
});
