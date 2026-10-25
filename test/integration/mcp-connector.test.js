const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.warn = () => {};

/**
 * The MCP connector end to end (docs/specs/2026-10-mcp-connector.md): an assistant registers, the
 * person signs in and allows it, the code is exchanged with PKCE, and the official MCP client calls
 * the tools as that person. Plus refresh, revoke and the workspace switch.
 */
describe('MCP connector: OAuth and read-only tools', { skip }, () => {
  const WS = 'WMCP';
  const REDIRECT = 'http://localhost:9/callback';
  let cleanup;
  let server;
  let base;
  let db;
  let oauth;
  const cookies = { value: '' };
  let tokens;
  let clientId;

  /** fetch that keeps the session cookie and never follows redirects */
  async function http(path, options = {}) {
    const response = await fetch(base + path, { redirect: 'manual', ...options, headers: { ...(options.headers || {}), ...(cookies.value ? { cookie: cookies.value } : {}) } });
    const set = response.headers.get('set-cookie');
    if (set) cookies.value = set.split(';')[0];
    return response;
  }

  async function connectClient(accessToken) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test-assistant', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } }));
    return client;
  }

  const parse = result => JSON.parse(result.content[0].text);

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    process.env.MCP_DEFAULT_ENABLED = 'true';
    db = require('../../src/config/database').getDatabase();
    const spaces = require('../../src/services/spaces');
    const express = require('express');
    const session = require('express-session');

    await db.collection('workspaces').insertOne({ workspace_id: WS, name: 'Acme' });
    await db.collection('workspace_members').insertMany([
      { workspace_id: WS, user_id: 'UA', user_name: 'Ana Rojas', email: 'ana@acme.com', removed_at: null, role: 'member' },
      { workspace_id: WS, user_id: 'UB', user_name: 'Bruno Díaz', email: 'bruno@acme.com', removed_at: null, role: 'member' }
    ]);
    const ana = await spaces.ensurePersonalSpace(WS, 'UA', 'Ana Rojas');
    const bruno = await spaces.ensurePersonalSpace(WS, 'UB', 'Bruno Díaz');
    const meeting = { type: 'google_meet', external_id: 'meet-1', title: 'Planificación comercial' };
    await db.collection('decisions').insertMany([
      { workspace_id: WS, space_id: ana.space_id, id: 1, type: 'decision', text: 'Lanzar el plan anual de precios con 20% de descuento', rationale: 'Mejorar la retención', capture: 'ai', source_details: meeting, timestamp: new Date().toISOString(), topic: 'Plan anual', topic_id: 'top_aaaaaaaa' },
      { workspace_id: WS, space_id: ana.space_id, id: 2, type: 'open_question', text: '¿Quién aprueba descuentos de precios mayores al 30%?', capture: 'ai', source_details: meeting, timestamp: new Date().toISOString(), resolution_status: 'open', topic: 'Plan anual', topic_id: 'top_aaaaaaaa' },
      // Ana's own, but sensitive: never leaves through the connector
      { workspace_id: WS, space_id: ana.space_id, id: 3, type: 'decision', text: 'Ajuste de precios de sueldo para Carla', capture: 'ai', sensitive: true, private_to: 'UA', source_details: meeting, timestamp: new Date().toISOString() },
      // A colleague's personal space: Ana never sees it
      { workspace_id: WS, space_id: bruno.space_id, id: 4, type: 'decision', text: 'Subir precios en Chile', capture: 'ai', timestamp: new Date().toISOString() }
    ]);
    await db.collection('action_items').insertMany([
      { workspace_id: WS, space_id: ana.space_id, item_id: 'act_mine', text: 'Ana prepara la página de precios', owners: [{ name: 'Ana Rojas', user_id: 'UA' }], owner_ids: ['UA'], status: 'open', due_date: '2026-01-10', source: meeting, created_at: new Date(), topic_id: 'top_aaaaaaaa' },
      { workspace_id: WS, space_id: ana.space_id, item_id: 'act_secret', text: 'Hablar con Carla sobre su salida', owners: [{ name: 'Ana Rojas', user_id: 'UA' }], owner_ids: ['UA'], status: 'open', sensitive: true, private_to: 'UA', source: meeting, created_at: new Date() },
      { workspace_id: WS, space_id: bruno.space_id, item_id: 'act_bruno', text: 'Bruno revisa costos', owners: [{ name: 'Bruno Díaz', user_id: 'UB' }], owner_ids: ['UB'], status: 'open', created_at: new Date() }
    ]);

    const app = express();
    app.set('trust proxy', 1);
    app.use(require('../../src/middleware/auth').addSecurityHeaders); // the production CSP
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use(express.json());
    // Stands in for Google sign-in
    app.get('/test/login', (req, res) => {
      req.session.user = { user_id: 'UA', user_name: 'Ana Rojas', workspace_id: WS, workspace_name: 'Acme', email: 'ana@acme.com' };
      req.session.save(() => res.send('ok'));
    });
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
    process.env.BASE_URL = base;
    app.use(require('../../src/http/oauth-consent'));
    app.use(require('../../src/integrations/mcp/server').mcpRouter());
    oauth = require('../../src/auth/oauth-server');
  });

  after(async () => {
    if (server) server.close();
    await cleanup();
  });

  test('discovery, registration, sign-in, consent and the PKCE code exchange', async () => {
    const meta = await (await http('/.well-known/oauth-authorization-server')).json();
    assert.equal(meta.issuer.replace(/\/$/, ''), base);
    assert.ok(meta.code_challenge_methods_supported.includes('S256'));
    const resourceMeta = await (await http('/.well-known/oauth-protected-resource/mcp')).json();
    assert.equal(resourceMeta.resource, `${base}/mcp`);

    const registered = await (await http('/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
    })).json();
    clientId = registered.client_id;
    assert.match(clientId, /^mcpc_/);

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authorize = await http(`/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'read', resource: `${base}/mcp` })}`);
    assert.equal(authorize.status, 302);
    const consentPath = authorize.headers.get('location');
    assert.match(consentPath, /^\/oauth\/consent\?request=[a-f0-9]{32}$/);

    const signedOut = await http(consentPath);
    assert.equal(signedOut.status, 302);
    assert.match(signedOut.headers.get('location'), /^\/auth\/google\?return=/, 'Google sign-in first');

    await http('/test/login');
    const page = await http(consentPath);
    const html = await page.text();
    assert.equal(page.status, 200);
    const formAction = page.headers.get('content-security-policy').split('; ').find(d => d.startsWith('form-action'));
    assert.equal(formAction, `form-action 'self' ${new URL(REDIRECT).origin}`, 'the browser may follow Allow back to the assistant');
    assert.match(html, /Claude wants to connect to your Corteza/);
    assert.ok(!/can.t change/i.test(html), 'neutral wording: lists what it can do, promises nothing about what it can’t');
    const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const requestId = consentPath.split('=')[1];

    const allowed = await http('/oauth/consent', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request: requestId, csrf, decision: 'allow' }) });
    assert.equal(allowed.status, 302);
    const back = new URL(allowed.headers.get('location'));
    assert.equal(back.origin + back.pathname, REDIRECT);
    assert.equal(back.searchParams.get('state'), 'st8');
    const code = back.searchParams.get('code');

    const wrong = await http('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier-123', client_id: clientId, redirect_uri: REDIRECT }) });
    assert.equal(wrong.status, 400, 'PKCE is checked');

    const exchanged = await http('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: `${base}/mcp` }) });
    tokens = await exchanged.json();
    assert.equal(exchanged.status, 200, JSON.stringify(tokens));
    assert.match(tokens.access_token, /^cza_/);
    assert.match(tokens.refresh_token, /^czr_/);
    const stored = await db.collection('mcp_tokens').findOne({ kind: 'access' });
    assert.notEqual(stored.token_hash, tokens.access_token, 'tokens are stored hashed');
    assert.ok(!JSON.stringify(stored).includes(tokens.access_token));
  });

  test('the tools act as the person: their own data, never sensitive items or colleagues’ spaces', async () => {
    const client = await connectClient(tokens.access_token);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['get_meeting', 'get_outcome', 'get_person', 'get_thread', 'list_action_items', 'list_meetings', 'prepare_meeting', 'search_outcomes'], 'a read-only token gets no write tools');
    assert.ok(tools.every(t => t.annotations && t.annotations.readOnlyHint), 'all read-only');
    assert.match(client.getInstructions(), /This connection can only read/, 'the assistant can tell the person how to allow changes');
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map(p => p.name).sort(), ['action_items_to_tickets', 'follow_up_email', 'my_week', 'prepare_my_day', 'prepare_one_on_one', 'weekly_report', 'whats_overdue']);

    const search = parse(await client.callTool({ name: 'search_outcomes', arguments: { query: 'precios' } }));
    const ids = search.outcomes.map(o => o.id).sort();
    assert.deepEqual(ids, [1, 2], 'not the sensitive one (3), not Bruno’s (4)');
    const plan = search.outcomes.find(o => o.id === 1);
    assert.equal(plan.headline, 'Lanzar el plan anual de precios con 20% de descuento');
    assert.equal(plan.why, 'Mejorar la retención');
    assert.equal(plan.meeting, 'Planificación comercial');
    assert.match(plan.link, /\/dashboard\?tab=meetings&meeting=meet-1$/);

    const mine = parse(await client.callTool({ name: 'list_action_items', arguments: {} }));
    assert.deepEqual(mine.action_items.map(a => a.id), ['act_mine']);
    const everyone = parse(await client.callTool({ name: 'list_action_items', arguments: { owner: 'all' } }));
    assert.ok(!everyone.action_items.some(a => a.id === 'act_bruno' || a.id === 'act_secret'), 'still only what Ana can see');
    const unknown = await client.callTool({ name: 'list_action_items', arguments: { owner: 'Zoe' } });
    assert.equal(unknown.isError, true);

    const thread = parse(await client.callTool({ name: 'get_thread', arguments: { topic_id: 'top_aaaaaaaa' } }));
    assert.equal(thread.topic, 'Plan anual');
    const threadOutcomes = [].concat(...thread.meetings.map(m => m.outcomes)).map(o => o.id).sort();
    assert.deepEqual(threadOutcomes, [1, 2]);
    await client.close();
  });

  test('no token, a bad token: 401 with where to sign in', async () => {
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') || '', /resource_metadata=/);
    const bad = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer cza_nope', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
    assert.equal(bad.status, 401);
  });

  test('refresh rotates the refresh token', async () => {
    const refreshed = await http('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }) });
    const fresh = await refreshed.json();
    assert.equal(refreshed.status, 200, JSON.stringify(fresh));
    const reused = await http('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }) });
    assert.equal(reused.status, 400, 'the old refresh token no longer works');
    tokens = fresh;
  });

  test('Settings lists the assistant; Disconnect and the workspace switch revoke at once', async () => {
    const grants = await oauth.listGrants(WS, 'UA');
    assert.equal(grants.length, 1);
    assert.equal(grants[0].client_name, 'Claude');
    assert.equal(await oauth.revokeUserGrant(WS, 'UB', grants[0].grant_id), false, 'not someone else’s');

    assert.equal(await oauth.revokeUserGrant(WS, 'UA', grants[0].grant_id), true);
    const after = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(after.status, 401);
    assert.equal((await oauth.listGrants(WS, 'UA')).length, 0);

    await oauth.setAssistantsEnabled(WS, false);
    assert.equal(await oauth.assistantsEnabled(WS), false);
    await oauth.setAssistantsEnabled(WS, true);
  });
});
