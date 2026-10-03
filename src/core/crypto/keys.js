const crypto = require('crypto');

/**
 * Per-workspace data keys (DEKs) for field encryption (docs/specs/2026-10-workspace-encryption.md).
 *
 * Each workspace gets a random 256-bit key, created on its first encrypted write. It is stored only
 * wrapped (AES-256-GCM) by the key-encryption key (KEK), which lives outside the database: the
 * DATA_KEK environment variable (phase 1; Google Cloud KMS in phase 2).
 *
 * Collection `workspace_keys`: { workspace_id, key_id, wrapped_key, kek: 'env:v1', created_at,
 * destroyed_at }. Destroying a workspace's keys (crypto-shredding) makes its data unreadable for
 * good, backups included. Unwrapped keys are cached in memory for CACHE_MS.
 */

const KEY_ID = 'k1';
const CACHE_MS = 10 * 60 * 1000;
/** @type {Map<string, { key: Buffer|null, expires: number }>} `${workspaceId}:${keyId}` → key (null = destroyed) */
const cache = new Map();

/** @returns {boolean} new writes are encrypted (FIELD_ENCRYPTION=on) */
function encryptionEnabled() {
  return process.env.FIELD_ENCRYPTION === 'on';
}

/** @returns {Buffer} the KEK; throws when DATA_KEK is missing or malformed */
function kek() {
  const value = process.env.DATA_KEK || '';
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('DATA_KEK must be 64 hexadecimal characters (32 bytes). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(value, 'hex');
}

/** True when encryption is off, or on with a valid KEK (checked at startup) */
function assertConfigured() {
  if (encryptionEnabled()) kek();
}

function collection() {
  return require('../../config/database').getRawDatabase().collection('workspace_keys');
}

function wrap(workspaceId, dek) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek(), iv);
  cipher.setAAD(Buffer.from(`kek:${workspaceId}`, 'utf8'));
  const sealed = Buffer.concat([cipher.update(dek), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64');
}

function unwrap(workspaceId, wrapped) {
  const bytes = Buffer.from(wrapped, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`kek:${workspaceId}`, 'utf8'));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
}

/**
 * The key to read values sealed with keyId
 * @param {string} workspaceId
 * @param {string} keyId
 * @returns {Promise<Buffer|null>} null when the key was destroyed or never existed
 */
async function getKey(workspaceId, keyId) {
  const cacheKey = `${workspaceId}:${keyId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.key;
  const row = await collection().findOne({ workspace_id: workspaceId, key_id: keyId });
  const key = row && !row.destroyed_at && row.wrapped_key ? unwrap(workspaceId, row.wrapped_key) : null;
  cache.set(cacheKey, { key, expires: Date.now() + CACHE_MS });
  return key;
}

/**
 * The key new values are sealed with, created on first use
 * @param {string} workspaceId
 * @returns {Promise<{ keyId: string, key: Buffer }>}
 */
async function getActiveKey(workspaceId) {
  if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('A workspace id is needed to encrypt');
  let key = await getKey(workspaceId, KEY_ID);
  if (key) return { keyId: KEY_ID, key };

  const existing = await collection().findOne({ workspace_id: workspaceId, key_id: KEY_ID }, { projection: { destroyed_at: 1 } });
  if (existing && existing.destroyed_at) throw new Error(`The encryption key of workspace ${workspaceId} was destroyed`);
  try {
    await collection().insertOne({
      workspace_id: workspaceId, key_id: KEY_ID, wrapped_key: wrap(workspaceId, crypto.randomBytes(32)),
      kek: 'env:v1', created_at: new Date(), destroyed_at: null
    });
  } catch (error) {
    if (error.code !== 11000) throw error; // another process created it first
  }
  cache.delete(`${workspaceId}:${KEY_ID}`);
  key = await getKey(workspaceId, KEY_ID);
  if (!key) throw new Error(`No encryption key for workspace ${workspaceId}`);
  return { keyId: KEY_ID, key };
}

/**
 * Crypto-shredding: makes the workspace's encrypted data unreadable for good
 * @param {string} workspaceId
 * @returns {Promise<number>} keys destroyed
 */
async function destroyWorkspaceKeys(workspaceId) {
  const result = await collection().updateMany(
    { workspace_id: workspaceId, destroyed_at: null },
    { $set: { destroyed_at: new Date() }, $unset: { wrapped_key: '' } }
  );
  for (const cacheKey of [...cache.keys()]) if (cacheKey.startsWith(`${workspaceId}:`)) cache.delete(cacheKey);
  return result.modifiedCount;
}

function clearKeyCache() {
  cache.clear();
}

module.exports = { encryptionEnabled, assertConfigured, getKey, getActiveKey, destroyWorkspaceKeys, clearKeyCache, KEY_ID };
