const crypto = require('crypto');
const { getDatabase } = require('../config/database');

/**
 * API Key Authentication Middleware
 * Used for integrations like Coda Pack that need API key access
 */

/**
 * Middleware to require valid API key
 * Checks Authorization: Bearer <api_key> header
 */
async function requireApiKey(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'API key required',
        message: 'Include Authorization: Bearer <your-api-key> header'
      });
    }

    const apiKey = authHeader.replace('Bearer ', '');

    // Validate API key
    const db = getDatabase();
    const apiKeysCollection = db.collection('api_keys');

    const keyDoc = await apiKeysCollection.findOne({
      key: apiKey,
      active: true
    });

    if (!keyDoc) {
      return res.status(401).json({
        error: 'Invalid API key',
        message: 'API key is invalid or has been revoked'
      });
    }

    // Check if key is expired
    if (keyDoc.expires_at && new Date() > new Date(keyDoc.expires_at)) {
      return res.status(401).json({
        error: 'API key expired',
        message: 'This API key has expired. Generate a new one.'
      });
    }

    // Update last used timestamp
    await apiKeysCollection.updateOne(
      { _id: keyDoc._id },
      { $set: { last_used_at: new Date() } }
    );

    // Attach user and workspace info to request
    req.user = {
      id: keyDoc.user_id,
      name: keyDoc.user_name,
      workspace_id: keyDoc.workspace_id
    };

    next();
  } catch (error) {
    console.error('API key auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Generate a new API key for a user
 * @param {string} userId - Slack user ID
 * @param {string} userName - Slack user name
 * @param {string} workspaceId - Slack workspace ID
 * @param {object} options - Optional settings
 * @returns {Promise<string>} The generated API key
 */
async function generateApiKey(userId, userName, workspaceId, options = {}) {
  const db = getDatabase();
  const apiKeysCollection = db.collection('api_keys');

  // Generate random API key
  const apiKey = 'corteza_' + crypto.randomBytes(32).toString('hex');

  // Calculate expiration (default: never expires, or custom days)
  const expiresAt = options.expiresInDays
    ? new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  // Store in database
  await apiKeysCollection.insertOne({
    key: apiKey,
    user_id: userId,
    user_name: userName,
    workspace_id: workspaceId,
    name: options.name || 'API Key',
    active: true,
    created_at: new Date(),
    expires_at: expiresAt,
    last_used_at: null
  });

  return apiKey;
}

/**
 * Revoke an API key
 * @param {string} apiKey - The API key to revoke
 * @param {string} userId - User ID (for permission check)
 */
async function revokeApiKey(apiKey, userId) {
  const db = getDatabase();
  const apiKeysCollection = db.collection('api_keys');

  const result = await apiKeysCollection.updateOne(
    { key: apiKey, user_id: userId },
    { $set: { active: false, revoked_at: new Date() } }
  );

  return result.modifiedCount > 0;
}

/**
 * List all API keys for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} List of API keys (without the actual key value)
 */
async function listApiKeys(userId) {
  const db = getDatabase();
  const apiKeysCollection = db.collection('api_keys');

  const keys = await apiKeysCollection.find(
    { user_id: userId }
  ).toArray();

  return keys.map(key => ({
    name: key.name,
    created_at: key.created_at,
    expires_at: key.expires_at,
    last_used_at: key.last_used_at,
    active: key.active,
    // Show last 8 characters of key for identification
    key_preview: '...' + key.key.slice(-8)
    // Note: The full key is NOT returned, only the preview
  }));
}

module.exports = {
  requireApiKey,
  generateApiKey,
  revokeApiKey,
  listApiKeys
};
