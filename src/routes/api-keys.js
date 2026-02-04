const { generateApiKey, revokeApiKey, listApiKeys } = require('../middleware/api-key-auth');

/**
 * Generate a new API key for the authenticated user
 * POST /api/keys/generate
 */
async function handleGenerateApiKey(req, res) {
  try {
    const userId = req.session?.user?.user_id;
    const userName = req.session?.user?.user_name;
    const workspaceId = req.session?.user?.workspace_id;

    if (!userId || !workspaceId) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'You must be logged in to generate an API key'
      });
    }

    const { name, expiresInDays } = req.body;

    const apiKey = await generateApiKey(userId, userName, workspaceId, {
      name: name || 'Coda Integration',
      expiresInDays: expiresInDays || null  // null = never expires
    });

    res.json({
      success: true,
      apiKey: apiKey,
      message: 'API key generated successfully. Store it securely - you won\'t be able to see it again.',
      expiresInDays: expiresInDays || 'Never'
    });

  } catch (error) {
    console.error('Error generating API key:', error);
    res.status(500).json({
      error: 'Failed to generate API key',
      message: error.message
    });
  }
}

/**
 * List all API keys for the authenticated user
 * GET /api/keys
 */
async function handleListApiKeys(req, res) {
  try {
    const userId = req.session?.user?.user_id;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const keys = await listApiKeys(userId);

    res.json({
      success: true,
      keys: keys
    });

  } catch (error) {
    console.error('Error listing API keys:', error);
    res.status(500).json({
      error: 'Failed to list API keys',
      message: error.message
    });
  }
}

/**
 * Revoke an API key
 * DELETE /api/keys/:keyPreview
 */
async function handleRevokeApiKey(req, res) {
  try {
    const userId = req.session?.user?.user_id;
    const { keyPreview } = req.params;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    // Find the full key by preview (last 8 chars)
    const db = require('../config/database').getDatabase();
    const apiKeysCollection = db.collection('api_keys');

    const keyDoc = await apiKeysCollection.findOne({
      user_id: userId,
      key: { $regex: keyPreview + '$' }  // Match end of key
    });

    if (!keyDoc) {
      return res.status(404).json({
        error: 'API key not found'
      });
    }

    const revoked = await revokeApiKey(keyDoc.key, userId);

    if (revoked) {
      res.json({
        success: true,
        message: 'API key revoked successfully'
      });
    } else {
      res.status(404).json({
        error: 'API key not found or already revoked'
      });
    }

  } catch (error) {
    console.error('Error revoking API key:', error);
    res.status(500).json({
      error: 'Failed to revoke API key',
      message: error.message
    });
  }
}

module.exports = {
  handleGenerateApiKey,
  handleListApiKeys,
  handleRevokeApiKey
};
