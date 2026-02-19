const express = require('express');
const router = express.Router();
const { getExtensionInstallsCollection } = require('../config/database');
const { requireAuth, apiRateLimiter } = require('../middleware/auth');

// POST /api/extension/install — no auth required
// Called by the extension immediately after install
router.post('/install', apiRateLimiter, express.json(), async (req, res) => {
  try {
    const { install_id, version } = req.body;

    if (!install_id || typeof install_id !== 'string' || install_id.length > 100) {
      return res.status(400).json({ error: 'Valid install_id required' });
    }

    const extensionInstalls = getExtensionInstallsCollection();

    // Use $setOnInsert so re-installs don't overwrite email/user data already captured
    await extensionInstalls.updateOne(
      { install_id },
      {
        $setOnInsert: {
          install_id,
          version: version || 'unknown',
          installed_at: new Date(),
          status: 'installed',
          email: null,
          workspace_name: null,
          user_id: null,
          workspace_id: null,
          activated_at: null,
          reminder_sent_at: null,
          reminder_count: 0
        }
      },
      { upsert: true }
    );

    console.log(`📦 Extension install recorded: ${install_id} (v${version || 'unknown'})`);
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Failed to record extension install:', error.message);
    res.status(500).json({ error: 'Failed to record install' });
  }
});

// POST /api/extension/activate — requires auth session
// Called by extension after detecting an authenticated session
router.post('/activate', apiRateLimiter, express.json(), requireAuth, async (req, res) => {
  try {
    const { install_id } = req.body;

    if (!install_id || typeof install_id !== 'string' || install_id.length > 100) {
      return res.status(400).json({ error: 'Valid install_id required' });
    }

    const { user_id, workspace_id } = req.session.user;
    const extensionInstalls = getExtensionInstallsCollection();

    // Only update if still in "installed" state (idempotent)
    const result = await extensionInstalls.updateOne(
      { install_id, status: 'installed' },
      {
        $set: {
          status: 'activated',
          user_id,
          workspace_id,
          activated_at: new Date()
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Extension activated: ${install_id} → user ${user_id}`);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Failed to activate extension install:', error.message);
    res.status(500).json({ error: 'Failed to record activation' });
  }
});

module.exports = router;
