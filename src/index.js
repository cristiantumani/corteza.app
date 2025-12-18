const { App, ExpressReceiver } = require('@slack/bolt');
const { MongoClient } = require('mongodb');
const config = require('./config/environment');
const { connectToMongoDB } = require('./config/database');
const MongoInstallationStore = require('./config/installationStore');
const { createSessionMiddleware } = require('./config/session');
const { requireAuth, requireAuthBrowser, requireWorkspaceAccess, addSecurityHeaders } = require('./middleware/auth');
const { getDecisions, updateDecision, deleteDecision, getStats, getAIAnalytics, healthCheck } = require('./routes/api');
const { serveDashboard, serveAIAnalytics, redirectToDashboard } = require('./routes/dashboard');
const { exportWorkspaceData, deleteAllWorkspaceData, getWorkspaceDataInfo } = require('./routes/gdpr');
const { handleMe, handleLogout } = require('./routes/auth');
const { handleLoginPage, handleTokenLogin } = require('./routes/dashboard-auth');
const {
  handleDecisionCommand,
  handleDecisionModalSubmit,
  handleDecisionsCommand,
  handleLoginCommand
} = require('./routes/slack');
const {
  handleFileUpload,
  handleExtractDecisionsButton,
  handleIgnoreFileButton,
  handleApproveAction,
  handleRejectAction,
  handleRejectModalSubmit,
  handleEditAction,
  handleEditModalSubmit,
  handleConnectJiraAction,
  handleConnectJiraModalSubmit
} = require('./routes/ai-decisions');
const { initializeNotion } = require('./services/notion');

// fixOAuthDatabase() function removed - was a one-time fix that's no longer needed
// Running it on every startup was causing installation store issues

/**
 * Main application entry point
 */
async function startApp() {
  // Validate environment variables
  config.validateEnvironment();

  // Initialize installation store for OAuth (if using OAuth)
  let installationStore;
  let oauthEnabled = false;
  if (config.slack.useOAuth) {
    try {
      installationStore = new MongoInstallationStore(config.mongodb.uri);
      await installationStore.connect();
      oauthEnabled = true;
      console.log('✅ OAuth installation store ready');
    } catch (error) {
      console.error('❌ Failed to connect installation store:', error.message);
      console.error('⚠️  Falling back to single-workspace mode (requires SLACK_BOT_TOKEN)');
      // If OAuth fails, we need bot token
      if (!config.slack.token) {
        throw new Error('OAuth installation store failed and no SLACK_BOT_TOKEN provided. Cannot start app.');
      }
    }
  }

  // Create ExpressReceiver for Slack Bot
  const receiverConfig = {
    signingSecret: config.slack.signingSecret,
    processBeforeResponse: true
  };

  // Add OAuth configuration if enabled
  if (oauthEnabled && installationStore) {
    receiverConfig.clientId = config.slack.clientId;
    receiverConfig.clientSecret = config.slack.clientSecret;
    receiverConfig.stateSecret = config.slack.stateSecret;
    receiverConfig.scopes = [
      'commands',
      'files:read',
      'chat:write',
      'users:read',
      'channels:history',
      'chat:write.public',
      'users:read.email'
    ];
    receiverConfig.installationStore = installationStore;
    receiverConfig.installerOptions = {
      directInstall: true,
      stateVerification: true // Enable CSRF protection
      // No callbackOptions - let OAuth complete normally
      // Authentication will be handled separately via /auth/login
    };
  }

  const receiver = new ExpressReceiver(receiverConfig);

  // Get Express app from receiver
  const expressApp = receiver.app;

  // Trust Railway proxy (required for OAuth redirect_uri generation)
  expressApp.set('trust proxy', true);

  // Add session middleware to all routes
  const sessionMiddleware = createSessionMiddleware();
  expressApp.use(sessionMiddleware);

  // Add security headers to all responses
  expressApp.use(addSecurityHeaders);

  // Public routes (no authentication required)
  expressApp.get('/', redirectToDashboard);
  expressApp.get('/health', healthCheck);

  // Authentication routes (public)
  expressApp.get('/auth/login', handleLoginPage); // Shows instructions to use /login in Slack
  expressApp.get('/auth/token', handleTokenLogin); // Validates token and creates session
  expressApp.get('/auth/me', handleMe);
  expressApp.get('/auth/logout', handleLogout);

  // Protected routes - Dashboard (requires authentication, redirects to login)
  expressApp.get('/dashboard', requireAuthBrowser, serveDashboard);
  expressApp.get('/ai-analytics', requireAuthBrowser, serveAIAnalytics);

  // Protected routes - API (requires authentication + workspace access)
  expressApp.get('/api/decisions', requireAuth, requireWorkspaceAccess, getDecisions);
  expressApp.put('/api/decisions/:id', requireAuth, requireWorkspaceAccess, updateDecision);
  expressApp.delete('/api/decisions/:id', requireAuth, requireWorkspaceAccess, deleteDecision);
  expressApp.get('/api/stats', requireAuth, requireWorkspaceAccess, getStats);
  expressApp.get('/api/ai-analytics', requireAuth, requireWorkspaceAccess, getAIAnalytics);

  // Protected routes - GDPR (requires authentication + workspace access)
  expressApp.get('/api/gdpr/info', requireAuth, requireWorkspaceAccess, getWorkspaceDataInfo);
  expressApp.get('/api/gdpr/export', requireAuth, requireWorkspaceAccess, exportWorkspaceData);
  expressApp.delete('/api/gdpr/delete-all', requireAuth, requireWorkspaceAccess, deleteAllWorkspaceData);

  // Create Slack App with the custom receiver
  const appConfig = {
    receiver: receiver
  };

  // Add token for single-workspace mode (if not using OAuth)
  if (!oauthEnabled && config.slack.token) {
    appConfig.token = config.slack.token;
  }

  const app = new App(appConfig);

  // Add error handler for OAuth failures
  if (oauthEnabled) {
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
  app.command('/login', handleLoginCommand);
  app.view('decision_modal', handleDecisionModalSubmit);

  // Register AI decision extraction handlers
  app.event('file_shared', handleFileUpload);
  app.action('extract_decisions_from_file', handleExtractDecisionsButton);
  app.action('ignore_file_upload', handleIgnoreFileButton);
  app.action('approve_suggestion', handleApproveAction);
  app.action('reject_suggestion', handleRejectAction);
  app.action('edit_suggestion', handleEditAction);
  app.action('connect_jira_suggestion', handleConnectJiraAction);
  app.view('reject_suggestion_modal', handleRejectModalSubmit);
  app.view('edit_suggestion_modal', handleEditModalSubmit);
  app.view('connect_jira_modal', handleConnectJiraModalSubmit);

  // Start the server FIRST so Railway can health check it
  await app.start(config.port);
  console.log(`⚡️ Bot running on port ${config.port}!`);
  console.log(`🏥 Health check: http://localhost:${config.port}/health`);
  console.log(`\n🔐 Authentication:`);
  console.log(`   Login: http://localhost:${config.port}/auth/login`);
  console.log(`   Logout: http://localhost:${config.port}/auth/logout`);
  console.log(`\n📊 Dashboard (requires auth): http://localhost:${config.port}/dashboard`);

  if (oauthEnabled) {
    console.log(`\n🔧 Slack App OAuth:`);
    console.log(`   Install: http://localhost:${config.port}/slack/install`);
    console.log(`   Redirect: http://localhost:${config.port}/slack/oauth_redirect`);
  } else {
    console.log(`\nℹ️  Running in single-workspace mode`);
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

  // Initialize Notion integration (optional)
  initializeNotion();
}

// Start the application
startApp().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
