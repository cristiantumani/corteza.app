/**
 * Thin client for the Google Meet REST API (v2) and the Drive API calls we need.
 * Every function takes an authorized OAuth2Client (see connections.getAuthorizedClient),
 * which adds and refreshes the access token.
 *
 * Meet API: https://developers.google.com/meet/api/reference/rest/v2
 */

const MEET_API = 'https://meet.googleapis.com/v2';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/** Calls `fetchPage(pageToken)` until there are no more pages, collecting `key` items */
async function collectPages(client, url, key, params = {}, maxPages = 10) {
  const items = [];
  let pageToken;
  for (let page = 0; page < maxPages; page++) {
    const { data } = await client.request({ url, params: { ...params, pageSize: 100, pageToken } });
    items.push(...(data[key] || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

/**
 * Conference records (meetings that happened) that ended at or after `endedAfter`
 * @returns {Promise<Object[]>} [{ name: 'conferenceRecords/…', startTime, endTime, space }]
 */
async function listConferenceRecords(client, { endedAfter }) {
  return collectPages(client, `${MEET_API}/conferenceRecords`, 'conferenceRecords', {
    filter: `end_time>="${endedAfter.toISOString()}"`
  });
}

/**
 * Conference records that started within [from, to)
 * @returns {Promise<Object[]>}
 */
async function listConferenceRecordsBetween(client, { from, to }) {
  return collectPages(client, `${MEET_API}/conferenceRecords`, 'conferenceRecords', {
    filter: `start_time>="${from.toISOString()}" AND start_time<"${to.toISOString()}"`
  });
}

/**
 * One conference record by name ("conferenceRecords/<id>"). Only succeeds for
 * meetings the connected user can access.
 */
async function getConferenceRecord(client, name) {
  const { data } = await client.request({ url: `${MEET_API}/${name}` });
  return data;
}

/** @returns {Promise<Object[]>} participants with signedinUser/anonymousUser/phoneUser */
async function listParticipants(client, conferenceRecordName) {
  return collectPages(client, `${MEET_API}/${conferenceRecordName}/participants`, 'participants');
}

/** @returns {Promise<Object[]>} transcripts: { name, state, docsDestination: { document, exportUri } } */
async function listTranscripts(client, conferenceRecordName) {
  return collectPages(client, `${MEET_API}/${conferenceRecordName}/transcripts`, 'transcripts');
}

/** @returns {Promise<Object[]>} entries: { participant, text, startTime, languageCode } */
async function listTranscriptEntries(client, transcriptName) {
  return collectPages(client, `${MEET_API}/${transcriptName}/entries`, 'transcriptEntries', {}, 50);
}

/**
 * Gemini "Take notes for me" notes for a meeting. Returns [] when the API or
 * feature isn't available for this account.
 * @returns {Promise<Object[]>} smart notes: { name, state, docsDestination: { document, exportUri } }
 */
async function listSmartNotes(client, conferenceRecordName) {
  try {
    return await collectPages(client, `${MEET_API}/${conferenceRecordName}/smartNotes`, 'smartNotes');
  } catch (error) {
    const status = error.response?.status;
    if (status === 400 || status === 403 || status === 404) return [];
    throw error;
  }
}

/** Drive metadata for a Meet-created Doc: { id, name, webViewLink } */
async function getDriveFile(client, fileId) {
  const { data } = await client.request({
    url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    params: { fields: 'id,name,webViewLink', supportsAllDrives: true }
  });
  return data;
}

/** Plain text of a Google Doc created by Meet (transcript or Gemini notes) */
async function exportDocText(client, fileId) {
  const { data } = await client.request({
    url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export`,
    params: { mimeType: 'text/plain' },
    responseType: 'text'
  });
  return typeof data === 'string' ? data : String(data || '');
}

/** True if Google says the refresh token is no longer valid (revoked, expired, password change) */
function isRevokedError(error) {
  const code = error?.response?.data?.error || error?.message || '';
  return String(code).includes('invalid_grant');
}

module.exports = {
  listConferenceRecords,
  listConferenceRecordsBetween,
  getConferenceRecord,
  listParticipants,
  listTranscripts,
  listTranscriptEntries,
  listSmartNotes,
  getDriveFile,
  exportDocText,
  isRevokedError
};
