const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const config = require('../../config/environment');

/**
 * Google OAuth 2.0 / OpenID Connect client.
 *
 * Sign-in uses the `openid email profile` scopes only. Meet/Drive access is
 * requested separately later ("Connect Google Meet", incremental consent).
 * Credentials come from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET; the redirect URI
 * is `${BASE_URL}/auth/google/callback` and must be registered in Google Cloud.
 */

const SIGN_IN_SCOPES = ['openid', 'email', 'profile'];
const SIGN_IN_CALLBACK_PATH = '/auth/google/callback';

function isGoogleConfigured() {
  return config.google.isConfigured;
}

function getRedirectUri(callbackPath = SIGN_IN_CALLBACK_PATH) {
  return `${config.app.baseUrl}${callbackPath}`;
}

function createClient(callbackPath) {
  return new OAuth2Client({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: getRedirectUri(callbackPath)
  });
}

/** Random value for the OAuth `state` / OIDC `nonce` parameters */
function randomToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Builds the Google consent URL for signing in
 * @param {Object} params - { state, nonce }
 * @returns {string}
 */
function buildSignInUrl({ state, nonce }) {
  return createClient().generateAuthUrl({
    access_type: 'online',
    scope: SIGN_IN_SCOPES,
    state,
    nonce,
    prompt: 'select_account',
    include_granted_scopes: true
  });
}

/**
 * Exchanges the authorization code and verifies the returned ID token
 * (signature, audience, issuer, expiry, and our nonce).
 * @param {Object} params - { code, nonce }
 * @returns {Promise<Object>} ID token claims: { sub, email, email_verified, name, picture, hd }
 */
async function verifySignInCode({ code, nonce }) {
  const client = createClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new Error('Google did not return an ID token');

  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const claims = ticket.getPayload();
  if (!claims || claims.nonce !== nonce) throw new Error('ID token nonce mismatch');
  return claims;
}

module.exports = {
  isGoogleConfigured,
  getRedirectUri,
  randomToken,
  buildSignInUrl,
  verifySignInCode,
  SIGN_IN_SCOPES
};
