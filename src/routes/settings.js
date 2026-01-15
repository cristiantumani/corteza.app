const { isWorkspaceAdmin } = require('../middleware/admin-check');
const { getWorkspaceSettings, updateJiraSettings } = require('../services/workspace-settings');
const { testJiraConnection } = require('../services/jira');

/**
 * Slash command handlers for /settings
 * Allows workspace admins to configure Jira integration
 */

/**
 * Handle /settings slash command
 * Opens modal for workspace admins to configure Jira
 */
async function handleSettingsCommand({ command, ack, client }) {
  await ack();

  const workspaceId = command.team_id;
  const userId = command.user_id;

  // Check if user is workspace admin
  const isAdmin = await isWorkspaceAdmin(client, userId, workspaceId);

  if (!isAdmin) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: userId,
      text: '⛔ *Only workspace admins can configure settings.*\n\nYou need to be a Workspace Owner or Admin to access Jira configuration.\n\nIf you believe this is an error, please contact your workspace administrator.'
    });
    return;
  }

  // Get current settings
  const settings = await getWorkspaceSettings(workspaceId);
  const jiraConfig = settings?.jira || {};

  // Open settings modal
  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'settings_jira_modal',
        private_metadata: JSON.stringify({
          workspace_id: workspaceId,
          user_id: userId
        }),
        title: { type: 'plain_text', text: '⚙️ Jira Settings' },
        submit: { type: 'plain_text', text: 'Save & Test' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Configure Jira Integration*\n\nConnect your Jira workspace to automatically link decisions to epics and stories.'
            }
          },
          { type: 'divider' },
          {
            type: 'input',
            block_id: 'jira_url',
            element: {
              type: 'plain_text_input',
              action_id: 'url_input',
              placeholder: { type: 'plain_text', text: 'https://yourcompany.atlassian.net' },
              initial_value: jiraConfig.url || ''
            },
            label: { type: 'plain_text', text: 'Jira URL' },
            hint: { type: 'plain_text', text: 'Your Jira Cloud instance URL (must start with https://)' }
          },
          {
            type: 'input',
            block_id: 'jira_email',
            element: {
              type: 'plain_text_input',
              action_id: 'email_input',
              placeholder: { type: 'plain_text', text: 'bot@company.com' },
              initial_value: jiraConfig.email || ''
            },
            label: { type: 'plain_text', text: 'Jira Email' },
            hint: { type: 'plain_text', text: 'Email of the Jira user for API authentication' }
          },
          {
            type: 'input',
            block_id: 'jira_token',
            element: {
              type: 'plain_text_input',
              action_id: 'token_input',
              placeholder: { type: 'plain_text', text: jiraConfig.api_token_encrypted ? '••••••••••••••••' : 'Enter API token...' }
            },
            label: { type: 'plain_text', text: 'API Token' },
            hint: { type: 'plain_text', text: 'Generate at: https://id.atlassian.com/manage-profile/security/api-tokens' },
            optional: !!jiraConfig.api_token_encrypted // Optional if token already exists
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: '🔒 API tokens are encrypted with AES-256 before storage'
            }]
          }
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error opening settings modal:', error);
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: userId,
      text: '❌ Failed to open settings modal. Please try again.'
    });
  }
}

/**
 * Handle settings modal submission
 * Validates credentials and saves to database
 */
async function handleSettingsModalSubmit({ ack, view, body, client }) {
  const metadata = JSON.parse(view.private_metadata);
  const values = view.state.values;

  const jiraUrl = values.jira_url.url_input.value?.trim() || '';
  const jiraEmail = values.jira_email.email_input.value?.trim() || '';
  const jiraToken = values.jira_token.token_input.value?.trim() || '';

  // Validate URL format
  if (!jiraUrl) {
    await ack({
      response_action: 'errors',
      errors: { jira_url: 'Jira URL is required' }
    });
    return;
  }

  if (!jiraUrl.startsWith('https://')) {
    await ack({
      response_action: 'errors',
      errors: { jira_url: 'URL must start with https://' }
    });
    return;
  }

  // Validate email
  if (!jiraEmail || !jiraEmail.includes('@')) {
    await ack({
      response_action: 'errors',
      errors: { jira_email: 'Valid email is required' }
    });
    return;
  }

  // Get current settings to check if token already exists
  const currentSettings = await getWorkspaceSettings(metadata.workspace_id);
  const hasExistingToken = currentSettings?.jira?.api_token_encrypted;

  // If no new token provided and no existing token, error
  if (!jiraToken && !hasExistingToken) {
    await ack({
      response_action: 'errors',
      errors: { jira_token: 'API token is required' }
    });
    return;
  }

  // Use existing token if no new token provided
  let tokenToUse = jiraToken;
  if (!jiraToken && hasExistingToken) {
    // Decrypt existing token
    const { getDecryptedJiraCredentials } = require('../services/workspace-settings');
    const existingCreds = await getDecryptedJiraCredentials(metadata.workspace_id);
    tokenToUse = existingCreds?.apiToken || '';
  }

  if (!tokenToUse) {
    await ack({
      response_action: 'errors',
      errors: { jira_token: 'API token is required' }
    });
    return;
  }

  // Test connection before saving
  const testResult = await testJiraConnection(jiraUrl, jiraEmail, tokenToUse);

  if (!testResult.success) {
    await ack({
      response_action: 'errors',
      errors: {
        jira_token: `Connection failed: ${testResult.error || 'Unknown error'}. Please check your credentials.`
      }
    });
    return;
  }

  // Connection successful, acknowledge modal
  await ack();

  try {
    // Get user info
    const userInfo = await client.users.info({ user: metadata.user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Save settings
    await updateJiraSettings(
      metadata.workspace_id,
      {
        url: jiraUrl,
        email: jiraEmail,
        apiToken: tokenToUse
      },
      metadata.user_id,
      userName
    );

    // Post confirmation
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: `✅ *Jira configuration saved and tested successfully!*\n\n*Connected as:* ${testResult.user}\n*Jira URL:* ${jiraUrl}\n\nYou can now link decisions to Jira epics using \`/decision\` or \`/memory\` commands.`
    });

    console.log(`✅ Jira settings configured for workspace ${metadata.workspace_id} by ${userName}`);
  } catch (error) {
    console.error('❌ Error saving Jira settings:', error);
    // Post error message to user
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: '❌ Failed to save settings. Please try again or contact support.'
    });
  }
}

module.exports = {
  handleSettingsCommand,
  handleSettingsModalSubmit
};
