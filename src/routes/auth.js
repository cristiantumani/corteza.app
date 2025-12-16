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
 * Initiates Slack OAuth flow for dashboard authentication
 * GET /auth/login
 */
async function handleLogin(req, res) {
  try {
    // Check if OAuth is configured
    if (!config.slack.useOAuth) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
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
      return;
    }

    // Generate secure random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state with timestamp
    oauthStates.set(state, {
      timestamp: Date.now(),
      returnUrl: req.query?.return || '/dashboard'
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
    res.writeHead(302, { 'Location': authUrl });
    res.end();

  } catch (error) {
    console.error('❌ Error in login handler:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to initiate login' }));
  }
}

/**
 * Handles OAuth callback from Slack
 * GET /auth/callback?code=...&state=...
 */
async function handleCallback(req, res) {
  try {
    const queryParams = parseQueryParams(req.url);
    const code = queryParams.code;
    const state = queryParams.state;

    // Verify state to prevent CSRF
    if (!state || !oauthStates.has(state)) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>Invalid OAuth State</h1>
            <p>The authentication request is invalid or expired.</p>
            <a href="/auth/login">Try again</a>
          </body>
        </html>
      `);
      return;
    }

    // Get return URL from state
    const stateData = oauthStates.get(state);
    oauthStates.delete(state); // Use state only once

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>Authorization Failed</h1>
            <p>No authorization code received from Slack.</p>
            <a href="/auth/login">Try again</a>
          </body>
        </html>
      `);
      return;
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
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>Authentication Error</h1>
            <p>Slack returned an error: ${tokenData.error}</p>
            <a href="/auth/login">Try again</a>
          </body>
        </html>
      `);
      return;
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
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h1>Failed to Get User Info</h1>
            <p>Could not retrieve your Slack profile.</p>
            <a href="/auth/login">Try again</a>
          </body>
        </html>
      `);
      return;
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
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body>Failed to create session</body></html>');
        return;
      }

      // Redirect to return URL (default: dashboard)
      const returnUrl = stateData.returnUrl || '/dashboard';
      res.writeHead(302, { 'Location': returnUrl });
      res.end();
    });

  } catch (error) {
    console.error('❌ Error in OAuth callback:', error);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`
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
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authenticated: false,
      error: 'Not authenticated'
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    authenticated: true,
    user: req.session.user
  }));
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

      // Clear session cookie
      res.writeHead(302, {
        'Location': '/auth/login',
        'Set-Cookie': 'decision_logger_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
      });
      res.end();
    });
  } else {
    res.writeHead(302, { 'Location': '/auth/login' });
    res.end();
  }
}

/**
 * Parse query parameters from URL
 * @param {string} url - Request URL
 * @returns {Object} Parsed query parameters
 */
function parseQueryParams(url) {
  const params = {};
  const urlParts = url.split('?');
  if (urlParts.length > 1) {
    urlParts[1].split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }
  return params;
}

/**
 * Get base URL for OAuth redirect
 * @param {Object} req - Request object
 * @returns {string} Base URL
 */
function getBaseUrl(req) {
  // In production (Railway), use the public URL
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }

  // In development, construct from request
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

module.exports = {
  handleLogin,
  handleCallback,
  handleMe,
  handleLogout
};
