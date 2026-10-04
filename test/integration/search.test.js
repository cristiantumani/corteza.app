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
      doc(2, 'Buk renueva el contrato en octubre', { source_details: { title: 'Reunión con Buk' }, capture: 'ai', review_status: 'confirmed', evidence_quote: 'Renovamos en octubre' }),
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
    const second = results.all.find(r => r.id === 2);
    assert.equal(second.review_status, 'confirmed', 'Search shows whether an AI capture was reviewed');
    assert.equal(second.evidence_quote, 'Renovamos en octubre', 'and its supporting quote');

    const without = await search.keywordSearch(query, { workspace_id: 'WSRCH', space_id: 'sp1', excludeIds: [1] });
    assert.deepEqual(without.all.map(r => r.id), [2], 'sources marked unrelated are left out');
  });

  test('the latest outcomes of a space can be read as candidates, without embeddings or excluded ones', async () => {
    const recent = await search.recentOutcomes({ workspace_id: 'WSRCH', space_id: 'sp1', excludeIds: [4] });
    assert.deepEqual(recent.map(r => r.id), [3, 2, 1], 'newest first, only this space, #4 excluded');
    assert.ok(recent.every(r => r.embedding === undefined));
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

  test('a question about someone\'s pending work returns their open action items with the answer', async () => {
    await db.collection('workspace_spaces').insertOne({ workspace_id: 'WSRCH', space_id: 'sp1', name: 'My space', visibility: 'public', archived: false });
    await db.collection('action_items').insertMany([
      { item_id: 'ai1', workspace_id: 'WSRCH', space_id: 'sp1', text: 'Enviar el deck a Buk', owners: [{ name: 'Nicolle Reveco', user_id: null }], owner_ids: [], status: 'open', due_date: '2026-09-25', created_at: new Date() },
      { item_id: 'ai2', workspace_id: 'WSRCH', space_id: 'sp1', text: 'Revisar contratos', owners: [{ name: 'Martín', user_id: 'U9' }], owner_ids: ['U9'], status: 'open', due_date: null, created_at: new Date() },
      { item_id: 'ai3', workspace_id: 'WSRCH', space_id: 'sp1', text: 'Ya hecho', owners: [{ name: 'Nicolle Reveco', user_id: null }], owner_ids: [], status: 'done', due_date: null, created_at: new Date() },
      { item_id: 'ai4', workspace_id: 'WSRCH', space_id: 'sp2', text: 'Otro espacio', owners: [{ name: 'Nicolle Reveco', user_id: null }], owner_ids: [], status: 'open', due_date: null, created_at: new Date() }
    ]);

    const { handleSemanticSearch } = require('../../src/routes/semantic-search-api');
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handleSemanticSearch({
      session: { user: { workspace_id: 'WSRCH', user_id: 'U1' } },
      body: { query: "What's still pending from Nicolle?", space_id: 'sp1' }
    }, res);

    assert.equal(res.code, 200);
    assert.deepEqual(res.body.action_items.map(item => item.item_id), ['ai1'], 'open, in this space, owned by Nicolle');
    assert.ok(res.body.response, 'an answer is returned even without matching outcomes');
  });
});
