const { App } = require('@slack/bolt');
const { MongoClient } = require('mongodb');
const config = require('./config/environment');
const { connectToMongoDB } = require('./config/database');
const MongoInstallationStore = require('./config/installationStore');
const { createSessionMiddleware } = require('./config/session');
const { requireAuth, requireWorkspaceAccess, addSecurityHeaders } = require('./middleware/auth');
const { getDecisions, updateDecision, deleteDecision, getStats, healthCheck } = require('./routes/api');
const { serveDashboard, redirectToDashboard } = require('./routes/dashboard');
const { exportWorkspaceData, deleteAllWorkspaceData, getWorkspaceDataInfo } = require('./routes/gdpr');
const { handleLogin, handleCallback, handleMe, handleLogout } = require('./routes/auth');
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
 * Wraps a route handler with session and authentication middleware
 * @param {Function} handler - Original handler function
 * @param {Object} options - Options for middleware { auth: boolean, workspaceAccess: boolean }
 * @returns {Function} Wrapped handler
 */
function withMiddleware(handler, options = {}) {
  const sessionMiddleware = createSessionMiddleware();

  return async (req, res) => {
    // Apply security headers
    addSecurityHeaders(req, res, () => {});

    // Apply session middleware
    sessionMiddleware(req, res, async () => {
      // If authentication required, check it
      if (options.auth) {
        // Check if authenticated
        if (!req.session || !req.session.user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Unauthorized',
            message: 'Please log in at /auth/login to access this resource'
          }));
          return;
        }

        // If workspace access verification required
        if (options.workspaceAccess) {
          requireWorkspaceAccess(req, res, () => {
            // Call original handler
            handler(req, res);
          });
          return;
        }
      }

      // Call original handler
      await handler(req, res);
    });
  };
}

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

  // Initialize Slack app with OAuth or single-workspace mode
  const appConfig = {
    signingSecret: config.slack.signingSecret,
    socketMode: false,
    customRoutes: [
      // Redirect root to dashboard
      {
        path: '/',
        method: ['GET'],
        handler: withMiddleware(redirectToDashboard)
      },
      // Health check endpoint (public - no auth needed)
      {
        path: '/health',
        method: ['GET'],
        handler: healthCheck
      },
      // Authentication routes (public)
      {
        path: '/auth/login',
        method: ['GET'],
        handler: withMiddleware(handleLogin)
      },
      {
        path: '/auth/callback',
        method: ['GET'],
        handler: withMiddleware(handleCallback)
      },
      {
        path: '/auth/me',
        method: ['GET'],
        handler: withMiddleware(handleMe)
      },
      {
        path: '/auth/logout',
        method: ['GET'],
        handler: withMiddleware(handleLogout)
      },
      // Dashboard (requires auth)
      {
        path: '/dashboard',
        method: ['GET'],
        handler: withMiddleware(serveDashboard, { auth: true })
      },
      // API: Get decisions with filtering (requires auth + workspace access)
      {
        path: '/api/decisions',
        method: ['GET'],
        handler: withMiddleware(getDecisions, { auth: true, workspaceAccess: true })
      },
      // API: Update decision (requires auth + workspace access)
      {
        path: '/api/decisions/:id',
        method: ['PUT'],
        handler: withMiddleware(updateDecision, { auth: true, workspaceAccess: true })
      },
      // API: Delete decision (requires auth + workspace access)
      {
        path: '/api/decisions/:id',
        method: ['DELETE'],
        handler: withMiddleware(deleteDecision, { auth: true, workspaceAccess: true })
      },
      // API: Get statistics (requires auth + workspace access)
      {
        path: '/api/stats',
        method: ['GET'],
        handler: withMiddleware(getStats, { auth: true, workspaceAccess: true })
      },
      // GDPR: Get workspace data info (requires auth + workspace access)
      {
        path: '/api/gdpr/info',
        method: ['GET'],
        handler: withMiddleware(getWorkspaceDataInfo, { auth: true, workspaceAccess: true })
      },
      // GDPR: Export workspace data (requires auth + workspace access)
      {
        path: '/api/gdpr/export',
        method: ['GET'],
        handler: withMiddleware(exportWorkspaceData, { auth: true, workspaceAccess: true })
      },
      // GDPR: Delete all workspace data (requires auth + workspace access)
      {
        path: '/api/gdpr/delete-all',
        method: ['DELETE'],
        handler: withMiddleware(deleteAllWorkspaceData, { auth: true, workspaceAccess: true })
      }
    ]
  };

  // Add OAuth configuration if OAuth is enabled and installation store connected
  if (oauthEnabled && installationStore) {
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
      stateVerification: true, // Enable CSRF protection via state parameter verification
    };
  } else {
    // Single-workspace mode - use bot token
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
