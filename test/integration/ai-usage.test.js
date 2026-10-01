const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe('AI usage: recorded per person and day, capped per day', { skip }, () => {
  const WS = 'WAIU';
  const NOW = new Date('2026-10-01T10:00:00Z');
  const response = { usage: { input_tokens: 400, output_tokens: 100 } };
  let cleanup;
  let usage;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    usage = require('../../src/core/usage/ai-usage');
    process.env.AI_DAILY_CALLS_PER_USER = '2';
    process.env.AI_DAILY_TOKENS_PER_WORKSPACE = '1200';
  });

  after(async () => {
    delete process.env.AI_DAILY_CALLS_PER_USER;
    delete process.env.AI_DAILY_TOKENS_PER_WORKSPACE;
    if (cleanup) await cleanup();
  });

  test("each call adds to the person's and the workspace's totals for the day", async () => {
    await usage.recordAiUsage({ workspaceId: WS, userId: 'UA', feature: 'search_answer', response, now: NOW });
    await usage.recordAiUsage({ workspaceId: WS, userId: 'UA', feature: 'extraction', response, now: NOW });
    await usage.recordAiUsage({ workspaceId: WS, userId: null, feature: 'extraction', response, now: NOW });
    assert.deepEqual(await usage.getUsage(WS, 'UA', NOW), { userCalls: 2, workspaceTokens: 1500 });
    assert.deepEqual(await usage.getUsage(WS, 'UB', NOW), { userCalls: 0, workspaceTokens: 1500 });
    assert.deepEqual(await usage.getUsage(WS, 'UA', new Date('2026-10-02T10:00:00Z')), { userCalls: 0, workspaceTokens: 0 }, 'a new day starts at zero');
    assert.deepEqual(await usage.getUsage('WOTHER', 'UA', NOW), { userCalls: 0, workspaceTokens: 0 }, 'other workspaces are separate');
  });

  test('over the cap, AI requests answer 429 with a readable message', async () => {
    assert.equal((await usage.checkAiBudget(WS, 'UA', NOW)).reason, 'workspace_daily');

    const app = express();
    app.use((req, res, next) => { req.session = { user: { workspace_id: WS, user_id: 'UA' } }; next(); });
    app.post('/ai', usage.requireAiBudget, (req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    try {
      // The middleware checks today's real date: record today's usage too
      await usage.recordAiUsage({ workspaceId: WS, userId: 'UA', feature: 'extraction', response: { usage: { input_tokens: 5000 } } });
      const res = await fetch(`http://127.0.0.1:${server.address().port}/ai`, { method: 'POST' });
      assert.equal(res.status, 429);
      const body = await res.json();
      assert.equal(body.reason, 'workspace_daily');
      assert.match(body.message, /today's AI limit/);
    } finally {
      server.close();
    }
  });

  test('over the workspace cap, imports of past meetings are skipped (no AI call); new meetings are still captured', async () => {
    const { ingestTranscript } = require('../../src/ingestion/pipeline');
    let calls = 0;
    const extract = async () => { calls++; return { decisions: [] }; };
    const meeting = id => ({
      workspaceId: WS, source: 'google_meet', externalId: id, title: 'Weekly', spaceId: 'S1',
      author: { user_id: 'UA', name: 'Ana' }, text: Array(60).fill('word').join(' ')
    });

    const imported = await ingestTranscript(meeting('old-1'), { extract, manual: true });
    assert.equal(imported.status, 'skipped');
    assert.equal(calls, 0);
    const db = require('../../src/config/database').getDatabase();
    assert.equal((await db.collection('ingestions').findOne({ external_id: 'old-1' })).skip_reason, 'ai_budget');

    const live = await ingestTranscript(meeting('new-1'), { extract });
    assert.equal(live.status, 'completed');
    assert.equal(calls, 1);
  });
});
