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
        path: '/api/decisions/',
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
