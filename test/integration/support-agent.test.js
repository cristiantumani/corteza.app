const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.warn = () => {};
console.error = () => {};

/**
 * Help inside Corteza (docs/specs/2026-10-support-agent.md): one Managed Agents session per
 * conversation, ids only in Corteza, 20 messages a day, escalate_to_human emails Cristian.
 * The Managed Agents API is a fake in memory here.
 */
describe('Support agent', { skip }, () => {
  const WS = 'WSUPPORT';
  const ANA = { workspace_id: WS, user_id: 'UA', user_name: 'Ana Pérez', email: 'ana@kestrel.com', workspace_name: 'Kestrel Foods' };
  const BRUNO = { workspace_id: WS, user_id: 'UB', user_name: 'Bruno', email: 'bruno@kestrel.com' };
  let cleanup;
  let db;
  let support;

  /**
   * A fake client.beta.sessions: `script(message)` says what the agent does with a user message:
   * { reply } answers; { escalate } calls escalate_to_human, then answers with `after`.
   */
  function fakeAgent(script) {
    const sessions = new Map();
    let seq = 0;
    const created = [];
    const sent = [];
    function queue() {
      const items = [];
      let wake = null;
      return {
        push(event) { items.push(event); if (wake) { wake(); wake = null; } },
        async *[Symbol.asyncIterator]() {
          for (;;) {
            while (items.length) yield items.shift();
            await new Promise(resolve => { wake = resolve; });
          }
        }
      };
    }
    const client = {
      beta: {
        sessions: {
          async create(params) {
            const id = `sesn_${++seq}`;
            created.push(params);
            sessions.set(id, { usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }, stream: null });
            return { id };
          },
          async retrieve(id) {
            return { id, usage: sessions.get(id).usage };
          },
          events: {
            async stream(id) {
              const s = sessions.get(id);
              s.stream = queue();
              return s.stream;
            },
            async send(id, { events }) {
              const s = sessions.get(id);
              for (const event of events) {
                sent.push({ id, event });
                s.usage.input_tokens += 100;
                s.usage.cache_read_input_tokens += 1000;
                s.usage.output_tokens += 50;
                if (event.type === 'user.message') {
                  const plan = script(event.content[0].text);
                  if (plan.escalate) {
                    s.stream.push({ type: 'agent.custom_tool_use', id: 'tool_1', name: 'escalate_to_human', input: plan.escalate });
                    s.stream.push({ type: 'session.status_idle', stop_reason: { type: 'requires_action' } });
                    s.pendingAfter = plan.after;
                  } else {
                    s.stream.push({ type: 'agent.message', content: [{ type: 'text', text: plan.reply }] });
                    s.stream.push({ type: 'session.status_idle', stop_reason: { type: plan.stop || 'end_turn' } });
                  }
                } else if (event.type === 'user.custom_tool_result') {
                  s.stream.push({ type: 'agent.message', content: [{ type: 'text', text: s.pendingAfter }] });
                  s.stream.push({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
                }
              }
            }
          }
        }
      }
    };
    return { client, created, sent };
  }

  async function ask(user, text, deps, conversationId) {
    const pieces = [];
    const result = await support.sendMessage({ user, text, conversationId, context: { firstName: 'Ana', language: 'es', page: '/actions' }, onText: piece => pieces.push(piece) }, deps);
    return { ...result, text: pieces.join('') };
  }

  before(async () => {
    process.env.SUPPORT_AGENT_ID = 'agent_test';
    process.env.SUPPORT_ENVIRONMENT_ID = 'env_test';
    process.env.SUPPORT_ESCALATION_EMAIL = 'help@corteza.test';
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    support = require('../../src/core/support/support-agent');
  });

  beforeEach(async () => {
    delete process.env.SUPPORT_DAILY_MESSAGES;
    await db.collection('support_conversations').deleteMany({});
    await db.collection('support_usage').deleteMany({});
    await db.collection('ai_usage').deleteMany({});
  });

  after(async () => {
    delete process.env.SUPPORT_AGENT_ID;
    delete process.env.SUPPORT_ENVIRONMENT_ID;
    delete process.env.SUPPORT_ESCALATION_EMAIL;
    if (cleanup) await cleanup();
  });

  test('a first message opens a capped session, adds the context line once, streams the reply and keeps only ids', async () => {
    const agent = fakeAgent(() => ({ reply: 'No, Corteza no guarda transcripciones. https://app.corteza.app/privacy' }));
    const first = await ask(ANA, '¿Corteza guarda transcripciones?', { client: agent.client });
    assert.match(first.text, /no guarda transcripciones/);
    assert.equal(agent.created.length, 1);
    assert.deepEqual(agent.created[0].budget, { type: 'limit', max_list_cost: { amount: '100', currency: 'USD' } });
    assert.equal(agent.created[0].agent, 'agent_test');
    const firstText = agent.sent[0].event.content[0].text;
    assert.match(firstText, /^\[Context from Corteza: name: Ana; language: Spanish; opened help from: \/actions\]/);
    assert.doesNotMatch(firstText, /ana@kestrel\.com|UA|WSUPPORT/, 'no email or ids reach the agent');

    const stored = await db.collection('support_conversations').findOne({ conversation_id: first.conversation_id });
    assert.equal(stored.user_id, 'UA');
    assert.equal(stored.messages, 1);
    assert.equal(Object.keys(stored).some(key => /text|question|reply/.test(key)), false, 'no conversation text in Corteza');

    await ask(ANA, '¿Y las notas de Gemini?', { client: agent.client }, first.conversation_id);
    assert.equal(agent.created.length, 1, 'the same session is reused');
    assert.doesNotMatch(agent.sent[1].event.content[0].text, /Context from Corteza/);

    const usage = await db.collection('ai_usage').findOne({ workspace_id: WS, user_id: 'UA' });
    assert.equal(usage.features.support.calls, 2);
    assert.equal(usage.input_tokens + usage.output_tokens, 2 * (1100 + 50), 'each turn records only its own tokens');
  });

  test('a conversation belongs to one person', async () => {
    const agent = fakeAgent(() => ({ reply: 'Hola' }));
    const mine = await ask(ANA, 'Hola', { client: agent.client });
    const theirs = await ask(BRUNO, 'Hola', { client: agent.client }, mine.conversation_id);
    assert.equal(theirs.status, 404);
    assert.equal(agent.sent.length, 1, 'nothing sent to Ana’s session');
  });

  test('escalate_to_human emails Cristian with the case, answers the tool and marks the conversation', async () => {
    const emails = [];
    const agent = fakeAgent(() => ({
      escalate: { question: 'Why was my Monday meeting not captured?', searched: '/docs, /security', hypothesis: 'Transcripts off <b>in Meet</b>' },
      after: 'Se lo pasé a Cristian.'
    }));
    const result = await ask(ANA, '¿Por qué no se capturó mi reunión del lunes?', { client: agent.client, sendEmail: async mail => emails.push(mail) });
    assert.equal(result.escalated, true);
    assert.equal(result.text, 'Se lo pasé a Cristian.');
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, 'help@corteza.test');
    assert.equal(emails[0].replyTo, 'ana@kestrel.com');
    assert.match(emails[0].html, /Why was my Monday meeting not captured\?/);
    assert.match(emails[0].html, /Transcripts off &lt;b&gt;in Meet&lt;\/b&gt;/, 'the agent’s text is escaped');
    assert.match(emails[0].html, /platform\.claude\.com\/workspaces\/default\/sessions\/sesn_1/);
    const toolResult = agent.sent.find(entry => entry.event.type === 'user.custom_tool_result');
    assert.equal(toolResult.event.custom_tool_use_id, 'tool_1');
    assert.ok((await db.collection('support_conversations').findOne({ conversation_id: result.conversation_id })).escalated_at);
  });

  test('20 messages a day per person (SUPPORT_DAILY_MESSAGES), then 429 without calling the agent', async () => {
    process.env.SUPPORT_DAILY_MESSAGES = '2';
    const agent = fakeAgent(() => ({ reply: 'ok' }));
    const first = await ask(ANA, 'uno', { client: agent.client });
    await ask(ANA, 'dos', { client: agent.client }, first.conversation_id);
    const third = await ask(ANA, 'tres', { client: agent.client }, first.conversation_id);
    assert.equal(third.status, 429);
    assert.equal(third.limit_reached, true);
    assert.equal(agent.sent.length, 2);
    assert.equal((await ask(BRUNO, 'uno', { client: agent.client })).text, 'ok', 'the limit is per person');
    const tomorrow = await ask(ANA, 'mañana', { client: agent.client, now: new Date(Date.now() + 24 * 3600 * 1000) });
    assert.equal(tomorrow.text, 'ok');
  });

  test('the session budget ends the chat; empty text and help off are refused', async () => {
    const agent = fakeAgent(() => ({ reply: 'parcial', stop: 'budget_reached' }));
    const result = await ask(ANA, 'Hola', { client: agent.client });
    assert.equal(result.limit_reached, true);
    assert.equal((await ask(ANA, '   ', { client: agent.client })).status, 400);
    delete process.env.SUPPORT_AGENT_ID;
    try {
      assert.equal((await ask(ANA, 'Hola', { client: agent.client })).status, 404);
    } finally {
      process.env.SUPPORT_AGENT_ID = 'agent_test';
    }
  });
});
