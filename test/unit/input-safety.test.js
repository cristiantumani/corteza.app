const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { findForbiddenKey, rejectOperatorKeys, jsonBodyErrors } = require('../../src/middleware/input-safety');

test('operator and __proto__ keys are found at any depth; normal bodies pass', () => {
  assert.equal(findForbiddenKey({ suggestion_id: { $ne: '' } }), 'suggestion_id.$ne');
  assert.equal(findForbiddenKey({ edits: { tags: [{ $gt: 1 }] } }), 'edits.tags.0.$gt');
  assert.equal(findForbiddenKey(JSON.parse('{"a":{"__proto__":{"admin":true}}}')), 'a.__proto__');
  assert.equal(findForbiddenKey({ text: 'costs $5 and uses $ne in prose', tags: ['a'], edits: { decision_text: 'x' } }), null);
  assert.equal(findForbiddenKey(null), null);
  assert.equal(findForbiddenKey('plain'), null);
});

/** An app wired like src/index.js: global JSON parser, the check, routes, JSON errors */
async function withApp(routes, run) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(rejectOperatorKeys);
  routes(app);
  app.use(jsonBodyErrors);
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

test('requests with operators are refused before any route; malformed JSON is a JSON 400', async () => {
  let reached = 0;
  await withApp(app => app.post('/x', (req, res) => { reached++; res.json({ ok: true, body: req.body }); }), async base => {
    const refused = await postJson(`${base}/x`, JSON.stringify({ suggestion_id: { $ne: '' } }));
    assert.equal(refused.status, 400);
    assert.equal(reached, 0);

    const ok = await postJson(`${base}/x`, JSON.stringify({ suggestion_id: 'ai_sugg_1', note: 'price is $5' }));
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).body, { suggestion_id: 'ai_sugg_1', note: 'price is $5' });

    const broken = await postJson(`${base}/x`, '{"oops":');
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).error, 'Invalid JSON');
  });
});

test('routes that used to read the raw body work with the global parser (demo search)', async () => {
  const { handleDemoSearch } = require('../../src/routes/demo');
  await withApp(app => app.post('/demo/api/search', handleDemoSearch), async base => {
    const response = await postJson(`${base}/demo/api/search`, JSON.stringify({ query: 'pricing' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    const missing = await postJson(`${base}/demo/api/search`, JSON.stringify({}));
    assert.equal(missing.status, 400);
  });
});
