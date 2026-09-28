const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

// Keep the node:test IPC on stdout clean (see meet-import.test.js)
console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('Search: keyword relevance, excluded sources, feedback', { skip }, () => {
  let db;
  let cleanup;
  let search;
  let server;
  let base;
  let sessionUser;

  const doc = (id, text, extra = {}) => ({
    id, workspace_id: 'WSRCH', space_id: 'sp1', text, type: 'decision', tags: [],
    timestamp: new Date(Date.UTC(2026, 8, id)).toISOString(), embedding: [0.1, 0.2], ...extra
  });

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    search = require('../../src/services/semantic-search');
    await db.collection('decisions').insertMany([
      doc(1, 'Presentar al directorio de Buk tres escenarios en octubre'),
      doc(2, 'Buk renueva el contrato en octubre', { source_details: { title: 'Reunión con Buk' } }),
      doc(3, 'Confirmar el presupuesto de marketing con el equipo'),
      doc(4, 'El directorio aprueba el plan anual'),
      doc(5, 'Octubre: lanzamiento en Chile', { space_id: 'sp2' })
    ]);

    const app = express();
    app.use((req, res, next) => { req.session = { user: sessionUser }; next(); });
    app.use(require('../../src/http/search-feedback'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.close();
    await cleanup();
  });

  test('keyword search keeps sources with enough of the question\'s words, in the space, without embeddings', async () => {
    const query = 'Que hemos acordado de cara al directorio con Buk en Octubre?';
    const results = await search.keywordSearch(query, { workspace_id: 'WSRCH', space_id: 'sp1', limit: 8 });
    assert.deepEqual(results.all.map(r => r.id), [1, 2], '#3 only shares "con", #4 only "directorio", #5 is another space');
    assert.equal(results.all[0].score, 1, 'all three keywords');
    assert.ok(results.all.every(r => r.embedding === undefined), 'embeddings are never sent');

    const without = await search.keywordSearch(query, { workspace_id: 'WSRCH', space_id: 'sp1', excludeIds: [1] });
    assert.deepEqual(without.all.map(r => r.id), [2], 'sources marked unrelated are left out');
  });

  test('feedback on a source is saved once per user, question and source', async () => {
    const send = body => fetch(`${base}/api/search-feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.status);

    sessionUser = null;
    assert.equal(await send({ query: 'q', decision_id: 1, relevant: false }), 401);

    sessionUser = { workspace_id: 'WSRCH', user_id: 'U1' };
    assert.equal(await send({ query: 'Buk en octubre', decision_id: 1, relevant: false }), 200);
    assert.equal(await send({ query: 'Buk en octubre', decision_id: 1, relevant: true }), 200);
    assert.equal(await send({ query: 'Buk en octubre', decision_id: 99, relevant: true }), 404);
    assert.equal(await send({ query: '', decision_id: 1, relevant: true }), 400);
    assert.equal(await send({ query: 'x', decision_id: 1, relevant: 'yes' }), 400);

    const rows = await db.collection('search_feedback').find({ workspace_id: 'WSRCH' }).toArray();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relevant, true, 'the latest answer wins');

    sessionUser = { workspace_id: 'WOTHER', user_id: 'U1' };
    assert.equal(await send({ query: 'Buk en octubre', decision_id: 1, relevant: true }), 404, 'other workspaces cannot rate it');
  });
});
