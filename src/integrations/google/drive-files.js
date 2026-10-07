const { extractTextFromFile } = require('../../utils/text-extractors');

/**
 * Reads one Drive file the person picked in the Google Picker, with their short-lived
 * `drive.file` token, and returns only its text (docs/specs/2026-10-context-from-drive.md).
 * The token is used for these requests only: never stored or logged.
 */

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const MAX_BYTES = 5 * 1024 * 1024; // same as an upload
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/** Google files: exported, MIME type → export format */
const EXPORTS = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv'
};

/** Other files: downloaded, MIME type → extension text-extractors understands */
const DOWNLOADS = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/csv': 'csv'
};

/** The MIME types the Picker shows */
const PICKABLE_TYPES = [...Object.keys(EXPORTS), ...Object.keys(DOWNLOADS)];

function isDriveFileId(value) {
  return typeof value === 'string' && FILE_ID.test(value);
}

function isAccessToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/\s/.test(value);
}

/** Drive's error status → our error (status for the HTTP answer) */
function driveError(status) {
  if (status === 401) return { status: 401, code: 'expired', error: 'Your Google access expired. Try again.' };
  if (status === 403 || status === 404) return { status: 404, code: 'cant_open', error: 'Corteza can’t open this file. Pick it again from Google Drive.' };
  return { status: 502, code: 'drive_down', error: 'Google Drive didn’t answer. Try again in a minute.' };
}

/** Reads a response body, refusing more than MAX_BYTES */
async function readLimited(response) {
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_BYTES) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length > MAX_BYTES ? null : buffer;
}

/**
 * @param {string} fileId - from the Picker
 * @param {string} accessToken - the person's `drive.file` token
 * @param {{ fetchImpl?: typeof fetch }} [options] - tests pass a stub
 * @returns {Promise<{ name: string, text: string, source: { type: 'google_drive', file_id: string, mime_type: string, modified_time: string|null } } | { error: string, code: string, status: number }>}
 */
async function readDriveFile(fileId, accessToken, { fetchImpl = fetch } = {}) {
  if (!isDriveFileId(fileId) || !isAccessToken(accessToken)) return { status: 400, code: 'invalid', error: 'Pick a file from Google Drive' };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const base = `${DRIVE_FILES}/${encodeURIComponent(fileId)}`;

  const metaResponse = await fetchImpl(`${base}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true`, { headers });
  if (!metaResponse.ok) return driveError(metaResponse.status);
  /** @type {{ name?: unknown, mimeType?: unknown, size?: unknown, modifiedTime?: string }} */
  const meta = await metaResponse.json();
  const mimeType = typeof meta.mimeType === 'string' ? meta.mimeType : '';
  const name = typeof meta.name === 'string' ? meta.name : 'Document';
  const source = { type: /** @type {'google_drive'} */ ('google_drive'), file_id: fileId, mime_type: mimeType, modified_time: meta.modifiedTime || null };

  if (EXPORTS[mimeType]) {
    const response = await fetchImpl(`${base}/export?mimeType=${encodeURIComponent(EXPORTS[mimeType])}`, { headers });
    if (!response.ok) {
      // Drive refuses to export files over 10 MB
      if (response.status === 403) return { status: 400, code: 'too_large', error: 'This file is too large to read. Use a shorter document.' };
      return driveError(response.status);
    }
    const buffer = await readLimited(response);
    if (!buffer) return { status: 400, code: 'too_large', error: 'This file is too large to read. Use a shorter document.' };
    return { name, text: buffer.toString('utf8'), source };
  }

  const extension = DOWNLOADS[mimeType];
  if (!extension) return { status: 400, code: 'unsupported', error: 'Pick a Google Doc, Sheet or Slides, or a PDF, DOCX, TXT, MD or CSV file.' };
  if (Number(meta.size) > MAX_BYTES) return { status: 400, code: 'too_large', error: 'Files can be up to 5 MB.' };
  const response = await fetchImpl(`${base}?alt=media&supportsAllDrives=true`, { headers });
  if (!response.ok) return driveError(response.status);
  const buffer = await readLimited(response);
  if (!buffer) return { status: 400, code: 'too_large', error: 'Files can be up to 5 MB.' };
  const extracted = await extractTextFromFile(buffer, `file.${extension}`, mimeType);
  if (!extracted.success) return { status: 400, code: 'unreadable', error: extracted.error || 'Could not read the file' };
  return { name, text: extracted.text, source };
}

module.exports = { readDriveFile, isDriveFileId, isAccessToken, PICKABLE_TYPES, MAX_BYTES };
