const { App, ExpressReceiver } = require('@slack/bolt');
const { MongoClient } = require('mongodb');
const config = require('./config/environment');
const { connectToMongoDB } = require('./config/database');
const MongoInstallationStore = require('./config/installationStore');
const { createSessionMiddleware } = require('./config/session');
const { requireAuth, requireAuthBrowser, requireWorkspaceAccess, addSecurityHeaders } = require('./middleware/auth');
const { getDecisions, updateDecision, deleteDecision, getStats, getAIAnalytics, healthCheck } = require('./routes/api');
const { handleSemanticSearch, handleSearchSuggestions } = require('./routes/semantic-search-api');
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
const { initializeEmbeddings } = require('./services/embeddings');

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

  // Install page (public) - redirects to Slack OAuth
  expressApp.get('/install', (req, res) => {
    const slackOAuthUrl = 'https://slack.com/oauth/v2/authorize?client_id=30663056564.10060673235955&scope=channels:history,channels:read,chat:write,chat:write.public,commands,files:read,groups:history,im:history,mpim:history,users:read,users:read.email&user_scope=';

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Install Corteza</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }
    h1 { font-size: 32px; color: #1f2937; margin-bottom: 16px; }
    p { font-size: 16px; color: #6b7280; margin-bottom: 32px; line-height: 1.6; }
    .install-btn {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background-color: #6366f1;
      color: white;
      text-decoration: none;
      padding: 16px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }
    .install-btn:hover {
      background-color: #4f46e5;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Install Corteza</h1>
    <p>Click the button below to add Corteza to your Slack workspace. You'll need admin permissions to complete the installation.</p>
    <a href="${slackOAuthUrl}" class="install-btn">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 8a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V8zm0 8a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-1z"/>
        <path d="M16 8a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3V8zm0 8a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3v-1z"/>
      </svg>
      Add to Slack
    </a>
  </div>
  <script>
    // Auto-redirect after 2 seconds
    setTimeout(() => {
      window.location.href = '${slackOAuthUrl}';
    }, 2000);
  </script>
</body>
</html>
    `);
  });

  // Protected routes - Dashboard (requires authentication, redirects to login)
  expressApp.get('/dashboard', requireAuthBrowser, serveDashboard);
  expressApp.get('/ai-analytics', requireAuthBrowser, serveAIAnalytics);

  // Protected routes - API (requires authentication + workspace access)
  expressApp.get('/api/decisions', requireAuth, requireWorkspaceAccess, getDecisions);
  expressApp.put('/api/decisions/:id', requireAuth, requireWorkspaceAccess, updateDecision);
  expressApp.delete('/api/decisions/:id', requireAuth, requireWorkspaceAccess, deleteDecision);
  expressApp.get('/api/stats', requireAuth, requireWorkspaceAccess, getStats);
  expressApp.get('/api/ai-analytics', requireAuth, requireWorkspaceAccess, getAIAnalytics);
  expressApp.post('/api/semantic-search', requireAuth, requireWorkspaceAccess, handleSemanticSearch);
  expressApp.get('/api/search-suggestions', requireAuth, requireWorkspaceAccess, handleSearchSuggestions);

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
  app.command('/memory', handleDecisionCommand); // New Team Memory command (alias)
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

  // Initialize semantic search (optional)
  initializeEmbeddings();
}

// Start the application
startApp().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
