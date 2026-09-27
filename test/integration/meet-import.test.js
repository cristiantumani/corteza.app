const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setupTestDatabase, skip } = require('../helpers/db');

// Background jobs log while the test runner reads results from stdout; mixed
// output can break the runner ("Unable to deserialize cloned data")
console.log = () => {};
console.warn = () => {};
console.error = () => {};

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const LONG_TEXT = Array(80).fill('We agreed to adopt quarterly planning').join('. ');

describe('Google Meet: import past meetings', { skip }, () => {
  let db;
  let cleanup;
  let meetImport;
  let pipeline;
  let connections;
  let connection;
  let extractCalls = 0;

  // Fake Google data for four meetings in August 2026
  const meetings = {
    'conferenceRecords/new': { state: 'ready', title: 'Q3 planning', participantCount: 4 },
    'conferenceRecords/oneonone': { state: 'ready', title: 'Cris / Ana', participantCount: 2 },
    'conferenceRecords/done': { state: 'ready', title: 'Already imported', participantCount: 5 },
    'conferenceRecords/pending': { state: 'pending', title: 'Just ended', participantCount: 3 }
  };
  const records = Object.keys(meetings).map((name, i) => ({
    name, startTime: `2026-08-1${i}T09:00:00Z`, endTime: `2026-08-1${i}T10:00:00Z`
  }));

  const deps = {
    getClient: () => ({}),
    listRecords: async () => records,
    describeMeeting: async (client, record) => ({
      externalId: record.name, title: meetings[record.name].title, url: null,
      occurredAt: new Date(record.startTime), endedAt: new Date(record.endTime),
      participantCount: meetings[record.name].participantCount,
      hasTranscript: meetings[record.name].state === 'ready', hasNotes: false, state: meetings[record.name].state
    }),
    getRecord: async (client, name) => {
      if (name === 'conferenceRecords/forbidden') throw Object.assign(new Error('403'), { response: { status: 403 } });
      return records.find(r => r.name === name);
    },
    loadMeeting: async (client, record) => ({
      externalId: record.name, ...meetings[record.name], text: meetings[record.name].state === 'ready' ? LONG_TEXT : '',
      participants: ['Ana', 'Bob'], occurredAt: new Date(record.startTime), url: 'https://docs.google.com/document/d/z'
    }),
    ingest: (transcript, options) => pipeline.ingestTranscript(transcript, {
      ...options,
      extract: async () => {
        extractCalls++;
        return { decisions: [{ decision_text: `Decision from ${transcript.title}`, decision_type: 'decision', confidence: 0.9 }] };
      }
    })
  };

  async function waitForImport(importId) {
    for (let i = 0; i < 100; i++) {
      const job = await meetImport.getImport('WIMP', 'U1', importId);
      if (job.status !== 'running') return job;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('import did not finish');
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    meetImport = require('../../src/ingestion/meet-import');
    pipeline = require('../../src/ingestion/pipeline');
    connections = require('../../src/integrations/google/connections');

    connection = await connections.saveConnection({
      workspaceId: 'WIMP', userId: 'U1', userName: 'Cris', email: 'cris@ninja.io',
      refreshToken: 'refresh', grantedScopes: connections.MEET_SCOPES
    });

    // History: one meeting imported before, one skipped automatically as a 1:1
    await db.collection('ingestions').insertMany([
      { workspace_id: 'WIMP', source: 'google_meet', external_id: 'conferenceRecords/done', status: 'completed', decisions_created: 2, attempts: 1, updated_at: new Date() },
      { workspace_id: 'WIMP', source: 'google_meet', external_id: 'conferenceRecords/oneonone', status: 'skipped', skip_reason: 'one_on_one', attempts: 0, updated_at: new Date() }
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('lists meetings in the period, newest first, with availability and past status', async () => {
    const { meetings: found, truncated } = await meetImport.findMeetings(connection, meetImport.parseRange('2026-08-01', '2026-08-31', new Date('2026-09-27')), deps);
    assert.equal(truncated, false);
    assert.deepEqual(found.map(m => m.id), ['conferenceRecords/pending', 'conferenceRecords/done', 'conferenceRecords/oneonone', 'conferenceRecords/new']);

    const byId = Object.fromEntries(found.map(m => [m.id, m]));
    assert.equal(byId['conferenceRecords/new'].status, 'new');
    assert.equal(byId['conferenceRecords/done'].status, 'completed');
    assert.equal(byId['conferenceRecords/done'].decisions_created, 2);
    assert.equal(byId['conferenceRecords/oneonone'].status, 'skipped');
    assert.equal(byId['conferenceRecords/oneonone'].skip_reason, 'one_on_one');
    assert.equal(byId['conferenceRecords/pending'].availability, 'pending');
  });

  test('rejects empty, oversized and malformed selections', async () => {
    assert.match((await meetImport.startImport(connection, [], null, deps)).error, /at least one/);
    assert.match((await meetImport.startImport(connection, Array.from({ length: 51 }, (_, i) => `conferenceRecords/m${i}`), null, deps)).error, /at most 50/);
    assert.match((await meetImport.startImport(connection, ['../../secrets'], null, deps)).error, /Invalid/);
  });

  test('imports only the chosen meetings, including one skipped automatically, never a completed one twice', async () => {
    const job = await meetImport.startImport(connection, [
      'conferenceRecords/new', 'conferenceRecords/oneonone', 'conferenceRecords/done', 'conferenceRecords/pending', 'conferenceRecords/forbidden'
    ], null, deps);
    assert.equal(job.status, 'running');
    assert.equal(job.total, 5);

    const finished = await waitForImport(job.import_id);
    const byId = Object.fromEntries(finished.items.map(i => [i.meeting_id, i]));
    assert.equal(finished.status, 'completed');
    assert.equal(finished.done, 5);
    assert.equal(byId['conferenceRecords/new'].status, 'completed');
    assert.equal(byId['conferenceRecords/oneonone'].status, 'completed', 'manual import overrides the automatic 1:1 skip');
    assert.equal(byId['conferenceRecords/done'].status, 'already_imported');
    assert.equal(byId['conferenceRecords/pending'].status, 'not_ready');
    assert.equal(byId['conferenceRecords/forbidden'].status, 'failed');
    assert.equal(byId['conferenceRecords/forbidden'].error, 'You don’t have access to this meeting.');
    assert.equal(finished.decisions_created, 2);
    assert.equal(extractCalls, 2);

    const decisions = await db.collection('decisions').find({ workspace_id: 'WIMP' }).toArray();
    assert.deepEqual(decisions.map(d => d.text).sort(), ['Decision from Cris / Ana', 'Decision from Q3 planning']);
    assert.ok(decisions.every(d => d.capture === 'ai' && d.space_id));
    const planning = decisions.find(d => d.text === 'Decision from Q3 planning');
    assert.equal(planning.timestamp, '2026-08-10T09:00:00.000Z', 'dated by the meeting, not the import');

    // Nobody else can read this job
    assert.equal(await meetImport.getImport('WIMP', 'U2', job.import_id), null);
    assert.equal(await meetImport.getImport('WOTHER', 'U1', job.import_id), null);
  });

  test('an import interrupted by a restart is resumed', async () => {
    await db.collection('meet_imports').insertOne({
      import_id: 'imp_stale', workspace_id: 'WIMP', user_id: 'U1', connection_id: connection._id, space_id: null,
      status: 'running', items: [{ meeting_id: 'conferenceRecords/new', status: 'completed', decisions_created: 1 }, { meeting_id: 'conferenceRecords/pending', status: 'queued', decisions_created: 0 }],
      total: 2, done: 1, decisions_created: 1, lease_until: new Date(Date.now() - 1000), created_at: new Date(), updated_at: new Date()
    });
    await meetImport.resumeStaleImports(deps);
    const job = await meetImport.getImport('WIMP', 'U1', 'imp_stale');
    assert.equal(job.status, 'completed');
    assert.equal(job.done, 2);
    assert.equal(job.items[1].status, 'not_ready');
  });
});
