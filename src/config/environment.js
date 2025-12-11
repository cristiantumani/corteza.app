require('dotenv').config();

/**
 * Validates that all required environment variables are present
 * @throws {Error} if required variables are missing
 */
function validateEnvironment() {
  const required = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'MONGODB_URI'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Check optional Jira config (all or nothing)
  const jiraVars = ['JIRA_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  const jiraSet = jiraVars.filter(key => process.env[key]);

  if (jiraSet.length > 0 && jiraSet.length < jiraVars.length) {
    console.warn('⚠️  Partial Jira configuration detected. All three variables required: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN');
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
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
  },
  jira: {
    url: process.env.JIRA_URL,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    isConfigured: !!(process.env.JIRA_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN)
  }
};
