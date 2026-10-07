const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Services log while the test runner reads results from stdout; mixed output can
// break the runner ("Unable to deserialize cloned data"), as in meet-import.test.js
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const WS = 'WCTX';
const ADMIN = { workspace_id: WS, user_id: 'UA', user_name: 'Ana' };
const MEMBER = { workspace_id: WS, user_id: 'UB', user_name: 'Bob' };

describe('context for the AI', { skip }, () => {
  let db;
  let cleanup;
  let server;
  let base;
  let context;

  /** Calls the API as a signed-in person (session stubbed) */
  async function call(user, method, path, body) {
    const headers = { 'x-test-user': JSON.stringify(user) };
    const init = { method, headers };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const response = await fetch(base + path, init);
    return { status: response.status, body: await response.json() };
  }

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    context = require('../../src/core/context/context-service');
    await db.collection('workspace_admins').insertOne({ workspace_id: WS, user_id: 'UA', role: 'admin', deactivated_at: null });

    const app = express();
    app.use((req, res, next) => { req.session = { user: JSON.parse(req.headers['x-test-user']) }; next(); });
    app.use(require('../../src/http/ai-context'));
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) server.close();
    if (cleanup) await cleanup();
  });

  test('an admin edits the company context; a member reads it but cannot change it', async () => {
    const saved = await call(ADMIN, 'PUT', '/api/ai-context/company', { description: '  Ninja Excel teaches Excel.  ', glossary: 'CAC: customer acquisition cost' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.company.description, 'Ninja Excel teaches Excel.');

    const denied = await call(MEMBER, 'PUT', '/api/ai-context/company', { description: 'hijacked' });
    assert.equal(denied.status, 403);

    const read = await call(MEMBER, 'GET', '/api/ai-context');
    assert.equal(read.body.can_edit_company, false);
    assert.equal(read.body.company.description, 'Ninja Excel teaches Excel.');
    assert.equal((await call(ADMIN, 'GET', '/api/ai-context')).body.can_edit_company, true);
  });

  test('personal context is private to each person', async () => {
    await call(MEMBER, 'PUT', '/api/ai-context/me', { role: 'Sales lead', focus: 'Spain' });
    assert.equal((await call(MEMBER, 'GET', '/api/ai-context')).body.personal.role, 'Sales lead');
    assert.equal((await call(ADMIN, 'GET', '/api/ai-context')).body.personal.role, '', "Ana doesn't get Bob's");
  });

  test('admins upload documents as text, within limits, and only admins can remove them', async () => {
    const form = new FormData();
    form.append('file', new Blob(['José Tomás Acuña: finance\nNicolás Renz: operations'], { type: 'text/plain' }), 'org-chart.txt');
    const uploaded = await call(ADMIN, 'POST', '/api/ai-context/company/documents', form);
    assert.equal(uploaded.status, 200);
    const [doc] = uploaded.body.company.documents;
    assert.equal(doc.name, 'org-chart.txt');
    assert.match(doc.preview, /José Tomás/);
    assert.equal(doc.text, undefined, 'the browser gets a preview, not the whole text');

    const memberForm = new FormData();
    memberForm.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    assert.equal((await call(MEMBER, 'POST', '/api/ai-context/company/documents', memberForm)).status, 403);
    assert.equal((await call(MEMBER, 'DELETE', `/api/ai-context/company/documents/${doc.doc_id}`)).status, 403);

    const tooMuch = await context.addCompanyDocument(WS, { name: 'big', text: 'a'.repeat(context.LIMITS.documentText) }, { user_id: 'UA' });
    assert.ok(tooMuch.document, 'one document fits');
    const over = await context.addCompanyDocument(WS, { name: 'big2', text: 'b'.repeat(context.LIMITS.documentText) }, { user_id: 'UA' });
    assert.match(over.error, /add up to/);

    const removed = await call(ADMIN, 'DELETE', `/api/ai-context/company/documents/${doc.doc_id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.company.documents.map(d => d.name), ['big']);
  });

  test('admins add a document from Google Drive and update it later; the token is only used to read it', async () => {
    await db.collection('ai_context').updateOne({ workspace_id: WS, user_id: null }, { $set: { documents: [] } });
    const FILE = '1DriveFileId_abcdef';
    let version = 'Acme Pay: payments product';
    const seen = [];
    const realFetch = globalThis.fetch;
    // Google's side, stubbed: metadata, then the Doc exported as text
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://www.googleapis.com/')) return realFetch(url, init);
      seen.push(init.headers.Authorization);
      if (init.headers.Authorization !== 'Bearer good-token') return new Response('{}', { status: 401 });
      if (String(url).includes('fields=')) return Response.json({ name: 'Product list', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-01T00:00:00Z' });
      return new Response(version);
    };
    try {
      assert.equal((await call(MEMBER, 'POST', '/api/ai-context/company/documents/drive', { file_id: FILE, access_token: 'good-token' })).status, 403);
      assert.equal(seen.length, 0, 'a member never reaches Drive');
      assert.equal((await call(ADMIN, 'POST', '/api/ai-context/company/documents/drive', { file_id: 'bad id!', access_token: 'good-token' })).status, 400);

      const added = await call(ADMIN, 'POST', '/api/ai-context/company/documents/drive', { file_id: FILE, access_token: 'good-token' });
      assert.equal(added.status, 200);
      const doc = added.body.company.documents.find(d => d.doc_id === added.body.doc_id);
      assert.equal(doc.name, 'Product list');
      assert.equal(doc.from_drive, true);
      assert.match(doc.preview, /Acme Pay/);
      const stored = (await context.getCompanyContext(WS)).documents.find(d => d.doc_id === doc.doc_id);
      assert.deepEqual(stored.source, { type: 'google_drive', file_id: FILE, mime_type: 'application/vnd.google-apps.document', modified_time: '2026-10-01T00:00:00Z' });
      assert.doesNotMatch(JSON.stringify(stored), /good-token/, 'the token is never stored');

      const expired = await call(ADMIN, 'POST', `/api/ai-context/company/documents/${doc.doc_id}/refresh`, { access_token: 'old-token' });
      assert.deepEqual([expired.status, expired.body.code], [401, 'expired']);

      version = 'Acme Pay: payments product\nAcme Books: accounting';
      const refreshed = await call(ADMIN, 'POST', `/api/ai-context/company/documents/${doc.doc_id}/refresh`, { access_token: 'good-token' });
      assert.equal(refreshed.status, 200);
      assert.equal(refreshed.body.company.documents.length, 1, 'replaced in place');
      assert.match(refreshed.body.company.documents[0].preview, /Acme Books/);
      if (process.env.FIELD_ENCRYPTION === 'on') {
        const raw = await require('../../src/config/database').getRawDatabase().collection('ai_context').findOne({ workspace_id: WS, user_id: null });
        assert.doesNotMatch(JSON.stringify(raw.documents), /Acme Books/, 'the replaced text is stored encrypted');
      }
      assert.equal(refreshed.body.company.documents[0].doc_id, doc.doc_id);

      const form = new FormData();
      form.append('file', new Blob(['plain'], { type: 'text/plain' }), 'plain.txt');
      const upload = await call(ADMIN, 'POST', '/api/ai-context/company/documents', form);
      const plain = upload.body.company.documents.find(d => d.name === 'plain.txt');
      assert.equal(plain.from_drive, false);
      assert.equal((await call(ADMIN, 'POST', `/api/ai-context/company/documents/${plain.doc_id}/refresh`, { access_token: 'good-token' })).status, 400);
      assert.equal((await call(ADMIN, 'POST', '/api/ai-context/company/documents/ctxdoc_missing/refresh', { access_token: 'good-token' })).status, 404);
    } finally {
      globalThis.fetch = realFetch;
      await db.collection('ai_context').updateOne({ workspace_id: WS, user_id: null }, { $set: { documents: [] } });
    }
  });

  test("the extraction prompt gets the company's context and the capturer's own", async () => {
    const forBob = await context.buildContextBlock(WS, 'UB', 'Bob');
    assert.match(forBob, /Ninja Excel teaches Excel/);
    assert.match(forBob, /<capturer_context of="Bob">\n<role>\nSales lead/);
    const forAna = await context.buildContextBlock(WS, 'UA', 'Ana');
    assert.doesNotMatch(forAna, /Sales lead/);
    assert.equal(await context.buildContextBlock('WEMPTY', 'U9'), '');
  });
});
