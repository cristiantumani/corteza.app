const { getWorkspaceSettings, updateJiraSettings } = require('../services/workspace-settings');
const { testJiraConnection } = require('../services/jira');

/**
 * API endpoints for workspace settings (dashboard access)
 * All endpoints require authentication and admin access
 */

/**
 * GET /api/settings
 * Get current workspace settings (with masked token)
 */
async function getSettings(req, res) {
  try {
    const workspaceId = req.session.user.workspace_id;
    const settings = await getWorkspaceSettings(workspaceId);

    const jiraConfig = settings?.jira || {};

    res.json({
      jira: {
        enabled: jiraConfig.enabled || false,
        url: jiraConfig.url || '',
        email: jiraConfig.email || '',
        has_token: !!jiraConfig.api_token_encrypted,
        last_tested_at: jiraConfig.last_tested_at || null,
        last_test_success: jiraConfig.last_test_success !== false
      }
    });
  } catch (error) {
    console.error('❌ Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
}

/**
 * POST /api/settings/jira/test
 * Test Jira connection without saving
 */
async function testJiraSettings(req, res) {
  try {
    const { url, email, apiToken } = req.body;

    if (!url || !email || !apiToken) {
      return res.status(400).json({
        error: 'Missing required fields: url, email, apiToken'
      });
    }

    if (!url.startsWith('https://')) {
      return res.status(400).json({
        error: 'Jira URL must start with https://'
      });
    }

    const result = await testJiraConnection(url, email, apiToken);
    res.json(result);
  } catch (error) {
    console.error('❌ Error testing Jira connection:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test connection'
    });
  }
}

/**
 * POST /api/settings/jira
 * Save Jira settings (tests connection first)
 */
async function saveJiraSettings(req, res) {
  try {
    const { url, email, apiToken } = req.body;
    const workspaceId = req.session.user.workspace_id;
    const userId = req.session.user.user_id;
    const userName = req.session.user.user_name;

    // Validate inputs
    if (!url || !email || !apiToken) {
      return res.status(400).json({
        error: 'Missing required fields: url, email, apiToken'
      });
    }

    if (!url.startsWith('https://')) {
      return res.status(400).json({
        error: 'Jira URL must start with https://'
      });
    }

    // Test connection first
    const testResult = await testJiraConnection(url, email, apiToken);

    if (!testResult.success) {
      return res.status(400).json({
        error: 'Connection test failed',
        details: testResult.error
      });
    }

    // Save settings
    await updateJiraSettings(
      workspaceId,
      { url, email, apiToken },
      userId,
      userName
    );

    res.json({
      success: true,
      message: 'Jira configuration saved successfully',
      user: testResult.user
    });
  } catch (error) {
    console.error('❌ Error saving Jira settings:', error);
    res.status(500).json({
      error: 'Failed to save settings'
    });
  }
}

module.exports = {
  getSettings,
  testJiraSettings,
  saveJiraSettings
};
