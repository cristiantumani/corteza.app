const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('meeting prep: today\'s meetings with what is open from their own history', { skip }, () => {
  let cleanup;
  let prep;
  let actions;
  let mySpace;
  let juanSpace;
  const NOW = new Date('2026-10-02T11:00:00Z'); // 8:00 in Santiago
  const CALENDAR = 'https://www.googleapis.com/auth/calendar.events.readonly';

  const connection = scopes => ({ workspace_id: 'WPREP', user_id: 'UC', status: 'active', google_email: 'cristian@ninja.io', scopes });
  const me = { email: 'cristian@ninja.io', name: 'Cristian', self: true };
  const juan = { email: 'juan@ninja.io', name: 'Juan', self: false };
  const events = [
    { id: 'e1', title: 'Weekly Comercial', start: '2026-10-02T14:00:00Z', meeting_code: 'abc-defg-hij', attendees: [me, juan] },
    { id: 'e2', title: 'Directorio', start: '2026-10-02T20:00:00Z', meeting_code: null, attendees: [me, juan, { email: 'ana@cliente.com', name: 'Ana', self: false }] }
  ];
  const WEEKLY = { type: 'google_meet', external_id: 'conferenceRecords/w1', title: 'Weekly Comercial', occurred_at: '2026-09-25T14:00:00Z' };
  const ONE_ON_ONE = { type: 'google_meet', external_id: 'conferenceRecords/o9', title: 'Cristian / Juan', occurred_at: '2026-09-30T14:00:00Z' };
  let asked = null;
  let askedCodes = [];
  const deps = (scopes, overrides = {}) => ({
    getConnection: async () => connection(scopes),
    getClient: () => ({}),
    listEvents: async (client, range) => { asked = range; return events; },
    listRecords: async (client, code) => { askedCodes.push(code); return [{ name: 'conferenceRecords/w1', startTime: '2026-09-25T14:00:00Z' }]; },
    ...overrides
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

    const add = (spaceId, text, ownerUserIds, author, source) => actions.createActionItem({ workspaceId: 'WPREP', spaceId, text, ownerUserIds, author, source });
    await add(mySpace.space_id, 'Send Juan the pricing deck', ['UC', 'UJ'], { user_id: 'UC', name: 'Cristian' }, WEEKLY);
    await add(mySpace.space_id, 'Juan reviews the contract', ['UJ'], { user_id: 'UC', name: 'Cristian' }, WEEKLY);
    // From the 1:1: Juan is in both of today's meetings, but it belongs to neither
    await add(mySpace.space_id, 'Find cheaper tools than Asana', ['UJ'], { user_id: 'UC', name: 'Cristian' }, ONE_ON_ONE);
    // In Juan's private space: Cristian can't see it, so it never reaches his summary
    await add(juanSpace.space_id, 'Juan private follow-up', ['UJ'], { user_id: 'UJ', name: 'Juan' }, WEEKLY);
    await require('../../src/config/database').getDecisionsCollection().insertOne({
      id: 9101, workspace_id: 'WPREP', space_id: mySpace.space_id, type: 'open_question', text: 'Do we give a launch discount?',
      resolution_status: 'open', source_details: WEEKLY, timestamp: '2026-09-25T14:30:00Z'
    });
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('each meeting gets what came out of its own earlier sessions, only what the person can see', async () => {
    askedCodes = [];
    const result = await prep.getMeetingPrep('WPREP', 'UC', { now: NOW, timeZone: 'America/Santiago', deps: deps([CALENDAR]) });
    assert.equal(result.length, 2);
    const [weekly, board] = result;
    assert.equal(weekly.kind, 'series');
    assert.equal(weekly.last_met, '2026-09-25T14:00:00.000Z');
    assert.deepEqual(weekly.items.map(item => [item.text, item.mine, item.owner]).sort(), [
      ['Juan reviews the contract', false, 'Juan Pérez'],
      ['Send Juan the pricing deck', true, null]
    ]);
    assert.deepEqual(weekly.questions.map(q => q.text), ['Do we give a launch discount?']);
    assert.equal(board.kind, 'new');
    assert.deepEqual(board.items, [], 'the 1:1 item doesn’t follow Juan into other meetings');
    assert.deepEqual(askedCodes, ['abc-defg-hij'], 'Meet is asked once per meeting with a Meet link');
    assert.equal(asked.from.toISOString(), NOW.toISOString(), 'from now…');
    assert.equal(asked.to.toISOString(), '2026-10-03T03:00:00.000Z', '…to the end of the local day');
  });

  test('when Meet can’t tell the history, the title still connects the meeting', async () => {
    const failingMeet = deps([CALENDAR], { listRecords: async () => { throw Object.assign(new Error('403'), { response: { status: 403 } }); } });
    const [weekly] = await prep.getMeetingPrep('WPREP', 'UC', { now: NOW, timeZone: 'America/Santiago', deps: failingMeet });
    assert.equal(weekly.items.length, 2);
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

  test('Home: the Google part is cached for 10 minutes, Corteza’s own data is read every time', async () => {
    prep.clearMeetingPrepCache();
    let calls = 0;
    const counting = deps([CALENDAR], { listEvents: async () => { calls++; return events; } });
    const first = await prep.getMeetingPrep('WPREP', 'UC', { now: NOW, timeZone: 'America/Santiago', cache: true, deps: counting });
    assert.equal(first[0].items.length, 2);

    // An item ticked off on Home doesn't come back from the cache
    const db = require('../../src/config/database').getDatabase();
    const open = await db.collection('action_items').find({ workspace_id: 'WPREP', space_id: mySpace.space_id, status: 'open' }).toArray();
    const target = open.find(item => item.text === 'Juan reviews the contract');
    await db.collection('action_items').updateOne({ item_id: target.item_id }, { $set: { status: 'done', completed_at: NOW } });
    const later = new Date(NOW.getTime() + 5 * 60 * 1000);
    const second = await prep.getMeetingPrep('WPREP', 'UC', { now: later, timeZone: 'America/Santiago', cache: true, deps: counting });
    assert.equal(calls, 1, 'Calendar is read once within 10 minutes');
    assert.deepEqual(second[0].items.map(item => item.text), ['Send Juan the pricing deck']);

    // After 10 minutes Google is read again
    const afternoon = new Date('2026-10-02T15:30:00Z');
    const third = await prep.getMeetingPrep('WPREP', 'UC', { now: new Date(NOW.getTime() + 8 * 60 * 1000), timeZone: 'America/Santiago', cache: true, deps: counting });
    assert.equal(third.length, 2);
    await prep.getMeetingPrep('WPREP', 'UC', { now: afternoon, timeZone: 'America/Santiago', cache: true, deps: counting });
    assert.equal(calls, 2);
    await db.collection('action_items').updateOne({ item_id: target.item_id }, { $set: { status: 'open', completed_at: null } });

    // The morning summary never uses the cache
    await prep.getMeetingPrep('WPREP', 'UC', { now: NOW, timeZone: 'America/Santiago', deps: counting });
    assert.equal(calls, 3);
  });

  test('the morning summary carries the prep with local times, and it counts as news', async () => {
    const digest = require('../../src/jobs/daily-digest');
    const summary = await digest.buildDailySummary('WPREP', 'UC', new Date(NOW.getTime() - 3600 * 1000), NOW, 'America/Santiago', {
      meetingPrep: (workspaceId, userId, options) => prep.getMeetingPrep(workspaceId, userId, { ...options, deps: deps([CALENDAR]) })
    });
    assert.equal(summary.meetingPrep.length, 2);
    assert.equal(summary.meetingPrep[0].time, '11:00 AM');
    assert.equal(summary.meetingPrep[0].last_met, '2026-09-25', 'a local date for the email');
    assert.ok(digest.hasNews({ meetings: 0, newActionItems: 0, dueToday: 0, meetingPrep: summary.meetingPrep }));
    assert.ok(!digest.hasNews({ meetings: 0, newActionItems: 0, dueToday: 0, meetingPrep: [summary.meetingPrep[1]] }), 'a calendar alone isn’t news');
  });
});
