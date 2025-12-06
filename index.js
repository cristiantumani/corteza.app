require('dotenv').config();
const { App } = require('@slack/bolt');
const { MongoClient } = require('mongodb');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
});

// MongoDB setup
let db;
let decisionsCollection;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB!');
    
    db = client.db('decision-logger');
    decisionsCollection = db.collection('decisions');
    
    // Create indexes for better search performance
    await decisionsCollection.createIndex({ text: 'text', tags: 'text' });
    await decisionsCollection.createIndex({ timestamp: -1 });
    
    console.log('✅ Database and collections ready!');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// Handle /decision command
app.command('/decision', async ({ command, ack, client, say }) => {
  await ack();

  const decisionText = command.text.trim();
  
  if (!decisionText) {
    await say({
      text: '❌ Please provide a decision text. Example: `/decision We will sync AEM → Lokalise only`',
      thread_ts: command.thread_ts,
    });
    return;
  }

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'decision_modal',
        private_metadata: JSON.stringify({
          channel_id: command.channel_id,
          user_id: command.user_id,
          decision_text: decisionText,
        }),
        title: {
          type: 'plain_text',
          text: '📝 Log Decision',
        },
        submit: {
          type: 'plain_text',
          text: 'Save Decision',
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Decision:*\n${decisionText}`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'input',
            block_id: 'type_block',
            element: {
              type: 'static_select',
              action_id: 'type_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select decision type',
              },
              options: [
                {
                  text: { type: 'plain_text', text: '📦 Product' },
                  value: 'product',
                },
                {
                  text: { type: 'plain_text', text: '🎨 UX' },
                  value: 'ux',
                },
                {
                  text: { type: 'plain_text', text: '⚙️ Technical' },
                  value: 'technical',
                },
              ],
            },
            label: {
              type: 'plain_text',
              text: 'Decision Type',
            },
          },
          {
            type: 'input',
            block_id: 'epic_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'epic_input',
              placeholder: {
                type: 'plain_text',
                text: 'e.g., JIRA-123, LOK-456',
              },
            },
            label: {
              type: 'plain_text',
              text: 'Epic/Story Key (optional)',
            },
          },
          {
            type: 'input',
            block_id: 'tags_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'tags_input',
              placeholder: {
                type: 'plain_text',
                text: 'e.g., aem, integration, scope',
              },
            },
            label: {
              type: 'plain_text',
              text: 'Tags (comma-separated, optional)',
            },
          },
          {
            type: 'input',
            block_id: 'alternatives_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'alternatives_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'What alternatives were considered?',
              },
            },
            label: {
              type: 'plain_text',
              text: 'Alternatives Considered (optional)',
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error('Error opening modal:', error);
    await say({
      text: '❌ Error opening decision form. Please try again.',
      thread_ts: command.thread_ts,
    });
  }
});

// Handle modal submission
app.view('decision_modal', async ({ ack, body, view, client }) => {
  try {
    await ack();
    
    console.log('=== Modal submission received! ===');
    
    const metadata = JSON.parse(view.private_metadata);
    const values = view.state.values;

    const decisionType = values.type_block.type_select.selected_option.value;
    const epicKey = values.epic_block.epic_input.value || null;
    const tagsInput = values.tags_block.tags_input.value || '';
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
    const alternatives = values.alternatives_block.alternatives_input.value || null;

    console.log('Getting user info...');
    const userInfo = await client.users.info({ user: metadata.user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Get the current highest ID and increment
    const lastDecision = await decisionsCollection.findOne({}, { sort: { id: -1 } });
    const nextId = lastDecision ? lastDecision.id + 1 : 1;

    const decision = {
      id: nextId,
      text: metadata.decision_text,
      type: decisionType,
      epic_key: epicKey,
      tags: tags,
      alternatives: alternatives,
      creator: userName,
      user_id: metadata.user_id,
      channel_id: metadata.channel_id,
      timestamp: new Date().toISOString(),
    };

    // Save to MongoDB
    await decisionsCollection.insertOne(decision);
    console.log('✅ Decision saved to MongoDB:', decision);

    const typeEmoji = {
      product: '📦',
      ux: '🎨',
      technical: '⚙️',
    };

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Decision #${decision.id} logged by ${userName}*`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Type:*\n${typeEmoji[decisionType]} ${decisionType}`,
          },
          {
            type: 'mrkdwn',
            text: `*Date:*\n${new Date().toLocaleDateString()}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Decision:*\n${decision.text}`,
        },
      },
    ];

    if (epicKey) {
      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Epic:*\n${epicKey}`,
          },
        ],
      });
    }

    if (tags.length > 0) {
      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Tags:*\n${tags.map(t => `\`${t}\``).join(', ')}`,
          },
        ],
      });
    }

    if (alternatives) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Alternatives:*\n${alternatives}`,
        },
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `View all decisions: <http://your-dashboard-url.com|Dashboard> | Search: \`/decisions search [keyword]\``,
        },
      ],
    });

    console.log('Posting message to channel:', metadata.channel_id);
    await client.chat.postMessage({
      channel: metadata.channel_id,
      blocks: blocks,
      text: `Decision #${decision.id} logged`,
    });

    console.log('✅ Decision successfully posted to Slack!');
  } catch (error) {
    console.error('❌ ERROR in modal submission handler:');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Full error:', error);
  }
});

// Handle /decisions search command
app.command('/decisions', async ({ command, ack, say }) => {
  await ack();

  const args = command.text.trim().split(' ');
  const subcommand = args[0];

  if (subcommand === 'search') {
    const keyword = args.slice(1).join(' ').toLowerCase();
    
    if (!keyword) {
      await say('❌ Please provide a search keyword. Example: `/decisions search AEM`');
      return;
    }

    // Search in MongoDB
    const results = await decisionsCollection.find({
      $or: [
        { text: { $regex: keyword, $options: 'i' } },
        { tags: { $regex: keyword, $options: 'i' } },
        { epic_key: { $regex: keyword, $options: 'i' } },
      ]
    }).sort({ timestamp: -1 }).limit(10).toArray();

    if (results.length === 0) {
      await say(`🔍 No decisions found matching "${keyword}"`);
      return;
    }

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔍 *Found ${results.length} decision(s) matching "${keyword}"*`,
        },
      },
      { type: 'divider' },
    ];

    results.slice(0, 5).forEach(d => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Decision #${d.id}* (${d.type})\n${d.text}\n_by ${d.creator} on ${new Date(d.timestamp).toLocaleDateString()}_`,
        },
      });
    });

    if (results.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Showing 5 of ${results.length} results. View all in the dashboard._`,
          },
        ],
      });
    }

    await say({ blocks });
  } else if (subcommand === 'recent') {
    // Get recent decisions from MongoDB
    const recentDecisions = await decisionsCollection
      .find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();
    
    if (recentDecisions.length === 0) {
      await say('📭 No decisions logged yet. Use `/decision` to log your first one!');
      return;
    }

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📋 *${recentDecisions.length} Most Recent Decisions*`,
        },
      },
      { type: 'divider' },
    ];

    recentDecisions.forEach(d => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator} • ${new Date(d.timestamp).toLocaleDateString()}_`,
        },
      });
    });

    await say({ blocks });
  } else if (subcommand === 'epic' && args[1]) {
    // Get decisions for a specific epic
    const epicKey = args[1].toUpperCase();
    
    const results = await decisionsCollection
      .find({ epic_key: { $regex: epicKey, $options: 'i' } })
      .sort({ timestamp: -1 })
      .toArray();
    
    if (results.length === 0) {
      await say(`🔍 No decisions found for epic "${epicKey}"`);
      return;
    }

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🎯 *${results.length} decision(s) for ${epicKey}*`,
        },
      },
      { type: 'divider' },
    ];

    results.forEach(d => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator} • ${new Date(d.timestamp).toLocaleDateString()}_`,
        },
      });
    });

    await say({ blocks });
  } else {
    await say('❌ Unknown command. Try:\n• `/decisions search [keyword]`\n• `/decisions recent`\n• `/decisions epic [JIRA-123]`');
  }
});

// Start the app
(async () => {
  // Connect to MongoDB first
  await connectToMongoDB();
  
  // Then start the Slack bot
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Decision Logger bot is running on port ${port}!`);
})();