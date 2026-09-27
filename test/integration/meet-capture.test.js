const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setupTestDatabase, skip } = require('../helpers/db');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const LONG_TEXT = Array(80).fill('We agreed to move the launch to Friday').join('. ');

/** Fake Claude extractor */
function fakeExtract(decisions) {
  const calls = [];
  const extract = async (text, workspaceId) => {
    calls.push({ text, workspaceId });
    return { decisions, model: 'fake' };
  };
  extract.calls = calls;
  return extract;
}

describe('Google Meet capture: pipeline, decision ids, poller', { skip }, () => {
  let db;
  let cleanup;
  let pipeline;
  let decisionService;
  let poller;
  let connections;
  let spaces;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    pipeline = require('../../src/ingestion/pipeline');
    decisionService = require('../../src/core/decisions/decision-service');
    poller = require('../../src/jobs/meet-poller');
    connections = require('../../src/integrations/google/connections');
    spaces = require('../../src/services/spaces');
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('decision ids continue after the highest id already used by older code', async () => {
    await db.collection('decisions').insertOne({ workspace_id: 'WIDS', id: 41, text: 'legacy' });
    const ids = await Promise.all([1, 2, 3].map(() => decisionService.nextDecisionId('WIDS')));
    assert.deepEqual(ids.sort((a, b) => a - b), [42, 43, 44]);
  });

  test('decisions are dated when they were decided; created_at is when they were saved', async () => {
    const base = { workspaceId: 'WDATE', spaceId: 'S1', text: 'Adopt X', author: { user_id: 'U1', name: 'Ana' } };
    const past = await decisionService.createDecision({ ...base, decidedAt: '2026-08-10T09:00:00.000Z' });
    assert.equal(past.timestamp, '2026-08-10T09:00:00.000Z');
    assert.ok(past.created_at > new Date('2026-08-11'));

    const future = await decisionService.createDecision({ ...base, decidedAt: new Date(Date.now() + 86400000) });
    const invalid = await decisionService.createDecision({ ...base, decidedAt: 'not a date' });
    const none = await decisionService.createDecision(base);
    for (const decision of [future, invalid, none]) {
      assert.equal(decision.timestamp, decision.created_at.toISOString(), 'falls back to now');
    }
  });

  test('a transcript is extracted once and every decision is saved as AI-captured', async () => {
    const space = await spaces.ensureDefaultSpace('WPIPE');
    const extract = fakeExtract([
      { decision_text: 'Move launch to Friday', decision_type: 'decision', tags: ['launch'], confidence: 0.92, context: 'Ana proposed it' },
      { decision_text: 'Budget is capped at 10k', decision_type: 'context', tags: [], confidence: 0.8 }
    ]);
    const transcript = {
      workspaceId: 'WPIPE', source: 'google_meet', externalId: 'conferenceRecords/1', title: 'Launch sync',
      text: LONG_TEXT, participants: ['Ana', 'Bob', 'Carla'], occurredAt: '2026-09-27T09:00:00Z',
      url: 'https://docs.google.com/document/d/x', spaceId: space.space_id, spaceName: space.name,
      author: { user_id: 'U1', name: 'Ana' }
    };

    const first = await pipeline.ingestTranscript(transcript, { extract });
    assert.equal(first.status, 'completed');
    assert.equal(first.decisions.length, 2);
    assert.match(extract.calls[0].text, /^Meeting: Launch sync\nDate: 2026-09-27\nParticipants: Ana, Bob, Carla/);

    const saved = await db.collection('decisions').find({ workspace_id: 'WPIPE' }).sort({ id: 1 }).toArray();
    assert.deepEqual(saved.map(d => d.id), [1, 2]);
    assert.equal(saved[0].capture, 'ai');
    assert.equal(saved[0].confidence, 0.92);
    assert.equal(saved[0].space_id, space.space_id);
    assert.equal(saved[0].source, 'google_meet');
    assert.equal(saved[0].source_details.title, 'Launch sync');
    assert.equal(saved[0].source_details.url, 'https://docs.google.com/document/d/x');
    assert.equal(saved[0].creator, 'Ana');
    assert.match(saved[0].alternatives, /Captured automatically from "Launch sync"[\s\S]*Ana proposed it/);

    const again = await pipeline.ingestTranscript(transcript, { extract });
    assert.equal(again.status, 'duplicate');
    assert.equal(extract.calls.length, 1, 'extraction is not repeated');
    assert.equal(await db.collection('decisions').countDocuments({ workspace_id: 'WPIPE' }), 2);

    const ingestion = await db.collection('ingestions').findOne({ external_id: 'conferenceRecords/1' });
    assert.equal(ingestion.status, 'completed');
    assert.deepEqual(ingestion.decision_ids, [1, 2]);
  });

  test('failed extraction is recorded and retried later, not immediately', async () => {
    const space = await spaces.ensureDefaultSpace('WFAIL');
    const transcript = {
      workspaceId: 'WFAIL', source: 'google_meet', externalId: 'conferenceRecords/f', title: 'Flaky',
      text: LONG_TEXT, spaceId: space.space_id, author: { user_id: 'U1', name: 'Ana' }
    };
    const failing = async () => { throw new Error('Claude overloaded'); };

    assert.equal((await pipeline.ingestTranscript(transcript, { extract: failing })).status, 'failed');
    assert.equal((await pipeline.ingestTranscript(transcript, { extract: fakeExtract([]) })).status, 'duplicate', 'too soon to retry');
    assert.equal(await pipeline.isHandled('WFAIL', 'google_meet', 'conferenceRecords/f'), false);

    await db.collection('ingestions').updateOne({ external_id: 'conferenceRecords/f' }, { $set: { updated_at: new Date(Date.now() - 11 * 60 * 1000) } });
    const retried = await pipeline.ingestTranscript(transcript, { extract: fakeExtract([{ decision_text: 'Retry works', decision_type: 'decision', confidence: 0.9 }]) });
    assert.equal(retried.status, 'completed');
    assert.equal((await db.collection('ingestions').findOne({ external_id: 'conferenceRecords/f' })).attempts, 2);
  });

  test('very short transcripts are skipped without calling the AI', async () => {
    const space = await spaces.ensureDefaultSpace('WSHORT');
    const extract = fakeExtract([]);
    const result = await pipeline.ingestTranscript({
      workspaceId: 'WSHORT', source: 'google_meet', externalId: 'r/short', title: 'Hi', text: 'Hello, can you hear me?',
      spaceId: space.space_id, author: { user_id: 'U1', name: 'Ana' }
    }, { extract });
    assert.equal(result.status, 'skipped');
    assert.equal(extract.calls.length, 0);
  });

  test('connections store the refresh token encrypted', async () => {
    const connection = await connections.saveConnection({
      workspaceId: 'WPOLL', userId: 'U1', userName: 'Ana', email: 'ana@acme.com',
      refreshToken: '1//secret-refresh-token', grantedScopes: connections.MEET_SCOPES
    });
    assert.notEqual(connection.refresh_token_encrypted, '1//secret-refresh-token');
    assert.ok(!JSON.stringify(connection).includes('secret-refresh-token'));
    assert.equal(connection.status, 'active');
    assert.equal(connection.settings.skip_one_on_one, true);
    const client = connections.getAuthorizedClient(connection);
    assert.equal(client.credentials.refresh_token, '1//secret-refresh-token');
  });

  test('poller: ingests ready meetings, skips 1:1s and unrecorded ones, waits for pending ones, never twice', async () => {
    const connection = await connections.getConnection('WPOLL', 'U1');
    const now = new Date('2026-09-27T12:00:00Z');
    const meetings = {
      'conferenceRecords/ready': { state: 'ready', title: 'Planning', text: LONG_TEXT, participantCount: 4, participants: ['Ana', 'Bob', 'Carla', 'Dan'], url: 'https://docs.google.com/document/d/p', endedAt: new Date('2026-09-27T11:00:00Z') },
      'conferenceRecords/oneonone': { state: 'ready', title: 'Ana / Bob', text: LONG_TEXT, participantCount: 2, participants: ['Ana', 'Bob'], endedAt: new Date('2026-09-27T11:00:00Z') },
      'conferenceRecords/pending': { state: 'pending', title: 'Just ended', text: '', participantCount: 5, participants: [], endedAt: new Date('2026-09-27T11:55:00Z') },
      'conferenceRecords/none': { state: 'none', title: 'No transcription', text: '', participantCount: 3, participants: [], endedAt: new Date('2026-09-27T10:00:00Z') }
    };
    const loadCalls = [];
    const notified = [];
    const extract = fakeExtract([{ decision_text: 'Adopt quarterly planning', decision_type: 'decision', confidence: 0.9 }]);
    const deps = {
      now,
      getClient: () => ({}),
      listConferenceRecords: async (client, { endedAfter }) => {
        assert.ok(endedAfter <= new Date(now - poller.LOOKBACK_MS), 'looks back far enough for late transcripts');
        return Object.keys(meetings).map(name => ({ name, endTime: meetings[name].endedAt.toISOString() }));
      },
      loadMeeting: async (client, record) => { loadCalls.push(record.name); return { externalId: record.name, ...meetings[record.name] }; },
      ingest: transcript => pipeline.ingestTranscript(transcript, { extract }),
      notify: async (conn, result) => { notified.push(result.title); }
    };

    const first = await poller.runForConnection(connection, deps);
    assert.equal(first.meetingsProcessed, 1);
    assert.equal(first.decisionsCaptured, 1);
    const byTitle = Object.fromEntries(first.results.map(r => [r.title, r]));
    assert.equal(byTitle['Planning'].status, 'completed');
    assert.equal(byTitle['Ana / Bob'].reason, 'one_on_one');
    assert.equal(byTitle['Just ended'].status, 'waiting');
    assert.equal(byTitle['No transcription'].reason, 'no_transcript');
    assert.deepEqual(notified, ['Planning']);

    const decision = await db.collection('decisions').findOne({ workspace_id: 'WPOLL', 'source_details.external_id': 'conferenceRecords/ready' });
    const defaultSpace = await spaces.ensureDefaultSpace('WPOLL');
    assert.equal(decision.space_id, defaultSpace.space_id, 'goes to the default space when none is chosen');
    assert.equal(decision.user_id, 'U1');

    const saved = await connections.getConnection('WPOLL', 'U1');
    assert.equal(saved.decisions_captured, 1);
    assert.equal(saved.meetings_processed, 1);
    assert.equal(saved.lease_until, null);
    assert.ok(saved.last_polled_at);

    // Second run: only the pending meeting is looked at again
    loadCalls.length = 0;
    const second = await poller.runForConnection(saved, deps);
    assert.deepEqual(loadCalls, ['conferenceRecords/pending']);
    assert.equal(second.decisionsCaptured, 0);
    assert.equal(extract.calls.length, 1);
  });

  test('poller: a meeting Google refuses does not block the others', async () => {
    const connection = await connections.getConnection('WPOLL', 'U1');
    const extract = fakeExtract([{ decision_text: 'Move standup to 10am', decision_type: 'decision', confidence: 0.9 }]);
    const endTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const result = await poller.runForConnection(connection, {
      getClient: () => ({}),
      listConferenceRecords: async () => [{ name: 'conferenceRecords/refused', endTime }, { name: 'conferenceRecords/readable', endTime }],
      loadMeeting: async (client, record) => {
        if (record.name === 'conferenceRecords/refused') {
          throw Object.assign(new Error('403'), { response: { status: 403, data: { error: { message: 'The caller does not have permission' } } } });
        }
        return { externalId: record.name, state: 'ready', title: 'Standup review', text: LONG_TEXT, participantCount: 4, participants: ['Ana', 'Bob'], endedAt: new Date(endTime) };
      },
      ingest: transcript => pipeline.ingestTranscript(transcript, { extract }),
      notify: async () => {}
    });
    assert.equal(result.error, undefined);
    assert.equal(result.decisionsCaptured, 1);
    assert.deepEqual(result.results.map(r => r.status).sort(), ['completed', 'failed']);
    assert.equal(await pipeline.isHandled('WPOLL', 'google_meet', 'conferenceRecords/refused'), false, 'retried on a later poll');
  });

  test('poller: a held lease blocks a second concurrent run; revoked tokens mark the connection', async () => {
    const connection = await connections.getConnection('WPOLL', 'U1');
    await db.collection('google_connections').updateOne({ _id: connection._id }, { $set: { lease_until: new Date(Date.now() + 60000) } });
    assert.equal(await poller.runForConnection(connection, { getClient: () => ({}) }), null);
    await db.collection('google_connections').updateOne({ _id: connection._id }, { $set: { lease_until: null } });

    const revokedError = Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant' } } });
    const result = await poller.runForConnection(connection, {
      getClient: () => ({}),
      listConferenceRecords: async () => { throw revokedError; }
    });
    assert.equal(result.error, 'revoked');
    const saved = await connections.getConnection('WPOLL', 'U1');
    assert.equal(saved.status, 'revoked');
    assert.match(saved.last_error, /Reconnect Google Meet/);
  });
});
