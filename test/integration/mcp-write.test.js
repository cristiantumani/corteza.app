const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.warn = () => {};

/**
 * MCP connector v2 (docs/specs/2026-10-mcp-v2-write.md): a token with the `write` scope previews
 * changes, applies only what was previewed (once, by the same assistant), and undoes them; the app's
 * permission rules hold; sensitive items stay out; the admin switch leaves assistants reading only.
 */
describe('MCP connector v2: changes from the assistant', { skip }, () => {
  const WS = 'WMCPW';
  const REDIRECT = 'http://localhost:9/callback';
  let cleanup;
  let server;
  let base;
  let db;
  let oauth;
  let changes;
  let client;
  let tokens;
  const cookies = { value: '' };

  async function http(path, options = {}) {
    const response = await fetch(base + path, { redirect: 'manual', ...options, headers: { ...(options.headers || {}), ...(cookies.value ? { cookie: cookies.value } : {}) } });
    const set = response.headers.get('set-cookie');
    if (set) cookies.value = set.split(';')[0];
    return response;
  }

  async function connectClient(accessToken) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const mcp = new Client({ name: 'test-assistant', version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } }));
    return mcp;
  }

  const parse = result => JSON.parse(result.content[0].text);
  const call = async (name, args) => parse(await client.callTool({ name, arguments: args }));
  const item = id => db.collection('action_items').findOne({ workspace_id: WS, item_id: id });
  const outcome = id => db.collection('decisions').findOne({ workspace_id: WS, id });

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
    const now = new Date().toISOString();
    await db.collection('decisions').insertMany([
      { workspace_id: WS, space_id: ana.space_id, id: 1, type: 'decision', text: 'Lanzar el plan anual', capture: 'ai', source_details: meeting, timestamp: now, topic: 'Plan anual', topic_id: 'top_bbbbbbbb' },
      { workspace_id: WS, space_id: ana.space_id, id: 2, type: 'open_question', text: '¿Quién aprueba descuentos mayores al 30%?', evidence_quote: 'Necesitamos saber quién aprueba los descuentos grandes antes del lanzamiento', owner_name: 'Bruno', capture: 'ai', source_details: meeting, timestamp: now, resolution_status: 'open', topic: 'Plan anual', topic_id: 'top_bbbbbbbb' },
      { workspace_id: WS, space_id: ana.space_id, id: 3, type: 'risk', text: 'Salida de Carla del equipo', capture: 'ai', sensitive: true, private_to: 'UA', source_details: meeting, timestamp: now, resolution_status: 'open' },
      { workspace_id: WS, space_id: bruno.space_id, id: 4, type: 'open_question', text: '¿Subimos precios en Chile?', capture: 'ai', timestamp: now, resolution_status: 'open' }
    ]);
    await db.collection('action_items').insertMany([
      { workspace_id: WS, space_id: ana.space_id, item_id: 'act_aaaa1111', text: 'Ana prepara la página de precios', owners: [{ name: 'Ana Rojas', user_id: 'UA' }], owner_ids: ['UA'], status: 'open', due_date: null, source: meeting, created_at: new Date(), topic_id: 'top_bbbbbbbb', topic: 'Plan anual' },
      { workspace_id: WS, space_id: ana.space_id, item_id: 'act_bbbb2222', text: 'Bruno y Ana revisan el contrato', owners: [{ name: 'Bruno Díaz', user_id: 'UB' }, { name: 'Ana Rojas', user_id: 'UA' }], owner_ids: ['UB', 'UA'], status: 'open', source: meeting, created_at: new Date() },
      { workspace_id: WS, space_id: ana.space_id, item_id: 'act_cccc3333', text: 'Hablar con Carla', owners: [{ name: 'Ana Rojas', user_id: 'UA' }], owner_ids: ['UA'], status: 'open', sensitive: true, private_to: 'UA', created_at: new Date() },
      { workspace_id: WS, space_id: bruno.space_id, item_id: 'act_dddd4444', text: 'Bruno revisa costos', owners: [{ name: 'Bruno Díaz', user_id: 'UB' }], owner_ids: ['UB'], status: 'open', created_at: new Date() }
    ]);

    const app = express();
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use(express.json());
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
    changes = require('../../src/integrations/mcp/changes');

    // Connect without asking for scopes: both, on one consent page
    const registered = await (await http('/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
    })).json();
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authorize = await http(`/authorize?${new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: `${base}/mcp` })}`);
    const consentPath = authorize.headers.get('location');
    await http('/test/login');
    const html = await (await http(consentPath)).text();
    assert.match(html, /See your decisions/, 'the read line');
    assert.match(html, /You confirm each change, and you can undo it/, 'the write line');
    const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const allowed = await http('/oauth/consent', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request: consentPath.split('=')[1], csrf, decision: 'allow' }) });
    const code = new URL(allowed.headers.get('location')).searchParams.get('code');
    const exchanged = await http('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: registered.client_id, redirect_uri: REDIRECT, resource: `${base}/mcp` }) });
    tokens = await exchanged.json();
    assert.equal(tokens.scope, 'read write');
    client = await connectClient(tokens.access_token);
  });

  after(async () => {
    if (client) await client.close().catch(() => {});
    if (server) server.close();
    await cleanup();
  });

  test('a write token sees the write tools, which never claim to be read-only', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    for (const name of ['record_decision', 'update_action_item', 'resolve_outcome', 'add_action_item', 'apply_change', 'undo_change']) assert.ok(names.includes(name), name);
    assert.ok(tools.filter(t => ['apply_change', 'undo_change', 'record_decision'].includes(t.name)).every(t => t.annotations.readOnlyHint === false));
    assert.equal(tools.find(t => t.name === 'apply_change').annotations.destructiveHint, true);
  });

  test('add_action_item: the preview writes nothing; apply adds it once, marked via Claude; undo removes it', async () => {
    const before = await db.collection('action_items').countDocuments({ workspace_id: WS });
    const preview = await call('add_action_item', { text: 'Bruno envía la propuesta a Acme', owner: 'Bruno', due_date: '2026-11-07' });
    assert.match(preview.change_id, /^chg_[a-f0-9]{32}$/);
    assert.equal(preview.preview.owner, 'Bruno Díaz');
    assert.equal(await db.collection('action_items').countDocuments({ workspace_id: WS }), before, 'nothing written yet');

    const applied = await call('apply_change', { change_id: preview.change_id });
    assert.equal(applied.applied, true);
    const added = await item(applied.action_item.id);
    assert.deepEqual(added.owner_ids, ['UB']);
    assert.equal(added.due_date, '2026-11-07');
    assert.equal(added.changed_via.client_name, 'Claude');
    assert.equal(added.source.type, 'assistant');

    const again = await client.callTool({ name: 'apply_change', arguments: { change_id: preview.change_id } });
    assert.equal(again.isError, true, 'single use');

    const undone = await call('undo_change', { change_id: preview.change_id });
    assert.equal(undone.undone, true);
    assert.equal(await item(applied.action_item.id), null);
  });

  test('a change applies only for the assistant that previewed it, and not after it expires', async () => {
    const preview = await call('add_action_item', { text: 'Algo' });
    const other = await changes.apply({ workspaceId: WS, userId: 'UA', grantId: 'grant_other', clientName: 'ChatGPT' }, preview.change_id);
    assert.ok(other.error);
    await db.collection('mcp_changes').updateOne({ change_id: preview.change_id }, { $set: { expires_at: new Date(Date.now() - 1000) } });
    const late = await client.callTool({ name: 'apply_change', arguments: { change_id: preview.change_id } });
    assert.equal(late.isError, true);
  });

  test('update_action_item: done, with "does this also answer…?", and undo puts both back', async () => {
    const preview = await call('update_action_item', { item_id: 'act_aaaa1111', status: 'done' });
    assert.deepEqual(preview.preview.changes.status, { from: 'open', to: 'done' });
    assert.deepEqual(preview.preview.may_also_resolve.map(o => o.id), [2], 'the open question of its thread');
    const applied = await call('apply_change', { change_id: preview.change_id, close: [2] });
    assert.deepEqual(applied.resolved, [2]);
    assert.equal((await item('act_aaaa1111')).status, 'done');
    assert.equal((await outcome(2)).resolution_status, 'resolved');

    await call('undo_change', { change_id: preview.change_id });
    assert.equal((await item('act_aaaa1111')).status, 'open');
    assert.equal((await outcome(2)).resolution_status, 'open');
  });

  test('the app’s rules hold: a colleague’s item and sensitive items are not found; nothing to change is said', async () => {
    for (const args of [{ item_id: 'act_dddd4444', status: 'done' }, { item_id: 'act_cccc3333', status: 'done' }]) {
      const result = await client.callTool({ name: 'update_action_item', arguments: args });
      assert.equal(result.isError, true, args.item_id);
      assert.match(parse(result).error, /Not found/);
    }
    for (const id of [3, 4]) {
      const result = await client.callTool({ name: 'resolve_outcome', arguments: { id, note: 'x' } });
      assert.equal(result.isError, true, String(id));
    }
    const same = await client.callTool({ name: 'update_action_item', arguments: { item_id: 'act_aaaa1111', status: 'open' } });
    assert.equal(same.isError, true);
  });

  test('resolve_outcome answers with a note, and undo reopens it', async () => {
    const preview = await call('resolve_outcome', { id: 2, note: 'Lo aprueba finanzas' });
    assert.equal(preview.preview.action, 'Mark as answered');
    await call('apply_change', { change_id: preview.change_id });
    const answered = await outcome(2);
    assert.equal(answered.resolution_note, 'Lo aprueba finanzas');
    assert.equal(answered.changed_via.client_name, 'Claude');
    await call('undo_change', { change_id: preview.change_id });
    const reopened = await outcome(2);
    assert.equal(reopened.resolution_status, 'open');
    assert.equal(reopened.resolution_note, null);
  });

  test('record_decision closes what the person chose among the proposals, and undo deletes it and reopens them', async () => {
    const decide = require('../../src/core/agent/decide');
    const real = decide.previewDecision;
    decide.previewDecision = async () => ({
      is_decision: true, decision: 'Finanzas aprueba descuentos mayores al 30%',
      items: [{ kind: 'decision', id: 2, type: 'open_question', text: '¿Quién aprueba…?', relation: 'answers', confidence: 'high', reason: null, meeting: null, owners: [], due_date: null, can_close: true }],
      related: []
    });
    try {
      const preview = await call('record_decision', { text: 'Decidimos que finanzas aprueba descuentos grandes' });
      assert.deepEqual(preview.preview.would_close.map(p => p.id), [2]);
      const applied = await call('apply_change', { change_id: preview.change_id });
      assert.deepEqual(applied.closed.map(c => c.id), [2]);
      const recorded = await outcome(applied.decision.id);
      assert.equal(recorded.text, 'Finanzas aprueba descuentos mayores al 30%');
      assert.equal(recorded.changed_via.client_name, 'Claude');
      assert.equal((await outcome(2)).resolution_status, 'resolved');

      await call('undo_change', { change_id: preview.change_id });
      assert.equal(await outcome(applied.decision.id), null);
      assert.equal((await outcome(2)).resolution_status, 'open');
    } finally {
      decide.previewDecision = real;
    }
  });

  test('get_person and get_outcome read only what Ana sees', async () => {
    const bruno = await call('get_person', { who: 'Bruno' });
    assert.equal(bruno.person, 'Bruno Díaz');
    assert.deepEqual(bruno.shared_action_items.map(a => a.id), ['act_bbbb2222']);
    assert.ok(!JSON.stringify(bruno).includes('act_dddd4444'), 'not his item in his own space');
    assert.deepEqual(bruno.questions_waiting_on_them.map(o => o.id), [2]);

    const question = await call('get_outcome', { id: 2 });
    assert.equal(question.evidence_quote.length <= 120, true);
    for (const id of [3, 4, 'act_cccc3333']) {
      const hidden = await client.callTool({ name: 'get_outcome', arguments: { id } });
      assert.equal(hidden.isError, true, String(id));
    }
  });

  test('Settings: recent changes with undo state; the stored previews are encrypted when encryption is on', async () => {
    const list = await changes.recentChanges(WS, 'UA');
    assert.ok(list.length >= 4);
    assert.ok(list.every(c => c.status === 'undone' && !c.can_undo));
    if (process.env.FIELD_ENCRYPTION === 'on') {
      const raw = await require('../../src/config/database').getRawDatabase().collection('mcp_changes').findOne({ workspace_id: WS, kind: 'resolve_outcome' });
      assert.ok(!raw.preview_json.includes('finanzas'), 'sealed at rest');
    }
  });

  test('the admin switch leaves assistants reading only; the write rate limit holds', async () => {
    const grants = await oauth.listGrants(WS, 'UA');
    assert.equal(grants[0].can_write, true);
    await oauth.setAssistantsWriteEnabled(WS, false);
    const reading = await connectClient(tokens.access_token);
    const names = (await reading.listTools()).tools.map(t => t.name);
    assert.ok(!names.includes('apply_change') && names.includes('search_outcomes'));
    await reading.close();
    await oauth.setAssistantsWriteEnabled(WS, true);

    const grantId = grants[0].grant_id;
    const now = new Date();
    await db.collection('mcp_changes').insertMany(Array.from({ length: changes.MAX_PER_HOUR_PER_GRANT }, (_, i) => ({
      change_id: `chg_${String(i).padStart(32, '0')}`, grant_id: grantId, workspace_id: WS, user_id: 'UA', kind: 'add_action_item', status: 'applied', applied_at: now, created_at: now
    })));
    const preview = await call('add_action_item', { text: 'Uno más' });
    const limited = await client.callTool({ name: 'apply_change', arguments: { change_id: preview.change_id } });
    assert.equal(limited.isError, true);
    assert.match(parse(limited).error, /Too many changes/);
  });
});
