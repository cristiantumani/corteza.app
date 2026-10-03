const crypto = require('crypto');

/**
 * Authenticated encryption of one value (AES-256-GCM), in the format stored in the database:
 *
 *   enc1:<workspace id, URI-encoded>:<key id>:<base64url(iv · auth tag · ciphertext)>
 *
 * The workspace id is bound as associated data, so a value copied into another workspace (or a
 * tampered one) fails to decrypt. The header lets reads find the key without the rest of the doc.
 */

const PREFIX = 'enc1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** @param {unknown} value @returns {boolean} */
function isSealed(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * @param {Buffer} key - 32 bytes
 * @param {string} workspaceId
 * @param {string} keyId
 * @param {string} plaintext
 * @returns {string}
 */
function encryptValue(key, workspaceId, keyId, plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`corteza:${workspaceId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  return `${PREFIX}${encodeURIComponent(workspaceId)}:${keyId}:${payload}`;
}

/**
 * The header of a sealed value
 * @param {string} value
 * @returns {{ workspaceId: string, keyId: string, payload: string }|null}
 */
function parseValue(value) {
  if (!isSealed(value)) return null;
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    return { workspaceId: decodeURIComponent(parts[0]), keyId: parts[1], payload: parts[2] };
  } catch {
    return null;
  }
}

/**
 * @param {Buffer} key
 * @param {string} workspaceId
 * @param {string} payload - base64url(iv · tag · ciphertext)
 * @returns {string} throws when the key, workspace or bytes don't match
 */
function decryptPayload(key, workspaceId, payload) {
  const bytes = Buffer.from(payload, 'base64url');
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new Error('Sealed value too short');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(`corteza:${workspaceId}`, 'utf8'));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}

module.exports = { PREFIX, isSealed, encryptValue, parseValue, decryptPayload };
