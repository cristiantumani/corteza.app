const { App } = require('@slack/bolt');
const config = require('./config/environment');
const { connectToMongoDB } = require('./config/database');
const { getDecisions, deleteDecision, getStats, healthCheck } = require('./routes/api');
const { serveDashboard, redirectToDashboard } = require('./routes/dashboard');
const {
  handleDecisionCommand,
  handleDecisionModalSubmit,
  handleDecisionsCommand
} = require('./routes/slack');
const {
  handleFileUpload,
  handleApproveAction,
  handleRejectAction,
  handleEditAction,
  handleEditModalSubmit,
  handleConnectJiraAction,
  handleConnectJiraModalSubmit
} = require('./routes/ai-decisions');

/**
 * Main application entry point
 */
async function startApp() {
  // Validate environment variables
  config.validateEnvironment();

  // Connect to MongoDB
  await connectToMongoDB();

  // Initialize Slack app
  const app = new App({
    token: config.slack.token,
    signingSecret: config.slack.signingSecret,
    socketMode: false,
    customRoutes: [
      // Redirect root to dashboard
      {
        path: '/',
        method: ['GET'],
        handler: redirectToDashboard
      },
      // Health check endpoint
      {
        path: '/health',
        method: ['GET'],
        handler: healthCheck
      },
      // Dashboard
      {
        path: '/dashboard',
        method: ['GET'],
        handler: serveDashboard
      },
      // API: Get decisions with filtering
      {
        path: '/api/decisions',
        method: ['GET'],
        handler: getDecisions
      },
      // API: Delete decision
      {
        path: '/api/decisions/:id',
        method: ['DELETE'],
        handler: deleteDecision
      },
      // API: Get statistics
      {
        path: '/api/stats',
        method: ['GET'],
        handler: getStats
      }
    ]
  });

  // Register Slack command handlers
  app.command('/decision', handleDecisionCommand);
  app.command('/decisions', handleDecisionsCommand);
  app.view('decision_modal', handleDecisionModalSubmit);

  // Register AI decision extraction handlers
  app.event('file_shared', handleFileUpload);
  app.action('approve_suggestion', handleApproveAction);
  app.action('reject_suggestion', handleRejectAction);
  app.action('edit_suggestion', handleEditAction);
  app.action('connect_jira_suggestion', handleConnectJiraAction);
  app.view('edit_suggestion_modal', handleEditModalSubmit);
  app.view('connect_jira_modal', handleConnectJiraModalSubmit);

  // Start the server
  await app.start(config.port);
  console.log(`⚡️ Bot running on port ${config.port}!`);
  console.log(`📊 Dashboard: http://localhost:${config.port}/dashboard`);
  console.log(`🏥 Health check: http://localhost:${config.port}/health`);
}

// Start the application
startApp().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
