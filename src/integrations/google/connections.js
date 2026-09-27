const { OAuth2Client } = require('google-auth-library');
const config = require('../../config/environment');
const { getDatabase } = require('../../config/database');
const { encrypt, decrypt } = require('../../utils/encryption');

/**
 * "Connect Google Meet": per-user Google connections (`google_connections`).
 *
 * Asked separately from sign-in (incremental consent). Each connection stores an
 * encrypted refresh token so the Meet poller (jobs/meet-poller.js) can read the
 * user's meeting transcripts and Gemini notes while they're offline.
 */

const CONNECT_CALLBACK_PATH = '/integrations/google/callback';

const MEET_SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.readonly', // conference records, participants, transcripts
  'https://www.googleapis.com/auth/drive.meet.readonly', // Docs that Meet creates: transcripts
  // Gemini notes Docs aren't covered by drive.meet.readonly (Google returns
  // "The user has not granted the app … read access to the file"), so reading
  // them needs Drive read access. Corteza only opens Docs the Meet API links to.
  'https://www.googleapis.com/auth/drive.readonly'
];
// Also ask for identity so we can check the connected account is the signed-in user
const CONNECT_SCOPES = ['openid', 'email', ...MEET_SCOPES];

/** On first connect, also pick up meetings that ended in the previous day */
const INITIAL_BACKFILL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  space_id: null, // null = workspace default space
  skip_one_on_one: true, // skip meetings with 2 or fewer participants
  exclude_keywords: [] // skip meetings whose title contains any of these
};

function collection() {
  return getDatabase().collection('google_connections');
}

function createClient() {
  return new OAuth2Client({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: `${config.app.baseUrl}${CONNECT_CALLBACK_PATH}`
  });
}

/**
 * Consent URL for connecting Google Meet (offline access → refresh token)
 * @param {Object} params - { state, nonce, loginHint }
 */
function buildConnectUrl({ state, nonce, loginHint }) {
  return createClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always return a refresh token
    include_granted_scopes: true,
    scope: CONNECT_SCOPES,
    state,
    nonce,
    login_hint: loginHint || undefined
  });
}

/**
 * Exchanges the code from the connect callback
 * @returns {Promise<{ refreshToken: string, email: string, grantedScopes: string[] }>}
 */
async function exchangeConnectCode({ code, nonce }) {
  const client = createClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.id_token) throw new Error('Google did not return an ID token');
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const claims = ticket.getPayload();
  if (!claims || claims.nonce !== nonce) throw new Error('ID token nonce mismatch');

  const grantedScopes = (tokens.scope || '').split(' ').filter(Boolean);
  return {
    refreshToken: tokens.refresh_token || null,
    email: (claims.email || '').toLowerCase(),
    grantedScopes
  };
}

/** True if a connection was made before a scope was added and should be reconnected */
function needsReconsent(connection) {
  return missingScopes(connection?.scopes || []).length > 0;
}

/** Scopes from MEET_SCOPES the user did not grant (they can untick boxes on the consent screen) */
function missingScopes(grantedScopes) {
  return MEET_SCOPES.filter(scope => !grantedScopes.includes(scope));
}

/**
 * Creates or replaces the connection for a user in a workspace
 */
async function saveConnection({ workspaceId, userId, userName, email, refreshToken, grantedScopes }) {
  const now = new Date();
  const existing = await getConnection(workspaceId, userId);
  await collection().updateOne(
    { workspace_id: workspaceId, user_id: userId },
    {
      $set: {
        user_name: userName,
        google_email: email,
        refresh_token_encrypted: encrypt(refreshToken),
        scopes: grantedScopes,
        status: 'active',
        last_error: null,
        updated_at: now
      },
      $setOnInsert: {
        workspace_id: workspaceId,
        user_id: userId,
        settings: { ...DEFAULT_SETTINGS },
        poll_cursor: new Date(now.getTime() - INITIAL_BACKFILL_MS),
        last_polled_at: null,
        lease_until: null,
        meetings_processed: 0,
        decisions_captured: 0,
        connected_at: now
      }
    },
    { upsert: true }
  );
  console.log(`🔌 Google Meet ${existing ? 're' : ''}connected for ${email} in ${workspaceId}`);
  return getConnection(workspaceId, userId);
}

async function getConnection(workspaceId, userId) {
  return collection().findOne({ workspace_id: workspaceId, user_id: userId });
}

async function listActiveConnections() {
  return collection().find({ status: 'active' }).toArray();
}

/**
 * Updates the user's capture settings (already validated by the caller)
 */
async function updateSettings(workspaceId, userId, settings) {
  await collection().updateOne(
    { workspace_id: workspaceId, user_id: userId },
    { $set: { settings: { ...DEFAULT_SETTINGS, ...settings }, updated_at: new Date() } }
  );
}

/**
 * Takes a short lease on a connection so only one poller works on it at a time
 * @returns {Promise<Object|null>} the connection if the lease was acquired
 */
async function acquireLease(connectionId, ms = 5 * 60 * 1000) {
  const now = new Date();
  return collection().findOneAndUpdate(
    { _id: connectionId, status: 'active', $or: [{ lease_until: null }, { lease_until: { $lt: now } }] },
    { $set: { lease_until: new Date(now.getTime() + ms) } },
    { returnDocument: 'after' }
  );
}

/**
 * Records the result of a poll and releases the lease
 */
async function finishPoll(connectionId, { cursor, error, meetingsProcessed = 0, decisionsCaptured = 0 }) {
  const update = {
    $set: { last_polled_at: new Date(), lease_until: null, last_error: error || null },
    $inc: { meetings_processed: meetingsProcessed, decisions_captured: decisionsCaptured }
  };
  if (cursor) update.$set.poll_cursor = cursor;
  if (error && error.revoked) {
    update.$set.status = 'revoked';
    update.$set.last_error = 'Google access was revoked or expired. Reconnect Google Meet in Settings.';
  } else if (error) {
    update.$set.last_error = String(error.message || error).slice(0, 300);
  }
  await collection().updateOne({ _id: connectionId }, update);
}

/**
 * OAuth client that uses (and refreshes) the connection's tokens
 */
function getAuthorizedClient(connection) {
  const client = createClient();
  client.setCredentials({ refresh_token: decrypt(connection.refresh_token_encrypted) });
  return client;
}

/**
 * Revokes the token at Google (best effort) and deletes the connection
 */
async function disconnect(workspaceId, userId) {
  const connection = await getConnection(workspaceId, userId);
  if (!connection) return false;
  try {
    await createClient().revokeToken(decrypt(connection.refresh_token_encrypted));
  } catch (error) {
    console.warn('⚠️  Could not revoke Google token (continuing):', error.message);
  }
  await collection().deleteOne({ _id: connection._id });
  console.log(`🔌 Google Meet disconnected for ${connection.google_email} in ${workspaceId}`);
  return true;
}

module.exports = {
  CONNECT_CALLBACK_PATH,
  MEET_SCOPES,
  DEFAULT_SETTINGS,
  buildConnectUrl,
  exchangeConnectCode,
  missingScopes,
  needsReconsent,
  saveConnection,
  getConnection,
  listActiveConnections,
  updateSettings,
  acquireLease,
  finishPoll,
  getAuthorizedClient,
  disconnect
};
