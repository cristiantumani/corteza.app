const crypto = require('crypto');

/**
 * Encryption utility for securely storing sensitive data
 * Uses AES-256-GCM authenticated encryption
 */

// Algorithm configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Get encryption key from environment
 * @returns {Buffer} 32-byte encryption key
 * @throws {Error} if key not set or invalid format
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY environment variable not set. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  // Key must be exactly 64 hex characters (32 bytes)
  if (key.length !== 64 || !/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes). ` +
      `Current length: ${key.length}`
    );
  }

  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a plaintext string
 * @param {string} plaintext - The text to encrypt
 * @returns {string} Encrypted data in format: iv:authTag:encryptedData (all base64)
 * @throws {Error} if encryption fails
 */
function encrypt(plaintext) {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty plaintext');
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt the data
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData (all base64-encoded)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  } catch (error) {
    console.error('❌ Encryption error:', error.message);
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt an encrypted string
 * @param {string} encryptedData - Encrypted data in format: iv:authTag:encryptedData
 * @returns {string} Decrypted plaintext
 * @throws {Error} if decryption fails (wrong key, corrupted data, etc.)
 */
function decrypt(encryptedData) {
  if (!encryptedData) {
    throw new Error('Cannot decrypt empty data');
  }

  try {
    const key = getEncryptionKey();

    // Split the encrypted data
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format. Expected format: iv:authTag:data');
    }

    const [ivBase64, authTagBase64, encrypted] = parts;

    // Decode from base64
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');

    // Validate lengths
    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: ${iv.length}, expected ${IV_LENGTH}`);
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid auth tag length: ${authTag.length}, expected ${AUTH_TAG_LENGTH}`);
    }

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt the data
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('❌ Decryption error:', error.message);
    // Don't expose the encrypted data in the error message
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Test if encryption is properly configured
 * @returns {boolean} true if encryption is working
 */
function testEncryption() {
  try {
    const testString = 'test-encryption-' + Date.now();
    const encrypted = encrypt(testString);
    const decrypted = decrypt(encrypted);
    return testString === decrypted;
  } catch (error) {
    console.error('⚠️  Encryption test failed:', error.message);
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  testEncryption
};
