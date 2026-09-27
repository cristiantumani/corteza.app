const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.BASE_URL = 'https://app.example.com';

const meetClient = require('../../src/integrations/google/meet-client');
const source = require('../../src/ingestion/sources/google-meet');
const { skipReason } = require('../../src/jobs/meet-poller');
const { buildExtractionText } = require('../../src/ingestion/pipeline');
const connections = require('../../src/integrations/google/connections');

test('meeting titles are cleaned from Meet Doc names', () => {
  assert.equal(source.cleanMeetingTitle('Weekly sync - 2026/09/27 10:00 CEST - Transcript'), 'Weekly sync');
  assert.equal(source.cleanMeetingTitle('Q4 planning – Notes by Gemini'), 'Q4 planning');
  assert.equal(source.cleanMeetingTitle('Roadmap review - 2026/09/27 09:05 GMT+2 - Transcript'), 'Roadmap review');
  assert.equal(source.cleanMeetingTitle('Just a title'), 'Just a title');
  assert.equal(source.cleanMeetingTitle(null), null);
});

test('transcript entries become speaker lines, merging consecutive entries', () => {
  const names = new Map([['p/1', 'Ana'], ['p/2', 'Bob']]);
  const text = source.formatTranscriptEntries([
    { participant: 'p/1', text: 'We should ship Friday.' },
    { participant: 'p/1', text: 'Everyone ok?' },
    { participant: 'p/2', text: 'Agreed.' },
    { participant: 'p/3', text: 'Me too.' },
    { participant: 'p/2', text: '   ' }
  ], names);
  assert.equal(text, 'Ana: We should ship Friday. Everyone ok?\nBob: Agreed.\nUnknown: Me too.');
});

test('participant names come from any participant type', () => {
  assert.equal(source.participantName({ signedinUser: { displayName: 'Ana' } }), 'Ana');
  assert.equal(source.participantName({ anonymousUser: { displayName: 'Guest' } }), 'Guest');
  assert.equal(source.participantName({ phoneUser: { displayName: 'Phone 1' } }), 'Phone 1');
  assert.equal(source.participantName({}), 'Unknown');
});

/** Replaces meet-client functions for one test */
function stubMeet(overrides) {
  const originals = {};
  for (const [name, fn] of Object.entries(overrides)) {
    originals[name] = meetClient[name];
    meetClient[name] = fn;
  }
  return () => Object.assign(meetClient, originals);
}

const record = { name: 'conferenceRecords/abc', startTime: '2026-09-27T09:00:00Z', endTime: '2026-09-27T10:00:00Z' };
const participants = [
  { name: 'conferenceRecords/abc/participants/1', signedinUser: { displayName: 'Ana' } },
  { name: 'conferenceRecords/abc/participants/2', signedinUser: { displayName: 'Bob' } },
  { name: 'conferenceRecords/abc/participants/3', anonymousUser: { displayName: 'Carla' } }
];

test('loadMeeting combines transcript and Gemini notes, with title and link from the Doc', async () => {
  const restore = stubMeet({
    listParticipants: async () => participants,
    listTranscripts: async () => [{ name: 'conferenceRecords/abc/transcripts/t1', state: 'FILE_GENERATED', docsDestination: { document: 'doc-transcript' } }],
    listSmartNotes: async () => [{ name: 'conferenceRecords/abc/smartNotes/n1', state: 'FILE_GENERATED', docsDestination: { document: 'doc-notes' } }],
    listTranscriptEntries: async () => [
      { participant: 'conferenceRecords/abc/participants/1', text: 'Decision: we move launch to Friday.' },
      { participant: 'conferenceRecords/abc/participants/2', text: 'Agreed.' }
    ],
    exportDocText: async (client, fileId) => (fileId === 'doc-notes' ? 'Summary: launch moves to Friday.' : ''),
    getDriveFile: async (client, fileId) => ({ id: fileId, name: 'Launch sync - 2026/09/27 09:00 CEST - Transcript', webViewLink: `https://docs.google.com/document/d/${fileId}` })
  });
  try {
    const meeting = await source.loadMeeting({}, record);
    assert.equal(meeting.state, 'ready');
    assert.equal(meeting.title, 'Launch sync');
    assert.equal(meeting.url, 'https://docs.google.com/document/d/doc-transcript');
    assert.equal(meeting.participantCount, 3);
    assert.deepEqual(meeting.participants, ['Ana', 'Bob', 'Carla']);
    assert.match(meeting.text, /Transcript:\nAna: Decision: we move launch to Friday\.\nBob: Agreed\./);
    assert.match(meeting.text, /Meeting notes \(Gemini\):\nSummary: launch moves to Friday\./);
  } finally {
    restore();
  }
});

test('loadMeeting reports pending while Meet is still generating, none when nothing was recorded', async () => {
  let restore = stubMeet({
    listParticipants: async () => participants,
    listTranscripts: async () => [{ name: 't1', state: 'ENDED' }],
    listSmartNotes: async () => []
  });
  try {
    assert.equal((await source.loadMeeting({}, record)).state, 'pending');
  } finally {
    restore();
  }

  restore = stubMeet({
    listParticipants: async () => participants,
    listTranscripts: async () => [],
    listSmartNotes: async () => []
  });
  try {
    const meeting = await source.loadMeeting({}, record);
    assert.equal(meeting.state, 'none');
    assert.equal(meeting.text, '');
  } finally {
    restore();
  }
});

test('skip rules: 1:1s by default, title keywords, and opt-out of the 1:1 rule', () => {
  assert.equal(skipReason({ participantCount: 2, title: 'Chat' }, {}), 'one_on_one');
  assert.equal(skipReason({ participantCount: 2, title: 'Chat' }, { skip_one_on_one: false }), null);
  assert.equal(skipReason({ participantCount: 5, title: 'Candidate Interview' }, { exclude_keywords: ['interview'] }), 'excluded_title');
  assert.equal(skipReason({ participantCount: 5, title: 'Planning' }, { exclude_keywords: ['interview', ''] }), null);
});

test('extraction text starts with meeting title, date and participants', () => {
  const text = buildExtractionText({
    title: 'Launch sync', occurredAt: '2026-09-27T09:00:00Z', participants: ['Ana', 'Bob'], text: 'Ana: Ship Friday.'
  });
  assert.equal(text, 'Meeting: Launch sync\nDate: 2026-09-27\nParticipants: Ana, Bob\n\nAna: Ship Friday.');
});

test('connect URL asks for Meet + Drive-Meet scopes with offline access', () => {
  const url = new URL(connections.buildConnectUrl({ state: 's', nonce: 'n', loginHint: 'ana@acme.com' }));
  const scopes = url.searchParams.get('scope').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/meetings.space.readonly'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.meet.readonly'));
  assert.ok(scopes.includes('openid'));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/integrations/google/callback');
  assert.equal(url.searchParams.get('login_hint'), 'ana@acme.com');

  assert.deepEqual(connections.missingScopes(['openid', 'https://www.googleapis.com/auth/meetings.space.readonly']),
    ['https://www.googleapis.com/auth/drive.meet.readonly']);
});

test('describeMeeting summarises availability without downloading transcript text', async () => {
  let entriesFetched = false;
  const restore = stubMeet({
    listParticipants: async () => participants,
    listTranscripts: async () => [{ name: 't1', state: 'FILE_GENERATED', docsDestination: { document: 'doc-1' } }],
    listSmartNotes: async () => [],
    listTranscriptEntries: async () => { entriesFetched = true; return []; },
    getDriveFile: async (client, fileId) => ({ id: fileId, name: 'Board review - 2026/08/12 15:00 CEST - Transcript', webViewLink: 'https://docs.google.com/document/d/doc-1' })
  });
  try {
    const meeting = await source.describeMeeting({}, record);
    assert.equal(meeting.state, 'ready');
    assert.equal(meeting.hasTranscript, true);
    assert.equal(meeting.hasNotes, false);
    assert.equal(meeting.title, 'Board review');
    assert.equal(meeting.participantCount, 3);
    assert.equal(entriesFetched, false);
  } finally {
    restore();
  }
});
