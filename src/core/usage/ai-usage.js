const { getDatabase } = require('../../config/database');

/**
 * AI usage per workspace and person, per day, with daily caps so a bug, a loop or one heavy
 * user can't run up the Anthropic bill.
 *
 * Collection `ai_usage`, one document per workspace, person and UTC day:
 *   { workspace_id, user_id ('' for work with no person behind it, e.g. Slack), day: 'YYYY-MM-DD',
 *     calls, input_tokens, output_tokens, features: { extraction: { calls, tokens }, … }, updated_at }
 *
 * Every Claude call records itself (recordAiUsage). Requests people make (search answers,
 * uploads, extraction from text) check the caps first (checkAiBudget / requireAiBudget):
 *   - AI_DAILY_CALLS_PER_USER (default 150): AI calls one person can trigger per day
 *   - AI_DAILY_TOKENS_PER_WORKSPACE (default 3,000,000): input + output tokens per workspace per day
 * Automatic Google Meet capture is recorded but never blocked (one call per real meeting);
 * imports of past meetings stop at the workspace cap and can be resumed the next day.
 */

const DEFAULT_USER_CALLS = 150;
const DEFAULT_WORKSPACE_TOKENS = 3000000;

function collection() {
  return getDatabase().collection('ai_usage');
}

function positiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** @returns {{ userCalls: number, workspaceTokens: number }} */
function aiLimits() {
  return {
    userCalls: positiveInt(process.env.AI_DAILY_CALLS_PER_USER, DEFAULT_USER_CALLS),
    workspaceTokens: positiveInt(process.env.AI_DAILY_TOKENS_PER_WORKSPACE, DEFAULT_WORKSPACE_TOKENS)
  };
}

/** @param {Date} [now] @returns {string} UTC day, 'YYYY-MM-DD' */
function usageDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Whether one more AI call fits in today's caps
 * @param {{ userCalls: number, workspaceTokens: number }} usage - today's usage so far
 * @param {{ userCalls: number, workspaceTokens: number }} limits
 * @param {{ checkUser?: boolean }} [options] - checkUser false: workspace cap only (no person behind the call)
 * @returns {{ ok: boolean, reason?: 'user_daily'|'workspace_daily', message?: string }}
 */
function evaluateBudget(usage, limits, { checkUser = true } = {}) {
  if (usage.workspaceTokens >= limits.workspaceTokens) {
    return { ok: false, reason: 'workspace_daily', message: "Your workspace reached today's AI limit. It resets at midnight UTC." };
  }
  if (checkUser && usage.userCalls >= limits.userCalls) {
    return { ok: false, reason: 'user_daily', message: "You reached today's AI limit. It resets at midnight UTC." };
  }
  return { ok: true };
}

/**
 * Today's usage for a workspace and (optionally) one person in it
 * @param {string} workspaceId
 * @param {string|null} [userId]
 * @param {Date} [now]
 * @returns {Promise<{ userCalls: number, workspaceTokens: number }>}
 */
async function getUsage(workspaceId, userId = null, now = new Date()) {
  const rows = await collection()
    .find({ workspace_id: workspaceId, day: usageDay(now) }, { projection: { user_id: 1, calls: 1, input_tokens: 1, output_tokens: 1 } })
    .toArray();
  let workspaceTokens = 0;
  let userCalls = 0;
  for (const row of rows) {
    workspaceTokens += (row.input_tokens || 0) + (row.output_tokens || 0);
    if (userId && row.user_id === userId) userCalls += row.calls || 0;
  }
  return { userCalls, workspaceTokens };
}

/**
 * Checks today's caps before an AI call
 * @param {string} workspaceId
 * @param {string|null} [userId] - null: workspace cap only
 * @param {Date} [now]
 * @returns {Promise<{ ok: boolean, reason?: string, message?: string }>}
 */
async function checkAiBudget(workspaceId, userId = null, now = new Date()) {
  if (!workspaceId) return { ok: true };
  const usage = await getUsage(workspaceId, userId, now);
  return evaluateBudget(usage, aiLimits(), { checkUser: Boolean(userId) });
}

/**
 * Records one AI call. Never throws (usage tracking must not break a request).
 * @param {Object} params
 * @param {string|null} params.workspaceId
 * @param {string|null} [params.userId]
 * @param {string} params.feature - e.g. 'extraction', 'search_answer'
 * @param {Object} [params.response] - Anthropic Message (only usage is read)
 * @param {Date} [params.now]
 */
async function recordAiUsage({ workspaceId, userId = null, feature, response, now = new Date() }) {
  if (!workspaceId) return;
  try {
    const usage = (response && response.usage) || {};
    const input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    const output = usage.output_tokens || 0;
    const key = String(feature || 'other').replace(/[^a-z0-9_]/gi, '_');
    await collection().updateOne(
      { workspace_id: workspaceId, user_id: userId || '', day: usageDay(now) },
      {
        $inc: {
          calls: 1,
          input_tokens: input,
          output_tokens: output,
          [`features.${key}.calls`]: 1,
          [`features.${key}.tokens`]: input + output
        },
        $set: { updated_at: now }
      },
      { upsert: true }
    );
  } catch (error) {
    console.warn('⚠️  Failed to record AI usage:', error.message);
  }
}

/**
 * Express middleware: 429 when the signed-in person or their workspace is over today's AI caps.
 * Put it after the session check (requireAuth / requireSession).
 */
async function requireAiBudget(req, res, next) {
  try {
    const user = req.session?.user;
    if (!user?.workspace_id) return next();
    const budget = await checkAiBudget(user.workspace_id, user.user_id || null);
    if (!budget.ok) {
      console.warn(`🧯 AI limit reached (${budget.reason}) for ${user.user_id} in ${user.workspace_id}`);
      return res.status(429).json({ success: false, error: 'AI limit reached', message: budget.message, reason: budget.reason });
    }
    next();
  } catch (error) {
    // If the check itself fails, don't block people: the per-hour rate limiter still applies
    console.warn('⚠️  AI budget check failed:', error.message);
    next();
  }
}

module.exports = { aiLimits, usageDay, evaluateBudget, getUsage, checkAiBudget, recordAiUsage, requireAiBudget };
