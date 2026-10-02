const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('meeting prep: today\'s meetings with the open items of the people in them', { skip }, () => {
  let cleanup;
  let prep;
  let actions;
  let mySpace;
  let juanSpace;
  const NOW = new Date('2026-10-02T11:00:00Z'); // 8:00 in Santiago
  const CALENDAR = 'https://www.googleapis.com/auth/calendar.events.readonly';

  const connection = scopes => ({ workspace_id: 'WPREP', user_id: 'UC', status: 'active', google_email: 'cristian@ninja.io', scopes });
  const events = [{
    id: 'e1', title: 'Weekly Comercial', start: '2026-10-02T14:00:00Z',
    attendees: [{ email: 'cristian@ninja.io', name: 'Cristian', self: true }, { email: 'juan@ninja.io', name: 'Juan', self: false }]
  }];
  let asked = null;
  const deps = scopes => ({
    getConnection: async () => connection(scopes),
    getClient: () => ({}),
    listEvents: async (client, range) => { asked = range; return events; }
  });

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    const db = require('../../src/config/database').getDatabase();
    prep = require('../../src/core/briefs/meeting-prep');
    actions = require('../../src/core/actions/action-service');
    await db.collection('workspace_members').insertMany([
      { workspace_id: 'WPREP', user_id: 'UC', user_name: 'Cristian Tumani', email: 'cristian@ninja.io', removed_at: null },
      { workspace_id: 'WPREP', user_id: 'UJ', user_name: 'Juan Pérez', email: 'juan@ninja.io', removed_at: null }
    ]);
    const { ensurePersonalSpace } = require('../../src/services/spaces');
    mySpace = await ensurePersonalSpace('WPREP', 'UC', 'Cristian Tumani');
    juanSpace = await ensurePersonalSpace('WPREP', 'UJ', 'Juan Pérez');

    const add = (spaceId, text, ownerUserIds, author) => actions.createActionItem({ workspaceId: 'WPREP', spaceId, text, ownerUserIds, author });
    await add(mySpace.space_id, 'Send Juan the pricing deck', ['UC', 'UJ'], { user_id: 'UC', name: 'Cristian' });
    await add(mySpace.space_id, 'Juan reviews the contract', ['UJ'], { user_id: 'UC', name: 'Cristian' });
    await add(mySpace.space_id, 'Book the offsite', ['UC'], { user_id: 'UC', name: 'Cristian' });
    // In Juan's private space: Cristian can't see it, so it never reaches his summary
    await add(juanSpace.space_id, 'Juan private follow-up', ['UJ'], { user_id: 'UJ', name: 'Juan' });
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('lists the items with the people in each meeting, only ones the person can see', async () => {
    const result = await prep.getMeetingPrep('WPREP', 'UC', { now: NOW, timeZone: 'America/Santiago', deps: deps([CALENDAR]) });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].people, ['Juan Pérez']);
    assert.deepEqual(result[0].items.map(item => [item.text, item.owner]).sort(), [
      ['Juan reviews the contract', 'Juan Pérez'],
      ['Send Juan the pricing deck', null]
    ]);
    assert.equal(asked.from.toISOString(), NOW.toISOString(), 'from now…');
    assert.equal(asked.to.toISOString(), '2026-10-03T03:00:00.000Z', '…to the end of the local day');
  });

  test('without calendar access there is no prep, and Google is not called', async () => {
    asked = null;
    assert.deepEqual(await prep.getMeetingPrep('WPREP', 'UC', { now: NOW, timeZone: 'America/Santiago', deps: deps(['https://www.googleapis.com/auth/meetings.space.readonly']) }), []);
    assert.equal(asked, null);
  });

  test('a calendar error leaves the summary without prep instead of failing it', async () => {
    const failing = { ...deps([CALENDAR]), listEvents: async () => { throw Object.assign(new Error('403'), { response: { status: 403 } }); } };
    assert.deepEqual(await prep.getMeetingPrep('WPREP', 'UC', { now: NOW, deps: failing }), []);
  });

  test('the morning summary carries the prep with local times, and it counts as news', async () => {
    const digest = require('../../src/jobs/daily-digest');
    const summary = await digest.buildDailySummary('WPREP', 'UC', new Date(NOW.getTime() - 3600 * 1000), NOW, 'America/Santiago', {
      meetingPrep: (workspaceId, userId, options) => prep.getMeetingPrep(workspaceId, userId, { ...options, deps: deps([CALENDAR]) })
    });
    assert.equal(summary.meetingPrep.length, 1);
    assert.equal(summary.meetingPrep[0].time, '11:00 AM');
    assert.ok(digest.hasNews({ meetings: 0, newActionItems: 0, dueToday: 0, meetingPrep: summary.meetingPrep }));
  });
});
