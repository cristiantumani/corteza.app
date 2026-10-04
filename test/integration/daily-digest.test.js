const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('daily digest: one summary per person per day, with only their own numbers', { skip }, () => {
  const WS = 'WDAY';
  // 8:10 in Santiago (UTC-3), 13:10 in Madrid
  const WEDNESDAY_MORNING = new Date('2026-09-30T11:10:00Z');
  const hoursAgo = hours => new Date(WEDNESDAY_MORNING.getTime() - hours * 3600 * 1000);
  let db;
  let cleanup;
  let digest;
  let anaSpace;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    digest = require('../../src/jobs/daily-digest');
    const spaces = require('../../src/services/spaces');
    await db.collection('workspace_members').insertMany([
      { workspace_id: WS, user_id: 'UA', user_name: 'Ana', email: 'ana@acme.com', workspace_name: 'Acme', removed_at: null, timezone: 'America/Santiago' },
      // No time zone yet: gets the workspace's (Santiago)
      { workspace_id: WS, user_id: 'UB', user_name: 'Bob', email: 'bob@acme.com', workspace_name: 'Acme', removed_at: null },
      // In Madrid it's already past the morning
      { workspace_id: WS, user_id: 'UD', user_name: 'Dani', email: 'dani@acme.com', workspace_name: 'Acme', removed_at: null, timezone: 'Europe/Madrid' },
      { workspace_id: WS, user_id: 'UC', user_name: 'Carla', email: 'carla@acme.com', workspace_name: 'Acme', removed_at: null, daily_digest_opt_out: true }
    ]);
    anaSpace = await spaces.ensurePersonalSpace(WS, 'UA', 'Ana');
    await spaces.ensurePersonalSpace(WS, 'UB', 'Bob');

    await db.collection('ingestions').insertMany([
      // Ana's meetings today, plus one imported past meeting that must not count
      { workspace_id: WS, user_id: 'UA', source: 'google_meet', external_id: 'm1', status: 'completed', completed_at: hoursAgo(3), outcomes_by_type: { decision: 2, risk: 1 } },
      { workspace_id: WS, user_id: 'UA', source: 'google_meet', external_id: 'm2', status: 'completed', completed_at: hoursAgo(5), outcomes_by_type: { decision: 1 } },
      { workspace_id: WS, user_id: 'UA', source: 'google_meet', external_id: 'old', status: 'completed', manual: true, completed_at: hoursAgo(1), outcomes_by_type: { decision: 9 } },
      { workspace_id: WS, user_id: 'UA', source: 'google_meet', external_id: 'last-week', status: 'completed', completed_at: hoursAgo(24 * 6), outcomes_by_type: { decision: 4 } }
    ]);
    await db.collection('action_items').insertMany([
      { workspace_id: WS, item_id: 'a1', text: 'Send the pricing proposal', source: { title: 'Weekly sync' }, owner_ids: ['UA'], status: 'open', due_date: '2026-09-20', created_at: hoursAgo(24 * 10) },
      { workspace_id: WS, item_id: 'a2', owner_ids: ['UA'], status: 'open', due_date: null, created_at: hoursAgo(2) },
      { workspace_id: WS, item_id: 'a4', text: 'Review the header copy', owner_ids: ['UA'], status: 'open', due_date: '2026-09-30', created_at: hoursAgo(24 * 5) },
      // The same item captured by a colleague who was in the meeting: listed once, not counted again below
      { workspace_id: WS, item_id: 'a4-copy', space_id: 'colleague', text: 'Review the header copy', owner_ids: ['UA'], status: 'done', due_date: '2026-09-30', created_at: hoursAgo(24 * 5) },
      { workspace_id: WS, item_id: 'a3', owner_ids: ['UA'], status: 'done', due_date: '2026-09-01', created_at: hoursAgo(24 * 30) },
      // Bob: nothing new today, only an old overdue item
      { workspace_id: WS, item_id: 'b1', owner_ids: ['UB'], status: 'open', due_date: '2026-09-10', created_at: hoursAgo(24 * 20) },
      { workspace_id: WS, item_id: 'd1', owner_ids: ['UD'], status: 'open', due_date: null, created_at: new Date('2026-09-30T05:00:00Z') }
    ]);
    await db.collection('decisions').insertMany([
      { workspace_id: WS, space_id: anaSpace.space_id, id: 1, text: 'x', type: 'decision', capture: 'ai' },
      { workspace_id: WS, space_id: anaSpace.space_id, id: 2, text: 'y', type: 'decision', capture: 'ai', review_status: 'confirmed' },
      { workspace_id: WS, space_id: anaSpace.space_id, id: 3, text: 'z', type: 'decision', capture: 'manual' }
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test("a person's numbers: meetings and outcomes since the last one (not imports), new items, due today, reminders", async () => {
    const summary = await digest.buildDailySummary(WS, 'UA', hoursAgo(24), WEDNESDAY_MORNING, 'America/Santiago');
    const { planItems, ...counts } = summary;
    assert.deepEqual(counts, { meetings: 2, outcomes: { decision: 3, risk: 1 }, newActionItems: 1, dueToday: 1, toReview: 1, overdue: 1, noDueDate: 1, assignedBy: [], meetingPrep: [] });
    assert.deepEqual(planItems, [
      { item_id: 'a4', text: 'Review the header copy', due_date: '2026-09-30', meeting: null, next_step_on: null, recent_from_colleague: false },
      { item_id: 'a1', text: 'Send the pricing proposal', due_date: '2026-09-20', meeting: 'Weekly sync', next_step_on: null, recent_from_colleague: false }
    ], 'their own open items: due today first, then overdue');
  });

  test('the list shows each item once, even when colleagues captured it too', async () => {
    await db.collection('action_items').insertOne({ workspace_id: WS, item_id: 'a4-open-copy', space_id: 'colleague', text: 'review the header copy ', owner_ids: ['UA'], status: 'open', due_date: '2026-09-30', created_at: hoursAgo(24 * 6) });
    const summary = await digest.buildDailySummary(WS, 'UA', hoursAgo(24), WEDNESDAY_MORNING, 'America/Santiago');
    assert.deepEqual(summary.planItems.map(item => item.item_id), ['a4', 'a1']);
    await db.collection('action_items').deleteOne({ item_id: 'a4-open-copy' });
  });

  test('sends once per person per day, skips people with nothing new and people who opted out', async () => {
    const sent = [];
    const send = async params => { sent.push(params); };

    const first = await digest.runDailyDigest(WEDNESDAY_MORNING, { send });
    assert.deepEqual(sent.map(s => s.email), ['ana@acme.com'], "Bob only has reminders; Carla opted out; it's afternoon for Dani");
    assert.equal(first.checked, 2);
    assert.equal(sent[0].summary.meetings, 2);
    assert.equal(sent[0].summary.since, 'yesterday');
    assert.equal(sent[0].summary.today, '2026-09-30');
    assert.equal(sent[0].summary.planItems.length, 2);
    assert.match(sent[0].unsubscribe_url, /k=daily/);
    assert.equal(sent[0].summary.dayLabel, 'Wednesday, September 30');

    const again = await digest.runDailyDigest(new Date(WEDNESDAY_MORNING.getTime() + 15 * 60 * 1000), { send });
    assert.equal(again.checked, 0, 'already claimed today');
    assert.equal(sent.length, 1);

    const saved = await db.collection('daily_digests').findOne({ workspace_id: WS, user_id: 'UA', day: '2026-09-30' });
    assert.equal(saved.sent, true);
    assert.equal(saved.timezone, 'America/Santiago');
    assert.equal(saved.summary.planItems, 2, 'only the count is kept, not the text');

    // Morning partner: nobody picked one, so the default (Sarcastic) writes it
    assert.equal(sent[0].partner.voice, 'sarcastic');
    assert.equal(sent[0].partner.situation, 'overdue_few', '1 overdue');
    assert.equal(sent[0].partner.language, 'en', 'detected from the items, in English');
    assert.equal(saved.voice, 'sarcastic');
    assert.equal(saved.situation, 'overdue_few');
    assert.match(saved.line_id, /^sarcastic\.en\.overdue_few\.\d+$/);
    assert.ok(!JSON.stringify(saved).includes(sent[0].partner.subject), "the line's text is never stored");
  });

  test("each person gets it at 8:00 their time", async () => {
    const sent = [];
    const madridMorning = new Date('2026-09-30T06:10:00Z');
    await digest.runDailyDigest(madridMorning, { send: async params => { sent.push(params); } });
    assert.deepEqual(sent.map(s => s.email), ['dani@acme.com']);
  });

  test("the next day's window starts at the previous check, so nothing is counted twice", async () => {
    const sent = [];
    const thursday = new Date('2026-10-01T11:10:00Z');
    await digest.runDailyDigest(thursday, { send: async params => { sent.push(params); } });
    assert.deepEqual(sent, [], "yesterday's meetings are not news today (and Ana's item was due yesterday)");
  });

  test('the partner follows the person\'s pick, their Meet language, and the workspace switch', async () => {
    const FRIDAY = new Date('2026-10-02T11:10:00Z');
    await db.collection('workspace_members').insertMany([
      { workspace_id: WS, user_id: 'UF', user_name: 'Fede', email: 'fede@acme.com', workspace_name: 'Acme', removed_at: null, timezone: 'America/Santiago', digest_voice: 'sergeant' },
      { workspace_id: WS, user_id: 'UG', user_name: 'Gabi', email: 'gabi@acme.com', workspace_name: 'Acme', removed_at: null, timezone: 'America/Santiago', digest_voice: 'classic' },
      { workspace_id: 'WOFF', user_id: 'UE', user_name: 'Eva', email: 'eva@other.com', workspace_name: 'Other', removed_at: null, timezone: 'America/Santiago', digest_voice: 'sarcastic' }
    ]);
    await db.collection('workspaces').insertOne({ workspace_id: 'WOFF', name: 'Other', digest_voices_enabled: false });
    await db.collection('google_connections').insertOne({ workspace_id: WS, user_id: 'UF', settings: { language: 'es' } });
    const dueToday = (workspaceId, userId, id) => ({
      workspace_id: workspaceId, item_id: id, text: 'Enviar la propuesta', owner_ids: [userId], status: 'open', due_date: '2026-10-02',
      created_at: new Date(FRIDAY.getTime() - 3600 * 1000), created_by: { user_id: userId, name: 'x' }
    });
    await db.collection('action_items').insertMany([dueToday(WS, 'UF', 'f1'), dueToday(WS, 'UG', 'g1'), dueToday('WOFF', 'UE', 'e1')]);

    const sent = [];
    await digest.runDailyDigest(FRIDAY, { send: async params => { sent.push(params); } });
    const byEmail = Object.fromEntries(sent.map(params => [params.email, params]));
    assert.deepEqual(Object.keys(byEmail).sort(), ['eva@other.com', 'fede@acme.com', 'gabi@acme.com']);

    const fede = byEmail['fede@acme.com'].partner;
    assert.equal(fede.voice, 'sergeant');
    assert.equal(fede.situation, 'due_today');
    assert.equal(fede.language, 'es', 'their Meet "Write outcomes in" setting');
    assert.equal(byEmail['gabi@acme.com'].partner, null, 'picked Classic');
    assert.equal(byEmail['eva@other.com'].partner, null, 'their workspace turned personalities off');
    const eva = await db.collection('daily_digests').findOne({ workspace_id: 'WOFF', user_id: 'UE' });
    assert.equal(eva.voice, 'classic');
    assert.equal(eva.line_id, null);
  });
});
