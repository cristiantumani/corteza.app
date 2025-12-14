const { App } = require('@slack/bolt');
const config = require('./config/environment');
const { connectToMongoDB } = require('./config/database');
const MongoInstallationStore = require('./config/installationStore');
const { getDecisions, updateDecision, deleteDecision, getStats, healthCheck } = require('./routes/api');
const { serveDashboard, redirectToDashboard } = require('./routes/dashboard');
const { exportWorkspaceData, deleteAllWorkspaceData, getWorkspaceDataInfo } = require('./routes/gdpr');
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

  // Initialize installation store for OAuth (if using OAuth)
  let installationStore;
  if (config.slack.useOAuth) {
    try {
      installationStore = new MongoInstallationStore(config.mongodb.uri);
      await installationStore.connect();
    } catch (error) {
      console.error('❌ Failed to connect installation store:', error.message);
      console.error('⚠️  OAuth functionality may be limited. App will continue running.');
    }
  }

  // Initialize Slack app with OAuth or single-workspace mode
  const appConfig = {
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
      // API: Update decision
      {
        path: '/api/decisions/:id',
        method: ['PUT'],
        handler: updateDecision
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
      },
      // GDPR: Get workspace data info
      {
        path: '/api/gdpr/info',
        method: ['GET'],
        handler: getWorkspaceDataInfo
      },
      // GDPR: Export workspace data
      {
        path: '/api/gdpr/export',
        method: ['GET'],
        handler: exportWorkspaceData
      },
      // GDPR: Delete all workspace data
      {
        path: '/api/gdpr/delete-all',
        method: ['DELETE'],
        handler: deleteAllWorkspaceData
      }
    ]
  };

  // Add OAuth configuration if using OAuth mode
  if (config.slack.useOAuth) {
    appConfig.clientId = config.slack.clientId;
    appConfig.clientSecret = config.slack.clientSecret;
    appConfig.stateSecret = config.slack.stateSecret;
    appConfig.scopes = [
      'commands',
      'files:read',
      'chat:write',
      'users:read',
      'channels:history',
      'chat:write.public',
      'users:read.email'
    ];
    appConfig.installationStore = installationStore;
    appConfig.installerOptions = {
      directInstall: true, // Skip "Add to Slack" button, go straight to authorization
      stateVerification: false, // Disable state verification for public distribution
    };
  } else {
    // Single-workspace mode - use bot token
    appConfig.token = config.slack.token;
  }

  const app = new App(appConfig);

  // Add error handler for OAuth failures
  if (config.slack.useOAuth) {
    app.error(async (error) => {
      // Ignore authorization errors for uninstalled workspaces
      if (error.code === 'slack_bolt_authorization_error') {
        console.log(`⚠️  Skipping event from uninstalled workspace (this is normal if app was uninstalled)`);
        return;
      }

      console.error('❌ Slack App Error:', error);
      if (error.code === 'slack_webapi_platform_error') {
        console.error('Platform Error Details:', error.data);
      }
    });
  }

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

  // Start the server FIRST so Railway can health check it
  await app.start(config.port);
  console.log(`⚡️ Bot running on port ${config.port}!`);
  console.log(`📊 Dashboard: http://localhost:${config.port}/dashboard`);
  console.log(`🏥 Health check: http://localhost:${config.port}/health`);

  if (config.slack.useOAuth) {
    console.log(`🔐 OAuth install: http://localhost:${config.port}/slack/install`);
    console.log(`🔄 OAuth redirect: http://localhost:${config.port}/slack/oauth_redirect`);
  }

  // Connect to MongoDB after server is listening
  // This ensures Railway health checks work even if MongoDB is slow/down
  console.log('🔌 Connecting to MongoDB...');
  try {
    await connectToMongoDB();
  } catch (error) {
    console.error('❌ MongoDB connection error during startup:', error.message);
    console.error('⚠️  App is running but database operations will fail');
  }
}

// Start the application
startApp().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
