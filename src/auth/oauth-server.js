const crypto = require('crypto');
const { getDatabase, getWorkspaceMembersCollection } = require('../config/database');
const { InvalidGrantError, InvalidTokenError, InvalidRequestError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

/**
 * OAuth 2.1 authorization server for Corteza's MCP connector (docs/specs/2026-10-mcp-connector.md).
 *
 * An AI assistant (Claude, ChatGPT…) registers itself (dynamic client registration), sends the person
 * to /authorize, and gets tokens that act as that person on /mcp. The SDK's mcpAuthRouter handles the
 * protocol (metadata, registration, PKCE, token and revocation endpoints); this provider stores
 * everything in MongoDB and delegates the login to Corteza's own Google sign-in: /authorize parks the
 * request in `mcp_auth_requests` and sends the browser to the consent page (src/http/oauth-consent.js),
 * which needs a signed-in session.
 *
 * Collections:
 *   mcp_clients        { client_id, client_name, redirect_uris, …registration, created_at }
 *   mcp_auth_requests  { request_id, client_id, redirect_uri, code_challenge, state, scopes, resource, expires_at }
 *   mcp_auth_codes     { code_hash, grant_id, client_id, workspace_id, user_id, code_challenge, redirect_uri, scopes, resource, expires_at }
 *   mcp_tokens         { token_hash, kind: 'access'|'refresh', grant_id, client_id, client_name, workspace_id, user_id,
 *                        scopes, resource, expires_at, created_at, last_used_at, revoked_at }
 *
 * A grant is one "connected assistant" (one consent); its tokens share `grant_id`, so Disconnect revokes
 * them all. Tokens and codes are stored as SHA-256 hashes, never in clear. No meeting content is stored.
 */

const SCOPES = ['read'];
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TTL_MS = 15 * 60 * 1000;
const LAST_USED_EVERY_MS = 5 * 60 * 1000;

/** @returns {string} */
function baseUrl() {
  return (process.env.BASE_URL || 'https://app.corteza.app').replace(/\/+$/, '');
}

/** @returns {URL} the protected resource: the MCP endpoint */
function resourceUrl() {
  return new URL('/mcp', baseUrl());
}

/** @param {string} value @returns {string} */
function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** @param {string} prefix @returns {string} */
function randomToken(prefix) {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

const collection = name => getDatabase().collection(name);

/**
 * Whether a workspace lets AI assistants read Corteza: its own setting, else MCP_DEFAULT_ENABLED
 * (default on, for the beta)
 * @param {string} workspaceId
 * @returns {Promise<boolean>}
 */
async function assistantsEnabled(workspaceId) {
  const workspace = await collection('workspaces').findOne({ workspace_id: workspaceId }, { projection: { _id: 0, ai_assistants_enabled: 1 } });
  if (workspace && typeof workspace.ai_assistants_enabled === 'boolean') return workspace.ai_assistants_enabled;
  return process.env.MCP_DEFAULT_ENABLED !== 'false';
}

/** Registered clients, as the SDK expects them */
const clientsStore = {
  /** @param {string} clientId */
  async getClient(clientId) {
    if (typeof clientId !== 'string') return undefined;
    const client = await collection('mcp_clients').findOne({ client_id: clientId }, { projection: { _id: 0, created_at: 0 } });
    return client || undefined;
  },
  /** @param {Object} client - validated client metadata (the SDK checks redirect URIs and fields) */
  async registerClient(client) {
    const full = {
      ...client,
      client_name: typeof client.client_name === 'string' ? client.client_name.slice(0, 100) : 'AI assistant',
      client_id: `mcpc_${crypto.randomBytes(16).toString('hex')}`,
      client_id_issued_at: Math.floor(Date.now() / 1000)
    };
    await collection('mcp_clients').insertOne({ ...full, created_at: new Date() });
    console.log(`🔑 MCP client registered: ${full.client_id}`);
    return full;
  }
};

/**
 * Issues an access + refresh token pair for a grant
 * @param {{ grant_id: string, client_id: string, client_name: string, workspace_id: string, user_id: string, scopes: string[], resource: string|null }} grant
 * @returns {Promise<{ access_token: string, token_type: string, expires_in: number, refresh_token: string, scope: string }>}
 */
async function issueTokens(grant) {
  const now = new Date();
  const access = randomToken('cza_');
  const refresh = randomToken('czr_');
  const base = {
    grant_id: grant.grant_id, client_id: grant.client_id, client_name: grant.client_name,
    workspace_id: grant.workspace_id, user_id: grant.user_id, scopes: grant.scopes, resource: grant.resource,
    created_at: now, last_used_at: null, revoked_at: null
  };
  await collection('mcp_tokens').insertMany([
    { ...base, token_hash: hash(access), kind: 'access', expires_at: new Date(now.getTime() + ACCESS_TTL_S * 1000) },
    { ...base, token_hash: hash(refresh), kind: 'refresh', expires_at: new Date(now.getTime() + REFRESH_TTL_MS) }
  ]);
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: grant.scopes.join(' ') };
}

/**
 * Whether a member still belongs to the workspace and the workspace allows assistants
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function grantStillValid(workspaceId, userId) {
  const member = await getWorkspaceMembersCollection().findOne({ workspace_id: workspaceId, user_id: userId, removed_at: null }, { projection: { _id: 1 } });
  return Boolean(member) && (await assistantsEnabled(workspaceId));
}

/** The SDK's OAuthServerProvider, backed by MongoDB */
const provider = {
  get clientsStore() {
    return clientsStore;
  },

  /**
   * Parks the request and sends the browser to Corteza's consent page (which signs the person in first)
   * @param {Object} client
   * @param {{ state?: string, scopes?: string[], codeChallenge: string, redirectUri: string, resource?: URL }} params
   * @param {import('express').Response} res
   */
  async authorize(client, params, res) {
    const scopes = (params.scopes && params.scopes.length ? params.scopes : SCOPES).filter(scope => SCOPES.includes(scope));
    const requestId = crypto.randomBytes(16).toString('hex');
    await collection('mcp_auth_requests').insertOne({
      request_id: requestId,
      client_id: client.client_id,
      client_name: client.client_name || 'AI assistant',
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      state: params.state || null,
      scopes: scopes.length ? scopes : SCOPES,
      resource: params.resource ? params.resource.href : null,
      expires_at: new Date(Date.now() + REQUEST_TTL_MS)
    });
    res.redirect(`/oauth/consent?request=${requestId}`);
  },

  /** @param {Object} client @param {string} code */
  async challengeForAuthorizationCode(client, code) {
    const row = await collection('mcp_auth_codes').findOne({ code_hash: hash(String(code)), client_id: client.client_id, expires_at: { $gt: new Date() } });
    if (!row) throw new InvalidGrantError('Invalid or expired authorization code');
    return row.code_challenge;
  },

  /**
   * One-time code → tokens (PKCE is checked by the SDK before this is called)
   * @param {Object} client @param {string} code @param {string} [_verifier] @param {string} [redirectUri]
   */
  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const row = await collection('mcp_auth_codes').findOneAndDelete({ code_hash: hash(String(code)), client_id: client.client_id });
    if (!row || row.expires_at < new Date()) throw new InvalidGrantError('Invalid or expired authorization code');
    if (redirectUri && redirectUri !== row.redirect_uri) throw new InvalidGrantError('redirect_uri does not match');
    if (!(await grantStillValid(row.workspace_id, row.user_id))) throw new InvalidGrantError('Access is no longer allowed');
    return issueTokens({ grant_id: row.grant_id, client_id: row.client_id, client_name: row.client_name, workspace_id: row.workspace_id, user_id: row.user_id, scopes: row.scopes, resource: row.resource });
  },

  /**
   * Refresh token → a new pair (the old refresh token is revoked: rotation)
   * @param {Object} client @param {string} refreshToken
   */
  async exchangeRefreshToken(client, refreshToken) {
    const now = new Date();
    const row = await collection('mcp_tokens').findOneAndUpdate(
      { token_hash: hash(String(refreshToken)), kind: 'refresh', client_id: client.client_id, revoked_at: null, expires_at: { $gt: now } },
      { $set: { revoked_at: now } }
    );
    if (!row) throw new InvalidGrantError('Invalid or expired refresh token');
    if (!(await grantStillValid(row.workspace_id, row.user_id))) throw new InvalidGrantError('Access is no longer allowed');
    return issueTokens({ grant_id: row.grant_id, client_id: row.client_id, client_name: row.client_name, workspace_id: row.workspace_id, user_id: row.user_id, scopes: row.scopes, resource: row.resource });
  },

  /**
   * Access token → who it acts as
   * @param {string} token
   */
  async verifyAccessToken(token) {
    const now = new Date();
    const row = await collection('mcp_tokens').findOne({ token_hash: hash(String(token)), kind: 'access', revoked_at: null });
    if (!row || row.expires_at <= now) throw new InvalidTokenError('Invalid or expired token');
    if (!(await grantStillValid(row.workspace_id, row.user_id))) throw new InvalidTokenError('Access is no longer allowed');
    if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > LAST_USED_EVERY_MS) {
      await collection('mcp_tokens').updateMany({ grant_id: row.grant_id }, { $set: { last_used_at: now } });
    }
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes,
      expiresAt: Math.floor(row.expires_at.getTime() / 1000),
      resource: resourceUrl(),
      extra: { workspace_id: row.workspace_id, user_id: row.user_id, grant_id: row.grant_id, client_name: row.client_name }
    };
  },

  /**
   * Revokes a token and the rest of its grant
   * @param {Object} client @param {{ token: string }} request
   */
  async revokeToken(client, request) {
    const row = await collection('mcp_tokens').findOne({ token_hash: hash(String(request.token)), client_id: client.client_id });
    if (row) await revokeGrant(row.grant_id);
  }
};

/**
 * Approves a parked request for the signed-in person: a one-time code for the assistant
 * @param {string} requestId
 * @param {{ workspace_id: string, user_id: string }} user
 * @returns {Promise<{ redirect: string }>} where to send the browser
 */
async function approveRequest(requestId, user) {
  const request = await collection('mcp_auth_requests').findOneAndDelete({ request_id: String(requestId) });
  if (!request || request.expires_at < new Date()) throw new InvalidRequestError('This request expired. Start again from your assistant.');
  const code = crypto.randomBytes(32).toString('base64url');
  await collection('mcp_auth_codes').insertOne({
    code_hash: hash(code),
    grant_id: `grant_${crypto.randomBytes(12).toString('hex')}`,
    client_id: request.client_id,
    client_name: request.client_name,
    workspace_id: user.workspace_id,
    user_id: user.user_id,
    code_challenge: request.code_challenge,
    redirect_uri: request.redirect_uri,
    scopes: request.scopes,
    resource: request.resource,
    expires_at: new Date(Date.now() + CODE_TTL_MS)
  });
  const target = new URL(request.redirect_uri);
  target.searchParams.set('code', code);
  if (request.state) target.searchParams.set('state', request.state);
  return { redirect: target.href };
}

/**
 * Declines a parked request: the assistant is told access was denied
 * @param {string} requestId
 * @returns {Promise<{ redirect: string }|null>}
 */
async function denyRequest(requestId) {
  const request = await collection('mcp_auth_requests').findOneAndDelete({ request_id: String(requestId) });
  if (!request) return null;
  const target = new URL(request.redirect_uri);
  target.searchParams.set('error', 'access_denied');
  if (request.state) target.searchParams.set('state', request.state);
  return { redirect: target.href };
}

/**
 * A parked request, for the consent page
 * @param {string} requestId
 * @returns {Promise<{ client_name: string, scopes: string[] }|null>}
 */
async function getRequest(requestId) {
  if (typeof requestId !== 'string' || !/^[a-f0-9]{32}$/.test(requestId)) return null;
  const request = await collection('mcp_auth_requests').findOne({ request_id: requestId, expires_at: { $gt: new Date() } }, { projection: { _id: 0, client_name: 1, scopes: 1 } });
  return request || null;
}

/**
 * Revokes every token of a grant (Disconnect)
 * @param {string} grantId
 * @returns {Promise<number>}
 */
async function revokeGrant(grantId) {
  const result = await collection('mcp_tokens').updateMany({ grant_id: grantId, revoked_at: null }, { $set: { revoked_at: new Date() } });
  return result.modifiedCount;
}

/**
 * A person's connected assistants (active grants)
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<Array<{ grant_id: string, client_name: string, connected_at: Date, last_used_at: Date|null }>>}
 */
async function listGrants(workspaceId, userId) {
  const rows = await collection('mcp_tokens').find(
    { workspace_id: workspaceId, user_id: userId, kind: 'refresh', revoked_at: null, expires_at: { $gt: new Date() } },
    { projection: { _id: 0, grant_id: 1, client_name: 1, created_at: 1, last_used_at: 1 } }
  ).toArray();
  /** @type {Map<string, { grant_id: string, client_name: string, connected_at: Date, last_used_at: Date|null }>} */
  const grants = new Map();
  for (const row of rows) {
    const grant = grants.get(row.grant_id) || { grant_id: row.grant_id, client_name: row.client_name, connected_at: row.created_at, last_used_at: null };
    if (row.created_at < grant.connected_at) grant.connected_at = row.created_at;
    if (row.last_used_at && (!grant.last_used_at || row.last_used_at > grant.last_used_at)) grant.last_used_at = row.last_used_at;
    grants.set(row.grant_id, grant);
  }
  return [...grants.values()].sort((a, b) => b.connected_at.getTime() - a.connected_at.getTime());
}

/**
 * Disconnects one of a person's assistants
 * @param {string} workspaceId
 * @param {string} userId
 * @param {string} grantId
 * @returns {Promise<boolean>} whether it was theirs
 */
async function revokeUserGrant(workspaceId, userId, grantId) {
  if (typeof grantId !== 'string') return false;
  const result = await collection('mcp_tokens').updateMany(
    { grant_id: grantId, workspace_id: workspaceId, user_id: userId, revoked_at: null },
    { $set: { revoked_at: new Date() } }
  );
  return result.modifiedCount > 0;
}

/**
 * Turns assistants on or off for a workspace; off revokes every token in it
 * @param {string} workspaceId
 * @param {boolean} enabled
 */
async function setAssistantsEnabled(workspaceId, enabled) {
  await collection('workspaces').updateOne({ workspace_id: workspaceId }, { $set: { ai_assistants_enabled: Boolean(enabled) } });
  if (!enabled) await collection('mcp_tokens').updateMany({ workspace_id: workspaceId, revoked_at: null }, { $set: { revoked_at: new Date() } });
}

module.exports = {
  provider,
  clientsStore,
  approveRequest,
  denyRequest,
  getRequest,
  listGrants,
  revokeGrant,
  revokeUserGrant,
  assistantsEnabled,
  setAssistantsEnabled,
  baseUrl,
  resourceUrl,
  hash,
  SCOPES
};
