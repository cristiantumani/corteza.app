const { App, ExpressReceiver } = require('@slack/bolt');
const { MongoClient } = require('mongodb');
const config = require('./config/environment');
const { connectToMongoDB } = require('./config/database');
const MongoInstallationStore = require('./config/installationStore');
const { createSessionMiddleware } = require('./config/session');
const { requireAuth, requireAuthBrowser, requireWorkspaceAccess, addSecurityHeaders } = require('./middleware/auth');
const { getDecisions, updateDecision, deleteDecision, getStats, healthCheck } = require('./routes/api');
const { serveDashboard, redirectToDashboard } = require('./routes/dashboard');
const { exportWorkspaceData, deleteAllWorkspaceData, getWorkspaceDataInfo } = require('./routes/gdpr');
const { handleLogin, handleMe, handleLogout } = require('./routes/auth');
const {
  handleDecisionCommand,
  handleDecisionModalSubmit,
  handleDecisionsCommand
} = require('./routes/slack');
const {
  handleFileUpload,
  handleExtractDecisionsButton,
  handleIgnoreFileButton,
  handleApproveAction,
  handleRejectAction,
  handleEditAction,
  handleEditModalSubmit,
  handleConnectJiraAction,
  handleConnectJiraModalSubmit
} = require('./routes/ai-decisions');

/**
 * Fix corrupted OAuth installation records
 * Runs once at startup to clean up any null team_id records
 */
async function fixOAuthDatabase() {
  console.log('🔧 Checking for corrupted OAuth records...');

  const client = new MongoClient(config.mongodb.uri);

  try {
    await client.connect();
    const db = client.db('decision-logger');
    const collection = db.collection('slack_installations');

    // Drop ALL old indexes (both team.id and team_id if they exist)
    try {
      await collection.dropIndex('team.id_1');
      console.log('✅ Dropped old team.id_1 index');
    } catch (error) {
      // Index doesn't exist, that's fine
    }

    try {
      await collection.dropIndex('team_id_1');
      console.log('✅ Dropped old team_id_1 index');
    } catch (error) {
      // Index doesn't exist, that's fine
    }

    // Delete corrupted records (both old 'team.id' format and new 'team_id' format)
    const result = await collection.deleteMany({
      $or: [
        { team_id: null },
        { team_id: { $exists: false } },
        { 'team.id': null },
        { 'team.id': { $exists: false } }
      ]
    });

    if (result.deletedCount > 0) {
      console.log(`✅ Cleaned up ${result.deletedCount} corrupted record(s)`);
    }

    console.log('✅ OAuth database cleanup complete');

  } catch (error) {
    console.warn('⚠️  Could not fix OAuth database:', error.message);
  } finally {
    await client.close();
  }
}

/**
 * Main application entry point
 */
async function startApp() {
  // Validate environment variables
  config.validateEnvironment();

  // Fix OAuth database if in OAuth mode
  if (config.slack.useOAuth) {
    await fixOAuthDatabase();
  }

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

  // Create ExpressReceiver for custom Express middleware support
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
      stateVerification: true, // Enable CSRF protection
      callbackOptions: {
        success: async (installation, installOptions, req, res) => {
          // Create session after successful OAuth installation
          req.session.user = {
            user_id: installation.user.id,
            user_name: installation.user.name || 'User',
            workspace_id: installation.team.id,
            workspace_name: installation.team.name || 'Workspace',
            authenticated_at: new Date().toISOString()
          };

          // Save session and redirect to dashboard
          req.session.save((err) => {
            if (err) {
              console.error('❌ Failed to save session after OAuth:', err);
              res.send('<html><body>Authentication successful, but failed to create session. Please try accessing <a href="/dashboard">/dashboard</a></body></html>');
              return;
            }

            console.log(`✅ User authenticated via bot OAuth: ${installation.user.name || installation.user.id} from workspace ${installation.team.name || installation.team.id}`);
            res.redirect('/dashboard');
          });
        },
        failure: (error, installOptions, req, res) => {
          console.error('❌ OAuth installation failed:', error);
          res.send('<html><body>Installation failed. Please try again at <a href="/slack/install">/slack/install</a></body></html>');
        }
      }
    };
  }

  const receiver = new ExpressReceiver(receiverConfig);

  // Get Express app from receiver
  const expressApp = receiver.app;

  // Add session middleware (must be before routes)
  const sessionMiddleware = createSessionMiddleware();
  expressApp.use(sessionMiddleware);

  // Add security headers to all responses
  expressApp.use(addSecurityHeaders);

  // Public routes (no authentication required)
  expressApp.get('/', redirectToDashboard);
  expressApp.get('/health', healthCheck);

  // Authentication routes (public)
  expressApp.get('/auth/login', handleLogin);
  expressApp.get('/auth/me', handleMe);
  expressApp.get('/auth/logout', handleLogout);

  // Protected routes - Dashboard (requires authentication, redirects to login)
  expressApp.get('/dashboard', requireAuthBrowser, serveDashboard);

  // Protected routes - API (requires authentication + workspace access)
  expressApp.get('/api/decisions', requireAuth, requireWorkspaceAccess, getDecisions);
  expressApp.put('/api/decisions/:id', requireAuth, requireWorkspaceAccess, updateDecision);
  expressApp.delete('/api/decisions/:id', requireAuth, requireWorkspaceAccess, deleteDecision);
  expressApp.get('/api/stats', requireAuth, requireWorkspaceAccess, getStats);

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
  app.view('decision_modal', handleDecisionModalSubmit);

  // Register AI decision extraction handlers
  app.event('file_shared', handleFileUpload);
  app.action('extract_decisions_from_file', handleExtractDecisionsButton);
  app.action('ignore_file_upload', handleIgnoreFileButton);
  app.action('approve_suggestion', handleApproveAction);
  app.action('reject_suggestion', handleRejectAction);
  app.action('edit_suggestion', handleEditAction);
  app.action('connect_jira_suggestion', handleConnectJiraAction);
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
}

// Start the application
startApp().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
