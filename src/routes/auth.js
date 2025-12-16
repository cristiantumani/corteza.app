const config = require('../config/environment');
const crypto = require('crypto');

// Store OAuth states temporarily (in production, use Redis or database)
const oauthStates = new Map();

// Clean up expired states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) { // 10 minutes
      oauthStates.delete(state);
    }
  }
}, 10 * 60 * 1000);

/**
 * Get base URL for OAuth redirect
 */
function getBaseUrl(req) {
  // In production (Railway), use the public URL
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }

  // In development, construct from request
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host || req.get('host');
  return `${protocol}://${host}`;
}

/**
 * Initiates Slack OAuth flow for dashboard authentication
 * GET /auth/login
 */
function handleLogin(req, res) {
  try {
    // Check if OAuth is configured
    if (!config.slack.useOAuth) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>OAuth Not Configured</h1>
            <p>This app is running in single-workspace mode.</p>
            <p>To use dashboard authentication, configure OAuth credentials:</p>
            <ul style="list-style: none;">
              <li>SLACK_CLIENT_ID</li>
              <li>SLACK_CLIENT_SECRET</li>
              <li>SLACK_STATE_SECRET</li>
            </ul>
          </body>
        </html>
      `);
    }

    // Generate secure random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state with timestamp
    oauthStates.set(state, {
      timestamp: Date.now(),
      returnUrl: req.query.return || '/dashboard'
    });

    // Build Slack OAuth authorization URL
    const params = new URLSearchParams({
      client_id: config.slack.clientId,
      scope: 'identity.basic,identity.team', // Minimal scopes for user identity
      state: state,
      redirect_uri: `${getBaseUrl(req)}/auth/callback`
    });

    const authUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;

    // Redirect to Slack OAuth
    res.redirect(authUrl);

  } catch (error) {
    console.error('❌ Error in login handler:', error);
    res.status(500).json({ error: 'Failed to initiate login' });
  }
}

/**
 * Handles OAuth callback from Slack
 * GET /auth/callback?code=...&state=...
 */
async function handleCallback(req, res) {
  try {
    const code = req.query.code;
    const state = req.query.state;

    // Verify state to prevent CSRF
    if (!state || !oauthStates.has(state)) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>Invalid OAuth State</h1>
            <p>The authentication request is invalid or expired.</p>
            <a href="/auth/login">Try again</a>
          </body>
        </html>
      `);
    }

    // Get return URL from state
    const stateData = oauthStates.get(state);
    oauthStates.delete(state); // Use state only once

    if (!code) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>Authorization Failed</h1>
            <p>No authorization code received from Slack.</p>
            <a href="/auth/login">Try again</a>
          </body>
        </html>
      `);
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: config.slack.clientId,
        client_secret: config.slack.clientSecret,
        code: code,
        redirect_uri: `${getBaseUrl(req)}/auth/callback`
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.ok) {
      console.error('❌ Slack OAuth error:', tokenData.error);
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>Authentication Error</h1>
            <p>Slack returned an error: ${tokenData.error}</p>
            <a href="/auth/login">Try again</a>
          </body>
        </html>
      `);
    }

    // Get user identity
    const userResponse = await fetch('https://slack.com/api/users.identity', {
      headers: {
        'Authorization': `Bearer ${tokenData.authed_user.access_token}`
      }
    });

    const userData = await userResponse.json();

    if (!userData.ok) {
      console.error('❌ Failed to get user identity:', userData.error);
      return res.status(500).send(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>Failed to Get User Info</h1>
            <p>Could not retrieve your Slack profile.</p>
            <a href="/auth/login">Try again</a>
          </body>
        </html>
      `);
    }

    // Create session with user data
    req.session.user = {
      user_id: userData.user.id,
      user_name: userData.user.name,
      workspace_id: userData.team.id,
      workspace_name: userData.team.name,
      authenticated_at: new Date().toISOString()
    };

    console.log(`✅ User authenticated: ${userData.user.name} from workspace ${userData.team.name}`);

    // Save session and redirect
    req.session.save((err) => {
      if (err) {
        console.error('❌ Failed to save session:', err);
        return res.status(500).send('<html><body>Failed to create session</body></html>');
      }

      // Redirect to return URL (default: dashboard)
      const returnUrl = stateData.returnUrl || '/dashboard';
      res.redirect(returnUrl);
    });

  } catch (error) {
    console.error('❌ Error in OAuth callback:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1>Authentication Error</h1>
          <p>An unexpected error occurred during authentication.</p>
          <a href="/auth/login">Try again</a>
        </body>
      </html>
    `);
  }
}

/**
 * Returns current authenticated user info
 * GET /auth/me
 */
function handleMe(req, res) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      authenticated: false,
      error: 'Not authenticated'
    });
  }

  res.json({
    authenticated: true,
    user: req.session.user
  });
}

/**
 * Logs out user by destroying session
 * GET /auth/logout
 */
function handleLogout(req, res) {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('❌ Error destroying session:', err);
      }

      // Clear session cookie and redirect to login
      res.clearCookie('decision_logger_sid');
      res.redirect('/auth/login');
    });
  } else {
    res.redirect('/auth/login');
  }
}

module.exports = {
  handleLogin,
  handleCallback,
  handleMe,
  handleLogout
};
