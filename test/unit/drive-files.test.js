const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { readDriveFile, isDriveFileId } = require('../../src/integrations/google/drive-files');
const { buildCsp } = require('../../src/middleware/auth');

const FILE = '1AbCdEfGhIjKlMnOp_-q';
const TOKEN = 'ya29.test-token';

/** A fetch stub: metadata for the file, then the body for export / alt=media */
function driveStub({ meta, body = '', status = 200, bodyStatus = 200, calls = [] }) {
  return async (url, init) => {
    calls.push({ url, auth: init && init.headers && init.headers.Authorization });
    const isMeta = url.includes('fields=');
    const code = isMeta ? status : bodyStatus;
    const payload = isMeta ? JSON.stringify(meta) : body;
    return new Response(payload, { status: code, headers: { 'content-type': isMeta ? 'application/json' : 'application/octet-stream' } });
  };
}

describe('reading a picked Drive file', () => {
  test('a Google Doc is exported as plain text, with the token and a fixed Drive URL', async () => {
    const calls = [];
    const result = await readDriveFile(FILE, TOKEN, { fetchImpl: driveStub({ meta: { name: 'Glosario', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-01T10:00:00Z' }, body: 'CAC: costo de adquisición', calls }) });
    assert.equal(result.name, 'Glosario');
    assert.equal(result.text, 'CAC: costo de adquisición');
    assert.deepEqual(result.source, { type: 'google_drive', file_id: FILE, mime_type: 'application/vnd.google-apps.document', modified_time: '2026-10-01T10:00:00Z' });
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.url.startsWith(`https://www.googleapis.com/drive/v3/files/${FILE}`)));
    assert.ok(calls[1].url.includes('/export?mimeType=text%2Fplain'));
    assert.ok(calls.every(call => call.auth === `Bearer ${TOKEN}`));
  });

  test('a Sheet is exported as CSV', async () => {
    const calls = [];
    const result = await readDriveFile(FILE, TOKEN, { fetchImpl: driveStub({ meta: { name: 'Clientes', mimeType: 'application/vnd.google-apps.spreadsheet' }, body: 'a,b\n1,2', calls }) });
    assert.equal(result.text, 'a,b\n1,2');
    assert.ok(calls[1].url.includes('mimeType=text%2Fcsv'));
  });

  test('a text file is downloaded and read', async () => {
    const calls = [];
    const result = await readDriveFile(FILE, TOKEN, { fetchImpl: driveStub({ meta: { name: 'notes.md', mimeType: 'text/markdown', size: '20' }, body: '# Products\nAcme Pay', calls }) });
    assert.match(result.text, /Acme Pay/);
    assert.ok(calls[1].url.includes('alt=media'));
  });

  test('refuses other types, big files and bad input without calling Drive for the content', async () => {
    const calls = [];
    const image = await readDriveFile(FILE, TOKEN, { fetchImpl: driveStub({ meta: { name: 'logo.png', mimeType: 'image/png' }, calls }) });
    assert.equal(image.code, 'unsupported');
    const big = await readDriveFile(FILE, TOKEN, { fetchImpl: driveStub({ meta: { name: 'big.pdf', mimeType: 'application/pdf', size: String(6 * 1024 * 1024) }, calls }) });
    assert.equal(big.code, 'too_large');
    assert.equal(calls.filter(call => !call.url.includes('fields=')).length, 0);

    assert.equal((await readDriveFile('../etc/passwd', TOKEN, { fetchImpl: driveStub({ meta: {}, calls }) })).status, 400);
    assert.equal((await readDriveFile(FILE, 'has space', { fetchImpl: driveStub({ meta: {}, calls }) })).status, 400);
    assert.equal((await readDriveFile(FILE, { $ne: 1 }, { fetchImpl: driveStub({ meta: {}, calls }) })).status, 400);
    assert.equal(isDriveFileId('https://evil.example/x'), false);
  });

  test('Drive errors become clear answers', async () => {
    const expired = await readDriveFile(FILE, TOKEN, { fetchImpl: driveStub({ meta: {}, status: 401 }) });
    assert.deepEqual([expired.status, expired.code], [401, 'expired']);
    const hidden = await readDriveFile(FILE, TOKEN, { fetchImpl: driveStub({ meta: {}, status: 404 }) });
    assert.deepEqual([hidden.status, hidden.code], [404, 'cant_open']);
    const down = await readDriveFile(FILE, TOKEN, { fetchImpl: driveStub({ meta: { mimeType: 'text/plain' }, bodyStatus: 500 }) });
    assert.deepEqual([down.status, down.code], [502, 'drive_down']);
  });
});

describe('content security policy', () => {
  test('is strict by default and opens only Google’s Picker sources when asked', () => {
    const strict = buildCsp();
    assert.match(strict, /script-src 'self' 'unsafe-inline';/);
    assert.doesNotMatch(strict, /google\.com|frame-src/);
    const picker = buildCsp({ drivePicker: true });
    assert.match(picker, /script-src 'self' 'unsafe-inline' https:\/\/apis\.google\.com https:\/\/accounts\.google\.com\/gsi\/client;/);
    assert.match(picker, /frame-src https:\/\/docs\.google\.com/);
    assert.match(picker, /frame-ancestors 'none'/);
  });
});
