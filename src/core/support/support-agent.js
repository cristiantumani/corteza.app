const crypto = require('crypto');
const { getDatabase } = require('../../config/database');
const { recordAiUsage } = require('../usage/ai-usage');

/**
 * Help inside Corteza (docs/specs/2026-10-support-agent.md): a Claude Managed Agent ("Encarta", set up
 * in the Anthropic Console) answers from corteza.app's published pages; what it can't answer it
 * passes to Cristian by email through the custom tool `escalate_to_human`, which this server runs.
 *
 * One conversation = one Managed Agents session, with a spend cap. Corteza keeps only ids and dates
 * (`support_conversations`); the conversation itself lives in the session at Anthropic. People get
 * SUPPORT_DAILY_MESSAGES messages a day (default 20).
 *
 * Collections:
 *   support_conversations  { conversation_id, workspace_id, user_id, session_id, created_at, last_message_at,
 *                            messages, escalated_at, input_tokens, output_tokens }
 *   support_usage          { workspace_id, user_id, day, messages }
 */

const ESCALATE_TOOL = 'escalate_to_human';
const MAX_TEXT = 2000;
const TURN_TIMEOUT_MS = 120 * 1000;

const conversations = () => getDatabase().collection('support_conversations');
const usage = () => getDatabase().collection('support_usage');

/**
 * The agent's settings; null when help is off (no agent configured)
 * @returns {{ agentId: string, environmentId: string, escalationEmail: string, dailyMessages: number, sessionBudgetCents: string }|null}
 */
function supportConfig() {
  const agentId = (process.env.SUPPORT_AGENT_ID || '').trim();
  const environmentId = (process.env.SUPPORT_ENVIRONMENT_ID || '').trim();
  if (!agentId || !environmentId) return null;
  const daily = parseInt(process.env.SUPPORT_DAILY_MESSAGES || '', 10);
  const budget = parseInt(process.env.SUPPORT_SESSION_BUDGET_CENTS || '', 10);
  return {
    agentId,
    environmentId,
    escalationEmail: (process.env.SUPPORT_ESCALATION_EMAIL || process.env.FEEDBACK_EMAIL || 'cristian@corteza.app').trim(),
    dailyMessages: Number.isInteger(daily) && daily > 0 ? daily : 20,
    sessionBudgetCents: String(Number.isInteger(budget) && budget > 0 ? budget : 100) // $1.00 per conversation
  };
}

/** @returns {any} the Anthropic client (createAnthropic: billing failures raise the ops alert) */
function defaultClient() {
  const { createAnthropic } = require('../../integrations/anthropic/client');
  return createAnthropic();
}

/** 'YYYY-MM-DD' in UTC */
function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Counts one message against today's limit; false when the person already used it up
 * @param {string} workspaceId
 * @param {string} userId
 * @param {number} limit
 * @param {Date} [now]
 * @returns {Promise<boolean>}
 */
async function takeDailyMessage(workspaceId, userId, limit, now = new Date()) {
  const key = { workspace_id: workspaceId, user_id: userId, day: today(now) };
  const current = await usage().findOne(key, { projection: { _id: 0, messages: 1 } });
  if (current && current.messages >= limit) return false;
  await usage().updateOne(key, { $inc: { messages: 1 }, $set: { updated_at: now } }, { upsert: true });
  return true;
}

/**
 * The person's conversation, or a new one with its own capped session
 * @param {any} client
 * @param {{ agentId: string, environmentId: string, sessionBudgetCents: string }} config
 * @param {{ workspace_id: string, user_id: string }} user
 * @param {unknown} conversationId
 * @returns {Promise<{ conversation: any, isNew: boolean }|null>} null: not this person's conversation
 */
async function openConversation(client, config, user, conversationId) {
  if (typeof conversationId === 'string' && conversationId) {
    const existing = await conversations().findOne({ conversation_id: conversationId, workspace_id: user.workspace_id, user_id: user.user_id });
    return existing ? { conversation: existing, isNew: false } : null;
  }
  const session = await client.beta.sessions.create({
    agent: config.agentId,
    environment_id: config.environmentId,
    title: 'Corteza help',
    budget: { type: 'limit', max_list_cost: { amount: config.sessionBudgetCents, currency: 'USD' } }
  });
  const conversation = {
    conversation_id: `sup_${crypto.randomBytes(12).toString('hex')}`,
    workspace_id: user.workspace_id,
    user_id: user.user_id,
    session_id: session.id,
    created_at: new Date(),
    last_message_at: null,
    messages: 0,
    escalated_at: null,
    input_tokens: 0,
    output_tokens: 0
  };
  await conversations().insertOne(conversation);
  return { conversation, isNew: true };
}

/**
 * The message the agent gets: on a conversation's first turn, a line of context (first name,
 * language, the page help was opened from; never the email or ids)
 * @param {string} text
 * @param {{ firstName?: string|null, language?: string, page?: string|null }} context
 * @param {boolean} first
 * @returns {string}
 */
function agentMessage(text, context, first) {
  if (!first) return text;
  const parts = [
    context.firstName ? `name: ${context.firstName}` : null,
    `language: ${context.language === 'es' ? 'Spanish' : 'English'}`,
    context.page ? `opened help from: ${context.page}` : null
  ].filter(Boolean);
  return `[Context from Corteza: ${parts.join('; ')}]\n\n${text}`;
}

/**
 * Runs escalate_to_human: emails Cristian the case, marks the conversation escalated
 * @param {Object} input - the agent's tool input { question, searched, found?, hypothesis }
 * @param {{ conversation: any, user: any, config: any, sendEmail?: Function }} ctx
 * @returns {Promise<string>} the tool result for the agent
 */
async function escalate(input, { conversation, user, config, sendEmail }) {
  const mailer = require('../../utils/n8n-client');
  const send = sendEmail || mailer.sendEmail;
  const field = value => (typeof value === 'string' ? value.slice(0, 2000) : '');
  const row = (label, value) => `<tr><td style="padding:6px 16px 6px 0;color:#555;vertical-align:top;">${label}</td><td style="padding:6px 0;white-space:pre-wrap;">${mailer.escapeHtml(value || '-')}</td></tr>`;
  const trace = `https://platform.claude.com/workspaces/default/sessions/${encodeURIComponent(conversation.session_id)}`;
  await send({
    to: config.escalationEmail,
    replyTo: user.email || undefined,
    subject: `[Corteza help] ${user.user_name || user.email || 'A tester'} needs a human`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#111;">
        <h1 style="font-size:20px;margin:0 0 16px;">Encarta passed a help conversation to you</h1>
        <p style="font-size:14px;color:#555;margin:0 0 16px;">Reply to this email to answer ${mailer.escapeHtml(user.user_name || user.email || 'them')} directly. You promised a reply within 24 hours.</p>
        <table style="font-size:14px;border-collapse:collapse;">
          ${row('From', `${user.user_name || ''} <${user.email || ''}>`)}
          ${row('Workspace', user.workspace_name || user.workspace_id)}
          ${row('Question', field(input.question))}
          ${row('Searched', field(input.searched))}
          ${row('Found', field(input.found))}
          ${row('Best guess', field(input.hypothesis))}
        </table>
        <p style="font-size:14px;margin:24px 0 0;"><a href="${trace}">See the whole conversation in the Anthropic Console</a></p>
      </div>`
  });
  await conversations().updateOne({ conversation_id: conversation.conversation_id }, { $set: { escalated_at: new Date() } });
  return 'Sent to Cristian. Tell the person he will reply by email within 24 hours.';
}

/**
 * Sends one message and streams the agent's reply. `onText` gets each piece of text as it arrives.
 * @param {Object} params
 * @param {{ workspace_id: string, user_id: string, user_name?: string, email?: string, workspace_name?: string }} params.user
 * @param {unknown} params.text
 * @param {unknown} [params.conversationId]
 * @param {{ firstName?: string|null, language?: string, page?: string|null }} [params.context]
 * @param {(text: string) => void} params.onText
 * @param {{ client?: any, sendEmail?: Function, now?: Date }} [deps]
 * @returns {Promise<{ error?: string, status?: number, conversation_id?: string, escalated?: boolean, limit_reached?: boolean }>}
 */
async function sendMessage({ user, text, conversationId, context = {}, onText }, deps = {}) {
  const config = supportConfig();
  if (!config) return { error: 'Help is not available', status: 404 };
  const message = typeof text === 'string' ? text.trim().slice(0, MAX_TEXT) : '';
  if (!message) return { error: 'Write your question', status: 400 };
  if (!(await takeDailyMessage(user.workspace_id, user.user_id, config.dailyMessages, deps.now))) {
    return { error: 'You reached today’s help limit', status: 429, limit_reached: true };
  }

  const client = deps.client || defaultClient();
  const opened = await openConversation(client, config, user, conversationId);
  if (!opened) return { error: 'Conversation not found', status: 404 };
  const { conversation, isNew } = opened;

  let escalated = false;
  let budgetReached = false;
  const stream = await client.beta.sessions.events.stream(conversation.session_id);
  // Stream first, then send: the stream only carries events after it opens
  await client.beta.sessions.events.send(conversation.session_id, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: agentMessage(message, context, isNew) }] }]
  });

  const deadline = Date.now() + TURN_TIMEOUT_MS;
  for await (const event of stream) {
    if (Date.now() > deadline) break;
    if (event.type === 'agent.message') {
      for (const block of event.content || []) {
        if (block.type === 'text' && block.text) onText(block.text);
      }
    } else if (event.type === 'agent.custom_tool_use') {
      let result;
      if (event.name === ESCALATE_TOOL) {
        try {
          result = await escalate(event.input || {}, { conversation, user, config, sendEmail: deps.sendEmail });
          escalated = true;
        } catch (error) {
          console.error(`❌ Support escalation email failed for ${user.user_id}:`, error.message);
          result = 'The email to Cristian failed. Ask the person to write to cristian@corteza.app.';
        }
      } else {
        result = `Unknown tool: ${event.name}`;
      }
      await client.beta.sessions.events.send(conversation.session_id, {
        events: [{ type: 'user.custom_tool_result', custom_tool_use_id: event.id, content: [{ type: 'text', text: result }] }]
      });
    } else if ((event.type === 'agent.tool_use' || event.type === 'agent.mcp_tool_use') && event.evaluated_permission === 'ask') {
      // Nobody can approve from the help panel: anything that asks is denied
      await client.beta.sessions.events.send(conversation.session_id, {
        events: [{ type: 'user.tool_confirmation', tool_use_id: event.id, result: 'deny' }]
      });
    } else if (event.type === 'session.status_idle') {
      const reason = event.stop_reason && event.stop_reason.type;
      if (reason === 'budget_reached') budgetReached = true;
      if (reason !== 'requires_action') break;
    } else if (event.type === 'session.status_terminated') {
      break;
    }
  }

  await meter(client, conversation, user);
  return { conversation_id: conversation.conversation_id, escalated, limit_reached: budgetReached };
}

/** Records this turn's tokens (the session reports totals; we record the difference) */
async function meter(client, conversation, user) {
  try {
    const session = await client.beta.sessions.retrieve(conversation.session_id);
    const total = (session && session.usage) || {};
    const input = Number(total.input_tokens || 0) + Number(total.cache_read_input_tokens || 0) + Number(total.cache_creation_input_tokens || 0);
    const output = Number(total.output_tokens || 0);
    const delta = {
      input_tokens: Math.max(0, input - (conversation.input_tokens || 0)),
      output_tokens: Math.max(0, output - (conversation.output_tokens || 0))
    };
    await conversations().updateOne(
      { conversation_id: conversation.conversation_id },
      { $set: { input_tokens: input, output_tokens: output, last_message_at: new Date() }, $inc: { messages: 1 } }
    );
    await recordAiUsage({ workspaceId: user.workspace_id, userId: user.user_id, feature: 'support', response: { usage: delta } });
  } catch (error) {
    console.warn('⚠️  Support usage not recorded:', error.message);
  }
}

module.exports = { supportConfig, sendMessage, agentMessage, takeDailyMessage, escalate, ESCALATE_TOOL };
