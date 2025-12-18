require('dotenv').config();

/**
 * Validates that all required environment variables are present
 * @throws {Error} if required variables are missing
 */
function validateEnvironment() {
  const required = ['SLACK_SIGNING_SECRET', 'MONGODB_URI'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Check if using OAuth or single-workspace mode
  const hasOAuth = process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET;
  const hasBotToken = process.env.SLACK_BOT_TOKEN;

  if (!hasOAuth && !hasBotToken) {
    throw new Error('Either OAuth credentials (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET) or SLACK_BOT_TOKEN must be provided');
  }

  if (hasOAuth) {
    console.log('✅ Using OAuth mode (multi-workspace support)');
  } else {
    console.log('⚠️  Using single-workspace mode (SLACK_BOT_TOKEN only)');
  }

  // Check optional Jira config (all or nothing)
  const jiraVars = ['JIRA_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  const jiraSet = jiraVars.filter(key => process.env[key]);

  if (jiraSet.length > 0 && jiraSet.length < jiraVars.length) {
    console.warn('⚠️  Partial Jira configuration detected. All three variables required: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN');
  }

  // Check optional Claude AI config
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set. AI decision extraction will be disabled.');
  }

  // Check optional Notion config (all or nothing)
  const notionVars = ['NOTION_API_KEY', 'NOTION_DATABASE_ID'];
  const notionSet = notionVars.filter(key => process.env[key]);

  if (notionSet.length > 0 && notionSet.length < notionVars.length) {
    console.warn('⚠️  Partial Notion configuration detected. Both variables required: NOTION_API_KEY, NOTION_DATABASE_ID');
  } else if (notionSet.length === notionVars.length) {
    console.log('✅ Notion integration configured');
  }

  // Check optional OpenAI config for semantic search
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY not set. Semantic search will be disabled.');
  } else {
    console.log('✅ Semantic search configured (OpenAI embeddings)');
  }

  console.log('✅ Environment variables validated');
}

module.exports = {
  validateEnvironment,
  port: process.env.PORT || 3000,
  mongodb: {
    uri: process.env.MONGODB_URI,
    dbName: 'decision-logger'
  },
  slack: {
    token: process.env.SLACK_BOT_TOKEN, // For single-workspace mode (optional if using OAuth)
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    clientId: process.env.SLACK_CLIENT_ID, // For OAuth
    clientSecret: process.env.SLACK_CLIENT_SECRET, // For OAuth
    stateSecret: process.env.SLACK_STATE_SECRET || (() => {
      // Generate cryptographically secure state secret if not provided
      const crypto = require('crypto');
      const generated = crypto.randomBytes(32).toString('hex');
      console.warn('⚠️  SLACK_STATE_SECRET not set. Generated temporary secret (NOT suitable for production)');
      console.warn('⚠️  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
      return generated;
    })(),
    useOAuth: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET)
  },
  jira: {
    url: process.env.JIRA_URL,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    isConfigured: !!(process.env.JIRA_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN)
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096'),
    isConfigured: !!process.env.ANTHROPIC_API_KEY
  },
  notion: {
    apiKey: process.env.NOTION_API_KEY,
    databaseId: process.env.NOTION_DATABASE_ID,
    isConfigured: !!(process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID)
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    embeddingModel: 'text-embedding-3-small',
    isConfigured: !!process.env.OPENAI_API_KEY
  }
};
