const config = require('../config/environment');

/**
 * Creates basic auth header for Jira API
 */
function getJiraAuthHeader() {
  const auth = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');
  return { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };
}

/**
 * Fetches a Jira issue by key
 * @param {string} issueKey - The Jira issue key (e.g., "LOK-123")
 * @returns {Promise<Object|null>} Issue data or null if not found/error
 */
async function fetchJiraIssue(issueKey) {
  if (!config.jira.isConfigured) {
    console.log('⚠️  Jira not configured');
    return null;
  }

  try {
    const url = `${config.jira.url}/rest/api/3/issue/${issueKey}`;
    const response = await fetch(url, {
      headers: getJiraAuthHeader()
    });

    if (!response.ok) {
      console.log(`❌ Jira fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      key: data.key,
      summary: data.fields.summary,
      type: data.fields.issuetype.name,
      status: data.fields.status.name,
      url: `${config.jira.url}/browse/${data.key}`
    };
  } catch (error) {
    console.error(`❌ Jira error:`, error.message);
    return null;
  }
}

/**
 * Adds a comment to a Jira issue
 * @param {string} issueKey - The Jira issue key
 * @param {string} comment - The comment text to add
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function addJiraComment(issueKey, comment) {
  if (!config.jira.isConfigured) {
    return false;
  }

  try {
    const url = `${config.jira.url}/rest/api/3/issue/${issueKey}/comment`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...getJiraAuthHeader(),
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

    console.log(`❌ Jira comment failed: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`❌ Jira comment error:`, error.message);
    return false;
  }
}

module.exports = {
  fetchJiraIssue,
  addJiraComment
};
