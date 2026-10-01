const meet = require('../../integrations/google/meet-client');

/**
 * Google Meet source: turns a conference record into the text the pipeline needs.
 *
 * Uses the transcript (speaker-labelled entries from the Meet API) and, when
 * available, Gemini "Take notes for me" notes (a Google Doc exported as text).
 * The meeting title comes from the name of the Doc Meet created, because the
 * Meet API itself has no meeting title.
 */

/** Display name for a Meet participant resource */
function participantName(participant) {
  return participant?.signedinUser?.displayName
    || participant?.anonymousUser?.displayName
    || participant?.phoneUser?.displayName
    || 'Unknown';
}

/**
 * "Weekly sync - 2026/09/27 10:00 CEST - Transcript" → "Weekly sync"
 * "Weekly sync – Notes by Gemini" → "Weekly sync"
 * "1:1 Ana / Bob: 2026/09/01 15:30 GMT-03:00" → "1:1 Ana / Bob"
 */
function cleanMeetingTitle(docName) {
  if (!docName) return null;
  return docName
    .replace(/\s*[-–—]\s*(Transcript|Transcripción|Notes by Gemini|Notas de Gemini)\s*$/i, '')
    .replace(/\s*[-–—:]\s*\d{4}\/\d{2}\/\d{2}\s+\d{1,2}:\d{2}(\s*[A-Z]{2,5}([+-]\d{1,2}(:\d{2})?)?)?\s*$/, '')
    .trim() || null;
}

/**
 * Joins transcript entries into "Name: text" lines, merging consecutive entries by the same speaker
 * @param {Object[]} entries - Meet transcript entries ({ participant, text })
 * @param {Map<string,string>} namesByParticipant - participant resource name → display name
 */
function formatTranscriptEntries(entries, namesByParticipant) {
  const lines = [];
  let lastSpeaker = null;
  for (const entry of entries) {
    const text = (entry.text || '').trim();
    if (!text) continue;
    const speaker = namesByParticipant.get(entry.participant) || 'Unknown';
    if (speaker === lastSpeaker) {
      lines[lines.length - 1] += ` ${text}`;
    } else {
      lines.push(`${speaker}: ${text}`);
      lastSpeaker = speaker;
    }
  }
  return lines.join('\n');
}

/** Document ID from a Meet docsDestination ({ document: 'documents/<id>' or '<id>' }) */
function documentId(docsDestination) {
  const doc = docsDestination?.document;
  return doc ? doc.replace(/^documents\//, '') : null;
}

/**
 * Loads everything about one meeting
 * @param {Object} client - authorized OAuth2Client
 * @param {Object} record - conference record from listConferenceRecords
 * @returns {Promise<{ externalId, title, text, url, participants, participantCount, occurredAt, endedAt, state }>}
 *   state: 'ready' (text available), 'pending' (transcript/notes still being generated), 'none' (nothing recorded)
 */
async function loadMeeting(client, record) {
  const [participants, transcripts, smartNotes] = await Promise.all([
    meet.listParticipants(client, record.name),
    meet.listTranscripts(client, record.name),
    meet.listSmartNotes(client, record.name)
  ]);

  const namesByParticipant = new Map(participants.map(p => [p.name, participantName(p)]));
  const meeting = {
    externalId: record.name,
    title: null,
    text: '',
    url: null,
    participants: [...new Set(participants.map(participantName))],
    participantCount: participants.length,
    occurredAt: record.startTime ? new Date(record.startTime) : null,
    endedAt: record.endTime ? new Date(record.endTime) : null,
    state: 'none'
  };

  const readyTranscripts = transcripts.filter(t => t.state === 'FILE_GENERATED');
  const readyNotes = smartNotes.filter(n => n.state === 'FILE_GENERATED');
  const stillGenerating = transcripts.some(t => t.state !== 'FILE_GENERATED')
    || smartNotes.some(n => n.state !== 'FILE_GENERATED');

  if (readyTranscripts.length === 0 && readyNotes.length === 0) {
    meeting.state = stillGenerating ? 'pending' : 'none';
    return meeting;
  }

  const sections = [];
  const failures = []; // sources Google refused; the meeting still works if another source can be read

  for (const transcript of readyTranscripts) {
    await addDocInfo(client, meeting, transcript.docsDestination);
    try {
      const text = await readTranscript(client, transcript, namesByParticipant);
      if (text) sections.push(`Transcript:\n${text}`);
    } catch (error) {
      failures.push({ source: 'transcript', error });
    }
  }

  for (const note of readyNotes) {
    const fileId = documentId(note.docsDestination);
    if (!fileId) continue;
    await addDocInfo(client, meeting, note.docsDestination);
    try {
      const text = (await meet.exportDocText(client, fileId)).trim();
      if (text) sections.push(`Meeting notes (Gemini):\n${text}`);
    } catch (error) {
      failures.push({ source: 'notes', error });
    }
  }

  meeting.title = meeting.title || fallbackTitle(meeting.occurredAt);
  for (const { source, error } of failures) {
    console.warn(`⚠️  Could not read the ${source} of ${record.name}: ${meet.describeGoogleError(error)}`);
  }
  if (sections.length === 0 && failures.length > 0) {
    // Nothing readable: surface the first refusal to the caller
    const { source, error } = failures[0];
    error.meetSource = source;
    throw error;
  }

  meeting.text = sections.join('\n\n');
  meeting.state = meeting.text ? 'ready' : (stillGenerating ? 'pending' : 'none');
  return meeting;
}

/**
 * Transcript text: the Meet API's speaker-labelled entries, or the transcript
 * Doc exported from Drive when the entries can't be read (or are empty)
 */
async function readTranscript(client, transcript, namesByParticipant) {
  let entriesError = null;
  try {
    const entries = await meet.listTranscriptEntries(client, transcript.name);
    const text = formatTranscriptEntries(entries, namesByParticipant);
    if (text) return text;
  } catch (error) {
    entriesError = error;
  }

  const fileId = documentId(transcript.docsDestination);
  if (!fileId) {
    if (entriesError) throw entriesError;
    return '';
  }
  try {
    return (await meet.exportDocText(client, fileId)).trim();
  } catch (error) {
    throw entriesError || error;
  }
}

/**
 * Lightweight summary of a meeting for listing (no transcript text is downloaded)
 * @returns {Promise<{ externalId, title, url, occurredAt, endedAt, participantCount, hasTranscript, hasNotes, state }>}
 *   state: 'ready' | 'pending' (still being generated) | 'none' (nothing recorded)
 */
async function describeMeeting(client, record) {
  const [participants, transcripts, smartNotes] = await Promise.all([
    meet.listParticipants(client, record.name),
    meet.listTranscripts(client, record.name),
    meet.listSmartNotes(client, record.name)
  ]);

  const readyTranscripts = transcripts.filter(t => t.state === 'FILE_GENERATED');
  const readyNotes = smartNotes.filter(n => n.state === 'FILE_GENERATED');
  const meeting = {
    externalId: record.name,
    title: null,
    url: null,
    occurredAt: record.startTime ? new Date(record.startTime) : null,
    endedAt: record.endTime ? new Date(record.endTime) : null,
    participantCount: participants.length,
    hasTranscript: readyTranscripts.length > 0,
    hasNotes: readyNotes.length > 0,
    state: readyTranscripts.length || readyNotes.length ? 'ready'
      : (transcripts.length || smartNotes.length ? 'pending' : 'none')
  };

  const doc = readyTranscripts[0]?.docsDestination || readyNotes[0]?.docsDestination;
  if (doc) await addDocInfo(client, meeting, doc);
  meeting.title = meeting.title || fallbackTitle(meeting.occurredAt);
  return meeting;
}

function fallbackTitle(occurredAt) {
  return occurredAt
    ? `Google Meet on ${occurredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'Google Meet';
}

/** Fills in title and link from the first Meet-created Doc we can read */
async function addDocInfo(client, meeting, docsDestination) {
  if (meeting.title && meeting.url) return;
  const fileId = documentId(docsDestination);
  if (!fileId) return;
  try {
    const file = await meet.getDriveFile(client, fileId);
    meeting.title = meeting.title || cleanMeetingTitle(file.name);
    meeting.url = meeting.url || file.webViewLink || docsDestination.exportUri || null;
  } catch (error) {
    meeting.url = meeting.url || docsDestination.exportUri || null;
  }
}

module.exports = {
  loadMeeting,
  describeMeeting,
  participantName,
  cleanMeetingTitle,
  formatTranscriptEntries,
  documentId
};
