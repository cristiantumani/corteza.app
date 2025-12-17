const { Client } = require('@notionhq/client');

/**
 * Notion API Service
 * Handles one-way sync of decisions from Slack to Notion
 */

let notionClient = null;
let notionEnabled = false;

/**
 * Initialize Notion client
 */
function initializeNotion() {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!apiKey || !databaseId) {
    console.log('ℹ️  Notion integration disabled (NOTION_API_KEY or NOTION_DATABASE_ID not set)');
    notionEnabled = false;
    return;
  }

  try {
    notionClient = new Client({ auth: apiKey });
    notionEnabled = true;
    console.log('✅ Notion integration enabled');
  } catch (error) {
    console.error('❌ Failed to initialize Notion client:', error.message);
    notionEnabled = false;
  }
}

/**
 * Create a decision page in Notion database
 * @param {Object} decision - Decision object from MongoDB
 * @returns {Promise<Object|null>} Notion page object or null if failed
 */
async function createDecisionInNotion(decision) {
  if (!notionEnabled) {
    return null;
  }

  try {
    // Build properties object
    const properties = {
      // Title property (required for all Notion pages)
      Name: {
        title: [
          {
            text: {
              content: decision.text.substring(0, 2000) // Notion title limit
            }
          }
        ]
      },

      // Decision Type (select)
      Type: {
        select: {
          name: decision.type.charAt(0).toUpperCase() + decision.type.slice(1)
        }
      },

      // Creator (text)
      Creator: {
        rich_text: [
          {
            text: {
              content: decision.creator
            }
          }
        ]
      },

      // Date (date)
      Date: {
        date: {
          start: new Date(decision.timestamp).toISOString().split('T')[0]
        }
      },

      // Decision ID (number)
      'Decision ID': {
        number: decision.id
      },

      // Workspace ID (text)
      'Workspace ID': {
        rich_text: [
          {
            text: {
              content: decision.workspace_id
            }
          }
        ]
      }
    };

    // Add epic key if present
    if (decision.epic_key) {
      properties['Epic Key'] = {
        rich_text: [
          {
            text: {
              content: decision.epic_key
            }
          }
        ]
      };
    }

    // Add Jira link if present
    if (decision.jira_data && decision.jira_data.url) {
      properties['Jira Link'] = {
        url: decision.jira_data.url
      };
    }

    // Add tags if present
    if (decision.tags && decision.tags.length > 0) {
      properties['Tags'] = {
        multi_select: decision.tags.map(tag => ({ name: tag }))
      };
    }

    // Create the page in Notion
    const response = await notionClient.pages.create({
      parent: {
        database_id: process.env.NOTION_DATABASE_ID
      },
      properties: properties,
      // Add additional comments as page content if present
      children: decision.alternatives ? [
        {
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: 'Additional Comments'
                }
              }
            ]
          }
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: decision.alternatives.substring(0, 2000) // Notion text limit
                }
              }
            ]
          }
        }
      ] : []
    });

    console.log(`✅ Decision #${decision.id} synced to Notion (${response.id})`);
    return response;

  } catch (error) {
    console.error(`❌ Failed to sync decision #${decision.id} to Notion:`, error.message);
    // Don't throw - we don't want Notion failures to break the main flow
    return null;
  }
}

/**
 * Test Notion connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testNotionConnection() {
  if (!notionEnabled) {
    console.log('❌ Notion is not enabled');
    return false;
  }

  try {
    const database = await notionClient.databases.retrieve({
      database_id: process.env.NOTION_DATABASE_ID
    });
    console.log(`✅ Connected to Notion database: ${database.title[0]?.plain_text || 'Untitled'}`);
    return true;
  } catch (error) {
    console.error('❌ Notion connection test failed:', error.message);
    return false;
  }
}

module.exports = {
  initializeNotion,
  createDecisionInNotion,
  testNotionConnection,
  isNotionEnabled: () => notionEnabled
};
