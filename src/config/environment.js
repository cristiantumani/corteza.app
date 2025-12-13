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
    stateSecret: process.env.SLACK_STATE_SECRET || 'my-state-secret-' + Math.random(), // For OAuth security
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
  }
};
