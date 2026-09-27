const crypto = require('crypto');
const { getDatabase } = require('../config/database');

/**
 * One-time login tokens (magic links, Slack /login, password login, password reset).
 *
 * Stored in the `login_tokens` collection so they survive restarts and work with
 * several app instances. Only a SHA-256 hash of the token is stored; a TTL index
 * on `expires_at` (see config/database.js) removes expired tokens.
 */

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function collection() {
  return getDatabase().collection('login_tokens');
}

/**
 * Creates a one-time token for the given user data
 * @param {Object} userData - { user_id, user_name, workspace_id, workspace_name, email, origin }
 *   origin: 'email' (magic link), 'slack' (/login), 'password', 'password_reset'
 * @param {number} [ttlMs] - Lifetime, default 5 minutes
 * @returns {Promise<string>} The raw token to put in the link
 */
async function createLoginToken(userData, ttlMs = TOKEN_TTL_MS) {
  const token = crypto.randomBytes(32).toString('hex');
  await collection().insertOne({
    token_hash: hashToken(token),
    ...userData,
    created_at: new Date(),
    expires_at: new Date(Date.now() + ttlMs)
  });
  return token;
}

function isUsable(doc) {
  return doc && doc.expires_at > new Date();
}

/**
 * Returns the token's data without using it up, or null if invalid/expired
 */
async function peekLoginToken(token) {
  if (!token || typeof token !== 'string') return null;
  const doc = await collection().findOne({ token_hash: hashToken(token) });
  return isUsable(doc) ? doc : null;
}

/**
 * Atomically uses up the token and returns its data, or null if invalid/expired/already used
 */
async function consumeLoginToken(token) {
  if (!token || typeof token !== 'string') return null;
  const doc = await collection().findOneAndDelete({ token_hash: hashToken(token) });
  return isUsable(doc) ? doc : null;
}

module.exports = {
  createLoginToken,
  peekLoginToken,
  consumeLoginToken,
  TOKEN_TTL_MS
};
