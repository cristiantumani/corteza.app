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
 */
function cleanMeetingTitle(docName) {
  if (!docName) return null;
  return docName
    .replace(/\s*[-–—]\s*(Transcript|Transcripción|Notes by Gemini|Notas de Gemini)\s*$/i, '')
    .replace(/\s*[-–—]\s*\d{4}\/\d{2}\/\d{2}\s+\d{1,2}:\d{2}(\s*[A-Z]{2,5}([+-]\d{1,2})?)?\s*$/, '')
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

  for (const transcript of readyTranscripts) {
    const entries = await meet.listTranscriptEntries(client, transcript.name);
    const text = formatTranscriptEntries(entries, namesByParticipant);
    if (text) sections.push(`Transcript:\n${text}`);
    await addDocInfo(client, meeting, transcript.docsDestination);
  }

  for (const note of readyNotes) {
    const fileId = documentId(note.docsDestination);
    if (!fileId) continue;
    const text = (await meet.exportDocText(client, fileId)).trim();
    if (text) sections.push(`Meeting notes (Gemini):\n${text}`);
    await addDocInfo(client, meeting, note.docsDestination);
  }

  meeting.text = sections.join('\n\n');
  meeting.state = meeting.text ? 'ready' : (stillGenerating ? 'pending' : 'none');
  if (!meeting.title) {
    meeting.title = meeting.occurredAt
      ? `Google Meet on ${meeting.occurredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
      : 'Google Meet';
  }
  return meeting;
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
  participantName,
  cleanMeetingTitle,
  formatTranscriptEntries,
  documentId
};
