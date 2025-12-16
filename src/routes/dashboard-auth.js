const crypto = require('crypto');

/**
 * In-memory store for one-time login tokens
 * In production, use Redis or database
 */
const loginTokens = new Map();

// Clean up expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of loginTokens.entries()) {
    if (now - data.created_at > 5 * 60 * 1000) { // 5 minutes
      loginTokens.delete(token);
    }
  }
}, 5 * 60 * 1000);

/**
 * Generates a one-time login token for dashboard access
 * Called from /login Slack command
 */
function generateLoginToken(userId, userName, workspaceId, workspaceName) {
  const token = crypto.randomBytes(32).toString('hex');

  loginTokens.set(token, {
    user_id: userId,
    user_name: userName,
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    created_at: Date.now()
  });

  return token;
}

/**
 * Handles dashboard login with one-time token
 * GET /auth/token?token=xxx
 */
function handleTokenLogin(req, res) {
  const token = req.query.token;

  if (!token) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1>Missing Token</h1>
          <p>Please use the login link from Slack.</p>
          <p>Type <code>/login</code> in your Slack workspace to get a login link.</p>
        </body>
      </html>
    `);
  }

  const userData = loginTokens.get(token);

  if (!userData) {
    return res.status(401).send(`
      <html>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1>Invalid or Expired Token</h1>
          <p>This login link is invalid or has expired (tokens expire after 5 minutes).</p>
          <p>Type <code>/login</code> in your Slack workspace to get a new login link.</p>
        </body>
      </html>
    `);
  }

  // Delete token (one-time use)
  loginTokens.delete(token);

  // Create session
  req.session.user = {
    user_id: userData.user_id,
    user_name: userData.user_name,
    workspace_id: userData.workspace_id,
    workspace_name: userData.workspace_name,
    authenticated_at: new Date().toISOString()
  };

  // Save session and redirect to dashboard
  req.session.save((err) => {
    if (err) {
      console.error('❌ Failed to save session:', err);
      return res.status(500).send('<html><body>Failed to create session</body></html>');
    }

    console.log(`✅ User logged in via token: ${userData.user_name} from workspace ${userData.workspace_name}`);
    res.redirect('/dashboard');
  });
}

/**
 * Shows instructions for logging in
 * GET /auth/login
 */
function handleLoginPage(req, res) {
  res.send(`
    <html>
      <head>
        <title>Decision Logger - Login</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 100px auto;
            padding: 40px;
            text-align: center;
            background: #f5f5f5;
          }
          .card {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          h1 {
            color: #333;
            margin-bottom: 20px;
          }
          code {
            background: #f0f0f0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 16px;
            color: #e01e5a;
          }
          .steps {
            text-align: left;
            margin: 30px 0;
          }
          .steps li {
            margin: 15px 0;
            line-height: 1.6;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🔐 Decision Logger Dashboard</h1>
          <p>To access the dashboard, get a login link from Slack:</p>

          <div class="steps">
            <ol>
              <li>Open your Slack workspace where Decision Logger is installed</li>
              <li>Type <code>/login</code> in any channel</li>
              <li>Click the login link sent to you (only visible to you)</li>
            </ol>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            Login links expire after 5 minutes for security.
          </p>
        </div>
      </body>
    </html>
  `);
}

module.exports = {
  generateLoginToken,
  handleTokenLogin,
  handleLoginPage
};
