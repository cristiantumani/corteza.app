const { App, ExpressReceiver } = require('@slack/bolt');
const { MongoClient } = require('mongodb');
const config = require('./config/environment');
const analytics = require('./integrations/posthog/client');
const { connectToMongoDB } = require('./config/database');
const MongoInstallationStore = require('./config/installationStore');
const { createSessionMiddleware } = require('./config/session');
const { rejectOperatorKeys, jsonBodyErrors } = require('./middleware/input-safety');
const { requireAuth, requireAuthBrowser, requireWorkspaceAccess, addSecurityHeaders, apiRateLimiter, authRateLimiter, aiRateLimiter } = require('./middleware/auth');
const { requireAiBudget } = require('./core/usage/ai-usage');
const { getDecisions, updateDecision, deleteDecision, getStats, healthCheck, submitFeedback, extractDecisionsFromText, checkAdminStatus, createMemory } = require('./routes/api');
const { handleSemanticSearch, handleSearchSuggestions } = require('./routes/semantic-search-api');
const { serveDashboard, serveAISearch, serveSettings, redirectToDashboard } = require('./routes/dashboard');
const { exportWorkspaceData, deleteAllWorkspaceData, getWorkspaceDataInfo } = require('./routes/gdpr');
const { handleMe, handleLogout } = require('./routes/auth');
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

  // Compress responses (HTML, JSON, JS, CSS)
  expressApp.use(require('compression')());

  // Add security headers to all responses
  expressApp.use(addSecurityHeaders);

  // Serve static files (favicon, logo, scripts, styles) before the session middleware,
  // so assets don't load the session from MongoDB. Browsers reuse them for 10 minutes
  // (page to page navigation), then revalidate with the ETag; bump ?v= for instant updates.
  expressApp.use(require('express').static('public', { maxAge: '10m' }));

  // Add session middleware to all other routes
  const sessionMiddleware = createSessionMiddleware();
  expressApp.use(sessionMiddleware);

  // Product analytics: events in a request are attributed to the signed-in user
  analytics.setupRequestContext(expressApp);

  // JSON bodies are parsed once for every route, and refused when they carry MongoDB
  // operators ({"$ne": ""}) or __proto__ keys (middleware/input-safety.js). Slack's own
  // routes were registered by Bolt before this, with their raw body for signature checks.
  expressApp.use(require('express').json({ limit: '1mb' }));
  expressApp.use(rejectOperatorKeys);

  // Public routes (no authentication required)
  expressApp.get('/', redirectToDashboard);
  expressApp.get('/health', healthCheck);

  // Test route to verify routing works
  expressApp.get('/test', (req, res) => {
    res.send('Route registration works!');
  });

  // Authentication: Google sign-in only (login page, OAuth callback)
  expressApp.use(require('./auth/routes'));
  expressApp.get('/auth/me', apiRateLimiter, handleMe);
  expressApp.get('/auth/logout', apiRateLimiter, handleLogout);

  // Connect Google Meet (automatic decision capture)
  expressApp.use(require('./integrations/google/routes'));

  // Action items ("pendientes"): page and API
  expressApp.use(require('./http/action-items'));
  expressApp.use(require('./http/home'));
  expressApp.use(require('./http/questions-risks'));
  expressApp.use(require('./http/sensitive'));
  // Decide and close: a typed decision closes what it settles (core/agent/decide)
  expressApp.use(require('./http/decide'));

  // Confirm / dismiss AI-captured outcomes
  expressApp.use(require('./http/decision-review'));
  expressApp.use(require('./http/search-feedback'));

  // Context for the AI: company (admins) and personal, used when reading meetings
  expressApp.use(require('./http/ai-context'));

  // First-run onboarding on Home
  expressApp.use(require('./http/onboarding'));

  // Each person's time zone (the daily summary goes out at 8:00 local time)
  expressApp.use(require('./http/timezone'));
  expressApp.use(require('./http/digest-voice'));
  // The app language picked in Settings (core/i18n)
  expressApp.use(require('./http/language'));

  // Get started: sign up with Google (Slack is only an input source, not a way to sign up)
  expressApp.get('/get-started', (req, res) => {
    res.redirect('/auth/login');
  });

  // Weekly digest unsubscribe (public — authorized by a signed link)
  expressApp.use(require('./routes/digest'));

  // Private beta: approve a tester from the early access email (public — authorized by a signed link)
  expressApp.use(require('./http/beta'));

  // Privacy policy and terms of service (public; linked from the login page, the sidebar and Google's consent screen)
  expressApp.use(require('./http/legal'));

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
  expressApp.get('/select-space', redirectToDashboard); // old space selector page: Home picks your space now
  expressApp.get('/dashboard', requireAuthBrowser, serveDashboard); // New Tailwind/Material Design dashboard
  expressApp.get('/ai-analytics', (req, res) => res.redirect(301, '/dashboard')); // removed page: old bookmarks land on Home
  expressApp.get('/ai-search', requireAuthBrowser, serveAISearch); // AI search interface
  expressApp.get('/settings', requireAuthBrowser, serveSettings);

  // Feedback route (early registration to avoid conflicts, with rate limiting)
  expressApp.post('/api/feedback', apiRateLimiter, require('express').json(), requireAuth, submitFeedback);

  // AI extraction route (session-authenticated, with stricter rate limiting)
  expressApp.post('/api/extract-decisions', aiRateLimiter, require('express').json(), requireAuth, requireWorkspaceAccess, requireAiBudget, extractDecisionsFromText);

  // Protected routes - API (requires authentication + workspace access + rate limiting)
  expressApp.get('/api/decisions', apiRateLimiter, requireAuth, requireWorkspaceAccess, getDecisions);
  expressApp.put('/api/decisions/:id', apiRateLimiter, requireAuth, requireWorkspaceAccess, updateDecision);
  expressApp.delete('/api/decisions/:id', apiRateLimiter, requireAuth, requireWorkspaceAccess, deleteDecision);
  expressApp.get('/api/stats', apiRateLimiter, requireAuth, requireWorkspaceAccess, getStats);
  expressApp.post('/api/semantic-search', aiRateLimiter, require('express').json(), requireAuth, requireWorkspaceAccess, requireAiBudget, handleSemanticSearch);
  expressApp.get('/api/search-suggestions', apiRateLimiter, requireAuth, requireWorkspaceAccess, handleSearchSuggestions);
  expressApp.post('/api/memory/create', apiRateLimiter, require('express').json(), requireAuth, createMemory);

  // Protected routes - GDPR (requires authentication + workspace access + rate limiting)
  expressApp.get('/api/gdpr/info', apiRateLimiter, requireAuth, requireWorkspaceAccess, getWorkspaceDataInfo);
  expressApp.get('/api/gdpr/export', apiRateLimiter, requireAuth, requireWorkspaceAccess, exportWorkspaceData);
  expressApp.delete('/api/gdpr/delete-all', apiRateLimiter, requireAuth, requireWorkspaceAccess, deleteAllWorkspaceData);


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

  expressApp.use(jsonBodyErrors); // a malformed body is the client's mistake, not an exception to report
  analytics.setupErrorHandler(expressApp);

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
  // Railway sends SIGTERM on redeploys: send queued analytics events before exiting
  if (analytics.posthog) {
    process.once('SIGTERM', () => {
      analytics.shutdownAnalytics().catch(() => {}).finally(() => process.exit(0));
    });
  }
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

  // Initialize semantic search (optional)
  initializeEmbeddings();

  // Start re-engagement job for inactive extension installs
  require('./jobs/reengagement').startReengagementJob();
  require('./jobs/weekly-digest').startWeeklyDigestJob();
  require('./jobs/daily-digest').startDailyDigestJob();
  require('./jobs/meet-poller').startMeetPollerJob();
}

// Start the application
startApp().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
