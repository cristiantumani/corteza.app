const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateBudget, aiLimits, usageDay } = require('../../src/core/usage/ai-usage');

const limits = { userCalls: 3, workspaceTokens: 1000 };

test('a call fits while both the person and the workspace are under their daily caps', () => {
  assert.deepEqual(evaluateBudget({ userCalls: 2, workspaceTokens: 999 }, limits), { ok: true });
});

test("the person's daily calls and the workspace's daily tokens each stop AI calls", () => {
  assert.equal(evaluateBudget({ userCalls: 3, workspaceTokens: 0 }, limits).reason, 'user_daily');
  assert.equal(evaluateBudget({ userCalls: 0, workspaceTokens: 1000 }, limits).reason, 'workspace_daily');
  assert.deepEqual(evaluateBudget({ userCalls: 99, workspaceTokens: 0 }, limits, { checkUser: false }), { ok: true }, 'no person behind it (Slack, imports): workspace cap only');
});

test('caps come from the environment, with safe defaults', () => {
  delete process.env.AI_DAILY_CALLS_PER_USER;
  delete process.env.AI_DAILY_TOKENS_PER_WORKSPACE;
  assert.deepEqual(aiLimits(), { userCalls: 150, workspaceTokens: 3000000 });
  process.env.AI_DAILY_CALLS_PER_USER = '20';
  process.env.AI_DAILY_TOKENS_PER_WORKSPACE = 'lots';
  assert.deepEqual(aiLimits(), { userCalls: 20, workspaceTokens: 3000000 });
  delete process.env.AI_DAILY_CALLS_PER_USER;
  delete process.env.AI_DAILY_TOKENS_PER_WORKSPACE;
});

test('usage is counted per UTC day', () => {
  assert.equal(usageDay(new Date('2026-10-01T23:59:00Z')), '2026-10-01');
});
