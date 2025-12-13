const { getDecisionsCollection } = require('../config/database');
const { fetchJiraIssue, addJiraComment } = require('../services/jira');
const { validateEpicKey, validateTags } = require('../middleware/validation');

/**
 * /decision command handler - Opens modal to log a decision
 */
async function handleDecisionCommand({ command, ack, client, say }) {
  await ack();

  const workspace_id = command.team_id;
  const decisionText = command.text.trim();
  if (!decisionText) {
    await say('❌ Provide text');
    return;
  }

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'decision_modal',
        private_metadata: JSON.stringify({
          workspace_id: workspace_id,
          channel_id: command.channel_id,
          user_id: command.user_id,
          decision_text: decisionText
        }),
        title: { type: 'plain_text', text: '📝 Log Decision' },
        submit: { type: 'plain_text', text: 'Save' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Decision:*\n${decisionText}` }
          },
          { type: 'divider' },
          {
            type: 'input',
            block_id: 'type_block',
            element: {
              type: 'static_select',
              action_id: 'type_select',
              options: [
                { text: { type: 'plain_text', text: '📦 Product' }, value: 'product' },
                { text: { type: 'plain_text', text: '🎨 UX' }, value: 'ux' },
                { text: { type: 'plain_text', text: '⚙️ Technical' }, value: 'technical' }
              ]
            },
            label: { type: 'plain_text', text: 'Decision Type' }
          },
          {
            type: 'input',
            block_id: 'epic_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'epic_input',
              placeholder: { type: 'plain_text', text: 'LOK-123' }
            },
            label: { type: 'plain_text', text: 'Epic/Story Key (optional)' },
            hint: { type: 'plain_text', text: 'Auto-fetches from Jira' }
          },
          {
            type: 'input',
            block_id: 'tags_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'tags_input',
              placeholder: { type: 'plain_text', text: 'aem, integration' }
            },
            label: { type: 'plain_text', text: 'Tags (comma-separated, optional)' }
          },
          {
            type: 'input',
            block_id: 'alternatives_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'alternatives_input',
              multiline: true
            },
            label: { type: 'plain_text', text: 'Additional comments (optional)' }
          },
          {
            type: 'input',
            block_id: 'jira_comment_block',
            optional: true,
            element: {
              type: 'checkboxes',
              action_id: 'jira_comment_checkbox',
              options: [{
                text: { type: 'plain_text', text: 'Add this decision as a comment in Jira' },
                value: 'yes'
              }]
            },
            label: { type: 'plain_text', text: 'Jira Integration' }
          }
        ]
      }
    });
  } catch (error) {
    console.error('Modal error:', error);
  }
}

/**
 * Decision modal submission handler
 */
async function handleDecisionModalSubmit({ ack, view, body, client }) {
  try {
    await ack();

    const metadata = JSON.parse(view.private_metadata);
    const workspace_id = metadata.workspace_id; // Extract from metadata
    const values = view.state.values;

    // Extract and validate form values
    const decisionType = values.type_block.type_select.selected_option.value;
    const epicKeyRaw = values.epic_block.epic_input.value || null;
    const epicKey = validateEpicKey(epicKeyRaw);
    const tags = validateTags(values.tags_block.tags_input.value);
    const alternatives = values.alternatives_block.alternatives_input.value || null;
    const addComment = (values.jira_comment_block.jira_comment_checkbox.selected_options || []).length > 0;

    console.log('=== Decision Modal ===');
    console.log('Workspace:', workspace_id);
    console.log('Epic:', epicKey);
    console.log('Add Jira Comment:', addComment);

    // Get user info
    const userInfo = await client.users.info({ user: metadata.user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Get next decision ID (scoped by workspace)
    const decisionsCollection = getDecisionsCollection();
    const lastDecision = await decisionsCollection.findOne(
      { workspace_id: workspace_id },
      { sort: { id: -1 } }
    );
    const nextId = lastDecision ? lastDecision.id + 1 : 1;

    // Fetch Jira data if epic key provided
    let jiraData = null;
    if (epicKey) {
      console.log(`Fetching Jira: ${epicKey}`);
      jiraData = await fetchJiraIssue(epicKey);
      if (jiraData) {
        console.log(`✅ Jira: ${jiraData.summary}`);
      }
    }

    // Save decision to database
    const decision = {
      workspace_id: workspace_id,
      id: nextId,
      text: metadata.decision_text,
      type: decisionType,
      epic_key: epicKey,
      jira_data: jiraData,
      tags,
      alternatives,
      creator: userName,
      user_id: metadata.user_id,
      channel_id: metadata.channel_id,
      timestamp: new Date().toISOString()
    };

    await decisionsCollection.insertOne(decision);
    console.log(`✅ Saved decision #${decision.id}`);

    // Add Jira comment if requested
    if (addComment && epicKey && jiraData) {
      console.log('>>> Adding Jira comment...');
      const comment = `📝 Decision #${decision.id} logged by ${userName}\n\nType: ${decisionType}\nDecision: ${decision.text}\n\n${alternatives ? `Additional Comments: ${alternatives}\n\n` : ''}Logged via Decision Logger`;
      if (await addJiraComment(epicKey, comment)) {
        console.log(`✅ Jira comment added to ${epicKey}`);
      }
    }

    // Post confirmation message to Slack
    await postDecisionConfirmation(client, decision, metadata.channel_id);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Posts a decision confirmation message to Slack
 */
async function postDecisionConfirmation(client, decision, channelId) {
  const typeEmoji = { product: '📦', ux: '🎨', technical: '⚙️' };

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `✅ *Decision #${decision.id}* logged by ${decision.creator}` }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Type:*\n${typeEmoji[decision.type]} ${decision.type}` },
        { type: 'mrkdwn', text: `*Date:*\n${new Date().toLocaleDateString()}` }
      ]
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Decision:*\n${decision.text}` }
    }
  ];

  // Add epic info if available
  if (decision.epic_key && decision.jira_data) {
    blocks.push({
      type: 'section',
      fields: [{
        type: 'mrkdwn',
        text: `*Epic:*\n<${decision.jira_data.url}|${decision.jira_data.key}: ${decision.jira_data.summary}>\n_${decision.jira_data.type} • ${decision.jira_data.status}_`
      }]
    });
  } else if (decision.epic_key) {
    blocks.push({
      type: 'section',
      fields: [{ type: 'mrkdwn', text: `*Epic:*\n${decision.epic_key}` }]
    });
  }

  // Add tags if available
  if (decision.tags.length > 0) {
    blocks.push({
      type: 'section',
      fields: [{ type: 'mrkdwn', text: `*Tags:*\n${decision.tags.map(t => `\`${t}\``).join(', ')}` }]
    });
  }

  // Add alternatives if provided
  if (decision.alternatives) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Additional Comments:*\n${decision.alternatives}` }
    });
  }

  await client.chat.postMessage({
    channel: channelId,
    blocks,
    text: `Decision #${decision.id} logged`
  });
}

/**
 * /decisions command handler - Search, recent, and epic queries
 */
async function handleDecisionsCommand({ command, ack, say }) {
  await ack();

  const workspace_id = command.team_id;
  const args = command.text.trim().split(' ');
  const cmd = args[0];
  const decisionsCollection = getDecisionsCollection();

  if (cmd === 'search') {
    await handleSearchCommand(args, say, decisionsCollection, workspace_id);
  } else if (cmd === 'recent') {
    await handleRecentCommand(say, decisionsCollection, workspace_id);
  } else if (cmd === 'epic' && args[1]) {
    await handleEpicCommand(args[1], say, decisionsCollection, workspace_id);
  } else {
    await say('Try: `/decisions search [keyword]` | `/decisions recent` | `/decisions epic [KEY]`');
  }
}

/**
 * Handle search subcommand
 */
async function handleSearchCommand(args, say, decisionsCollection, workspace_id) {
  const keyword = args.slice(1).join(' ');
  if (!keyword) {
    await say('❌ Provide keyword');
    return;
  }

  const results = await decisionsCollection
    .find({
      workspace_id: workspace_id,
      $or: [
        { text: { $regex: keyword, $options: 'i' } },
        { tags: { $regex: keyword, $options: 'i' } }
      ]
    })
    .sort({ timestamp: -1 })
    .limit(10)
    .toArray();

  if (results.length === 0) {
    await say(`🔍 No results`);
    return;
  }

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `🔍 *Found ${results.length}*` } },
    { type: 'divider' }
  ];

  results.forEach(d => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator}_` }
    });
  });

  await say({ blocks });
}

/**
 * Handle recent subcommand
 */
async function handleRecentCommand(say, decisionsCollection, workspace_id) {
  const recent = await decisionsCollection
    .find({ workspace_id: workspace_id })
    .sort({ timestamp: -1 })
    .limit(10)
    .toArray();

  if (recent.length === 0) {
    await say('📭 No decisions');
    return;
  }

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `📋 *Recent*` } },
    { type: 'divider' }
  ];

  recent.forEach(d => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator}_` }
    });
  });

  await say({ blocks });
}

/**
 * Handle epic subcommand
 */
async function handleEpicCommand(epic, say, decisionsCollection, workspace_id) {
  const results = await decisionsCollection
    .find({
      workspace_id: workspace_id,
      epic_key: { $regex: epic, $options: 'i' }
    })
    .sort({ timestamp: -1 })
    .toArray();

  if (results.length === 0) {
    await say(`🔍 No decisions for ${epic}`);
    return;
  }

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `🎯 *${results.length} for ${epic}*` } },
    { type: 'divider' }
  ];

  results.forEach(d => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator}_` }
    });
  });

  await say({ blocks });
}

module.exports = {
  handleDecisionCommand,
  handleDecisionModalSubmit,
  handleDecisionsCommand
};
