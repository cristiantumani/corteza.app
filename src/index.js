const { App, ExpressReceiver } = require('@slack/bolt');
const { MongoClient } = require('mongodb');
const config = require('./config/environment');
const { connectToMongoDB } = require('./config/database');
const MongoInstallationStore = require('./config/installationStore');
const { createSessionMiddleware } = require('./config/session');
const { requireAuth, requireAuthBrowser, requireWorkspaceAccess, addSecurityHeaders, apiRateLimiter, authRateLimiter, aiRateLimiter } = require('./middleware/auth');
const { getDecisions, getDecisionById, updateDecision, deleteDecision, getStats, getAIAnalytics, healthCheck, submitFeedback, extractDecisionsFromText, checkAdminStatus, createMemory } = require('./routes/api');
const { handleSemanticSearch, handleSearchSuggestions } = require('./routes/semantic-search-api');
const { handleGenerateApiKey, handleListApiKeys, handleRevokeApiKey } = require('./routes/api-keys');
const { requireApiKey } = require('./middleware/api-key-auth');
const { serveDashboard, serveAIAnalytics, serveSettings, redirectToDashboard } = require('./routes/dashboard');
const { exportWorkspaceData, deleteAllWorkspaceData, getWorkspaceDataInfo, exportObsidian } = require('./routes/gdpr');
const { importFromObsidian, saveDirectFromObsidian } = require('./routes/obsidian-import');
const { handleMe, handleLogout } = require('./routes/auth');
const { handleLoginPage, handleTokenLogin, handleOnboardingPage } = require('./routes/dashboard-auth');
const { handleSendMagicLink } = require('./routes/email-auth');
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
const { handleSettingsCommand, handleSettingsModalSubmit } = require('./routes/settings');
const { getSettings, testJiraSettings, saveJiraSettings } = require('./routes/settings-api');
const { handlePermissionsCommand } = require('./routes/permissions');
const { requireWorkspaceAdmin } = require('./middleware/admin-check');
const { initializeNotion } = require('./services/notion');
const { initializeEmbeddings } = require('./services/embeddings');
const {
  handleDemoEntry,
  handleDemoDashboard,
  handleDemoDecisions,
  handleDemoStats,
  handleDemoSearch
} = require('./routes/demo');

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

  // Trust Railway proxy (required for OAuth redirect_uri generation and rate limiting)
  // Use '1' to trust only the first proxy (Railway edge), not all proxies
  // This prevents IP spoofing attacks on rate limiters
  expressApp.set('trust proxy', 1);

  // Add session middleware to all routes
  const sessionMiddleware = createSessionMiddleware();
  expressApp.use(sessionMiddleware);

  // Add security headers to all responses
  expressApp.use(addSecurityHeaders);

  // Serve static files (favicon, logo, etc.)
  expressApp.use(require('express').static('public'));

  // Public routes (no authentication required)
  expressApp.get('/', redirectToDashboard);
  expressApp.get('/health', healthCheck);

  // Test route to verify routing works
  expressApp.get('/test', (req, res) => {
    res.send('Route registration works!');
  });

  // Authentication routes (public, with rate limiting)
  expressApp.get('/auth/login', authRateLimiter, (req, res) => {
    // Serve new hybrid login page
    res.sendFile(require('path').join(__dirname, 'views', 'login-new.html'));
  });
  expressApp.post('/auth/send-magic-link', authRateLimiter, require('express').json(), handleSendMagicLink); // Sends email magic link
  expressApp.get('/auth/token', authRateLimiter, handleTokenLogin); // Validates token and creates session
  expressApp.get('/auth/onboarding', handleOnboardingPage); // Shows onboarding for new users (requires session)
  expressApp.get('/auth/me', apiRateLimiter, handleMe);
  expressApp.get('/auth/logout', apiRateLimiter, handleLogout);

  // New hybrid authentication endpoints
  expressApp.use(require('./routes/auth-hybrid'));

  // Install page (public) - redirects to Bolt-managed OAuth which handles state/CSRF properly
  expressApp.get('/get-started', (req, res) => {
    res.redirect('/slack/install');
  });

  // Demo routes (public — no auth required)
  expressApp.get('/demo', apiRateLimiter, handleDemoEntry);
  expressApp.get('/demo/dashboard', apiRateLimiter, handleDemoDashboard);
  expressApp.get('/demo/api/decisions', apiRateLimiter, handleDemoDecisions);
  expressApp.get('/demo/api/stats', apiRateLimiter, handleDemoStats);
  expressApp.post('/demo/api/search', aiRateLimiter, handleDemoSearch);

  // Workspace invitation page (public - authentication checked by page itself)
  expressApp.get('/invite/:invite_id', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'views', 'invite.html'));
  });

  // Protected routes - Dashboard (requires authentication, redirects to login)
  expressApp.get('/dashboard', requireAuthBrowser, serveDashboard);
  expressApp.get('/ai-analytics', requireAuthBrowser, serveAIAnalytics);
  expressApp.get('/settings', requireAuthBrowser, serveSettings);

  // Feedback route (early registration to avoid conflicts, with rate limiting)
  expressApp.post('/api/feedback', apiRateLimiter, require('express').json(), requireAuth, submitFeedback);

  // AI extraction route (for n8n automation, with stricter rate limiting)
  expressApp.post('/api/extract-decisions', aiRateLimiter, require('express').json(), requireAuth, extractDecisionsFromText);

  // Protected routes - API (requires authentication + workspace access + rate limiting)
  expressApp.get('/api/decisions', apiRateLimiter, requireAuth, requireWorkspaceAccess, getDecisions);
  expressApp.put('/api/decisions/:id', apiRateLimiter, requireAuth, requireWorkspaceAccess, updateDecision);
  expressApp.delete('/api/decisions/:id', apiRateLimiter, requireAuth, requireWorkspaceAccess, deleteDecision);
  expressApp.get('/api/stats', apiRateLimiter, requireAuth, requireWorkspaceAccess, getStats);
  expressApp.get('/api/ai-analytics', apiRateLimiter, requireAuth, requireWorkspaceAccess, getAIAnalytics);
  expressApp.post('/api/semantic-search', aiRateLimiter, requireAuth, requireWorkspaceAccess, handleSemanticSearch);
  expressApp.get('/api/search-suggestions', apiRateLimiter, requireAuth, requireWorkspaceAccess, handleSearchSuggestions);
  expressApp.post('/api/memory/create', apiRateLimiter, require('express').json(), requireAuth, createMemory);

  // API Key management routes (requires session authentication)
  expressApp.post('/api/keys/generate', apiRateLimiter, require('express').json(), requireAuth, handleGenerateApiKey);
  expressApp.get('/api/keys', apiRateLimiter, requireAuth, handleListApiKeys);
  expressApp.delete('/api/keys/:keyPreview', apiRateLimiter, requireAuth, handleRevokeApiKey);

  // Integration API routes (requires API key authentication)
  expressApp.get('/api/v1/decisions/:id', apiRateLimiter, requireApiKey, getDecisionById);

  // Obsidian integration (requires API key authentication)
  expressApp.post('/api/v1/import/obsidian', aiRateLimiter, require('express').json(), requireApiKey, importFromObsidian);
  expressApp.post('/api/v1/import/obsidian/direct', apiRateLimiter, require('express').json(), requireApiKey, saveDirectFromObsidian);

  // Protected routes - GDPR (requires authentication + workspace access + rate limiting)
  expressApp.get('/api/gdpr/info', apiRateLimiter, requireAuth, requireWorkspaceAccess, getWorkspaceDataInfo);
  expressApp.get('/api/gdpr/export', apiRateLimiter, requireAuth, requireWorkspaceAccess, exportWorkspaceData);
  expressApp.delete('/api/gdpr/delete-all', apiRateLimiter, requireAuth, requireWorkspaceAccess, deleteAllWorkspaceData);

  // Obsidian export (requires authentication + workspace access)
  expressApp.get('/api/export/obsidian', apiRateLimiter, requireAuth, requireWorkspaceAccess, exportObsidian);

  // Protected routes - Settings (requires authentication + workspace admin)
  expressApp.get('/api/settings', apiRateLimiter, requireAuth, getSettings);
  expressApp.post('/api/settings/jira/test', apiRateLimiter, require('express').json(), requireAuth, requireWorkspaceAdmin, testJiraSettings);
  expressApp.post('/api/settings/jira', apiRateLimiter, require('express').json(), requireAuth, requireWorkspaceAdmin, saveJiraSettings);

  // Protected routes - Permissions (requires authentication)
  expressApp.get('/api/permissions/check', apiRateLimiter, requireAuth, requireWorkspaceAccess, checkAdminStatus);

  // Chrome extension install tracking routes (partially public - install endpoint requires no auth)
  expressApp.use('/api/extension', require('./routes/extension'));

  // Spaces API routes (requires authentication)
  expressApp.use(require('./routes/spaces-api'));

  // Workspace invitations API routes (partially public - invite details endpoint is public)
  expressApp.use(require('./routes/invites-api'));

  // AI extraction for web (requires authentication)
  expressApp.use(require('./routes/ai-extract-web'));

  // Password authentication (partially public - login endpoint is public)
  expressApp.use(require('./routes/password-auth'));

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
  app.command('/settings', handleSettingsCommand);
  app.command('/permissions', handlePermissionsCommand);
  app.view('decision_modal', handleDecisionModalSubmit);
  app.view('settings_jira_modal', handleSettingsModalSubmit);

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

  // Start re-engagement job for inactive extension installs
  require('./jobs/reengagement').startReengagementJob();
}

// Start the application
startApp().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
