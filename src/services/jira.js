const config = require('../config/environment');
const { getDecryptedJiraCredentials } = require('./workspace-settings');

/**
 * Get Jira credentials for a workspace
 * Tries workspace-specific settings first, falls back to global config
 * @param {string} workspaceId - Slack workspace/team ID
 * @returns {Promise<Object>} Jira credentials with isConfigured flag
 */
async function getJiraCredentials(workspaceId) {
  // Try workspace-specific settings first
  const workspaceCredentials = await getDecryptedJiraCredentials(workspaceId);

  if (workspaceCredentials && workspaceCredentials.isConfigured) {
    return workspaceCredentials;
  }

  // Fallback to global config (for migration period or single-workspace deployments)
  if (config.jira.isConfigured) {
    console.log(`⚠️  Using global Jira config for workspace ${workspaceId} (fallback mode)`);
    return {
      url: config.jira.url,
      email: config.jira.email,
      apiToken: config.jira.apiToken,
      isConfigured: true
    };
  }

  // No Jira configuration available
  return { isConfigured: false };
}

/**
 * Creates basic auth header for Jira API
 * @param {string} email - Jira user email
 * @param {string} apiToken - Jira API token
 */
function getJiraAuthHeader(email, apiToken) {
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };
}

/**
 * Fetches a Jira issue by key
 * @param {string} issueKey - The Jira issue key (e.g., "LOK-123")
 * @param {string} workspaceId - Slack workspace/team ID
 * @returns {Promise<Object|null>} Issue data or null if not found/error
 */
async function fetchJiraIssue(issueKey, workspaceId) {
  const jiraConfig = await getJiraCredentials(workspaceId);

  if (!jiraConfig.isConfigured) {
    console.log(`⚠️  Jira not configured for workspace ${workspaceId}`);
    return null;
  }

  try {
    const url = `${jiraConfig.url}/rest/api/3/issue/${issueKey}`;
    const response = await fetch(url, {
      headers: getJiraAuthHeader(jiraConfig.email, jiraConfig.apiToken)
    });

    if (!response.ok) {
      console.log(`❌ Jira fetch failed for ${issueKey}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      key: data.key,
      summary: data.fields.summary,
      type: data.fields.issuetype.name,
      status: data.fields.status.name,
      url: `${jiraConfig.url}/browse/${data.key}`
    };
  } catch (error) {
    console.error(`❌ Jira error for ${issueKey}:`, error.message);
    return null;
  }
}

/**
 * Adds a comment to a Jira issue
 * @param {string} issueKey - The Jira issue key
 * @param {string} comment - The comment text to add
 * @param {string} workspaceId - Slack workspace/team ID
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function addJiraComment(issueKey, comment, workspaceId) {
  const jiraConfig = await getJiraCredentials(workspaceId);

  if (!jiraConfig.isConfigured) {
    console.log(`⚠️  Jira not configured for workspace ${workspaceId}`);
    return false;
  }

  try {
    const url = `${jiraConfig.url}/rest/api/3/issue/${issueKey}/comment`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...getJiraAuthHeader(jiraConfig.email, jiraConfig.apiToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: comment }]
          }]
        }
      })
    });

    if (response.ok) {
      console.log(`✅ Jira comment added to ${issueKey}`);
      return true;
    }

    console.log(`❌ Jira comment failed for ${issueKey}: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`❌ Jira comment error for ${issueKey}:`, error.message);
    return false;
  }
}

/**
 * Test Jira connection with provided credentials
 * @param {string} url - Jira instance URL
 * @param {string} email - Jira user email
 * @param {string} apiToken - Jira API token
 * @returns {Promise<Object>} { success: boolean, user?: string, error?: string }
 */
async function testJiraConnection(url, email, apiToken) {
  try {
    const testUrl = `${url}/rest/api/3/myself`;
    const response = await fetch(testUrl, {
      headers: getJiraAuthHeader(email, apiToken)
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        user: data.displayName || data.emailAddress
      };
    }

    const errorText = await response.text();
    return {
      success: false,
      error: `HTTP ${response.status}: ${errorText.substring(0, 100)}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  fetchJiraIssue,
  addJiraComment,
  testJiraConnection,
  getJiraCredentials
};
