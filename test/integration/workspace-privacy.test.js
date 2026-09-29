const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

/** Minimal res for the http-style handlers (writeHead + end) */
function fakeResponse() {
  const res = { status: null, headers: {}, body: '' };
  res.writeHead = (status, headers) => { res.status = status; Object.assign(res.headers, headers || {}); };
  res.end = body => { res.body = body || ''; };
  res.json = () => JSON.parse(res.body);
  return res;
}

function request(url, user) {
  return { url, query: {}, session: { user } };
}

describe("colleagues don't see each other's meetings or outcomes", { skip }, () => {
  let db;
  let cleanup;
  let pipeline;
  const WS = 'WPRIV';
  const ana = { workspace_id: WS, user_id: 'UA', user_name: 'Ana' };
  const bob = { workspace_id: WS, user_id: 'UB', user_name: 'Bob' };
  let anaSpace;
  let bobSpace;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    pipeline = require('../../src/ingestion/pipeline');
    const spaces = require('../../src/services/spaces');
    anaSpace = await spaces.ensurePersonalSpace(WS, 'UA', 'Ana');
    bobSpace = await spaces.ensurePersonalSpace(WS, 'UB', 'Bob');
    await db.collection('workspace_admins').insertOne({ workspace_id: WS, user_id: 'UA', role: 'admin', deactivated_at: null });
    await db.collection('decisions').insertMany([
      { workspace_id: WS, space_id: anaSpace.space_id, id: 1, type: 'decision', text: "Ana's board decision", tags: ['board'], user_id: 'UA', timestamp: new Date().toISOString() },
      { workspace_id: WS, space_id: bobSpace.space_id, id: 2, type: 'decision', text: "Bob's decision", tags: ['hiring'], user_id: 'UB', timestamp: new Date().toISOString() },
      { workspace_id: WS, space_id: bobSpace.space_id, id: 3, type: 'risk', text: "Bob's risk", user_id: 'UB', timestamp: new Date().toISOString() }
    ]);
    await db.collection('meeting_transcripts').insertMany([
      { workspace_id: WS, uploaded_by: 'UA', content: 'Ana transcript' },
      { workspace_id: WS, uploaded_by: 'UB', content: 'Bob transcript' }
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('latest meetings only list the person\'s own', async () => {
    const author = user => ({ user_id: user.user_id, name: user.user_name });
    await pipeline.recordSkipped({ workspaceId: WS, source: 'google_meet', externalId: 'conf/ana-1', title: 'Board prep', author: author(ana) }, 'one_on_one');
    await pipeline.recordSkipped({ workspaceId: WS, source: 'google_meet', externalId: 'conf/bob-1', title: 'Bob 1:1', author: author(bob) }, 'one_on_one');

    const anaSees = await pipeline.listRecentForUser(WS, 'UA', 'google_meet');
    const bobSees = await pipeline.listRecentForUser(WS, 'UB', 'google_meet');
    assert.deepEqual(anaSees.map(m => m.title), ['Board prep']);
    assert.deepEqual(bobSees.map(m => m.title), ['Bob 1:1']);
  });

  test('stats count only outcomes in spaces the person can see', async () => {
    const { getStats } = require('../../src/routes/api');
    const res = fakeResponse();
    await getStats(request('/api/stats', bob), res);
    assert.equal(res.json().total, 2);

    const anaRes = fakeResponse();
    await getStats(request('/api/stats', ana), anaRes);
    assert.equal(anaRes.json().total, 1, 'an admin does not count a colleague\'s personal space either');
  });

  test("data export has only the person's visible outcomes and own transcripts", async () => {
    const { exportWorkspaceData, getWorkspaceDataInfo } = require('../../src/routes/gdpr');
    const res = fakeResponse();
    await exportWorkspaceData(request(`/api/gdpr/export?workspace_id=${WS}&format=json`, bob), res);
    const exported = res.json();
    assert.deepEqual(exported.data.decisions.map(d => d.id).sort(), [2, 3]);
    assert.deepEqual(exported.data.meeting_transcripts.map(t => t.content), ['Bob transcript']);

    const info = fakeResponse();
    await getWorkspaceDataInfo(request(`/api/gdpr/info?workspace_id=${WS}`, bob), info);
    assert.equal(info.json().data_summary.decisions, 2);
  });

  test('only a workspace admin can delete all workspace data', async () => {
    const { deleteAllWorkspaceData } = require('../../src/routes/gdpr');
    const res = fakeResponse();
    await deleteAllWorkspaceData(request(`/api/gdpr/delete-all?workspace_id=${WS}&confirm=DELETE_ALL_DATA`, bob), res);
    assert.equal(res.status, 403);
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: WS }), 3, 'nothing deleted');
  });

  test('search suggestions only offer tags from visible spaces', async () => {
    const { handleSearchSuggestions } = require('../../src/routes/semantic-search-api');
    const res = fakeResponse();
    await handleSearchSuggestions(request(`/api/search-suggestions?q=b&workspace_id=${WS}`, bob), res);
    const values = res.json().suggestions.map(s => s.value);
    assert.ok(!values.includes('board'), "Ana's tag stays private");
  });

  test('migration 008 attributes rows from their outcomes or the only connection, and leaves the rest hidden', async () => {
    const { migrate } = require('../../scripts/migrations/008-ingestion-owners');
    await db.collection('ingestions').insertMany([
      { workspace_id: 'WM1', source: 'google_meet', external_id: 'conf/1', status: 'completed' },
      { workspace_id: 'WM1', source: 'google_meet', external_id: 'conf/2', status: 'skipped' },
      { workspace_id: 'WM2', source: 'google_meet', external_id: 'conf/3', status: 'skipped' }
    ]);
    await db.collection('decisions').insertOne({ workspace_id: 'WM1', id: 1, user_id: 'U1', source_details: { external_id: 'conf/1' } });
    await db.collection('google_connections').insertMany([
      { workspace_id: 'WM1', user_id: 'U1' }, { workspace_id: 'WM1', user_id: 'U2' },
      { workspace_id: 'WM2', user_id: 'U9' }
    ]);

    const dry = await migrate(db, { apply: false });
    assert.deepEqual(dry, { fromOutcomes: 1, fromSingleConnection: 1, unattributed: 1 });
    assert.equal(await db.collection('ingestions').countDocuments({ workspace_id: { $in: ['WM1', 'WM2'] }, user_id: { $exists: true } }), 0, 'dry run changes nothing');

    await migrate(db, { apply: true });
    const owner = async id => (await db.collection('ingestions').findOne({ external_id: id })).user_id;
    assert.equal(await owner('conf/1'), 'U1');
    assert.equal(await owner('conf/2'), undefined, 'two connections: stays hidden');
    assert.equal(await owner('conf/3'), 'U9');
  });
});
