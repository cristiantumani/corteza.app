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
 * Shows hybrid login page (Email + Slack)
 * GET /auth/login
 */
function handleLoginPage(req, res) {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Login - Corteza Team Memory</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            max-width: 500px;
            width: 100%;
          }
          .card {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            margin-bottom: 20px;
          }
          h1 {
            color: #1d1d1f;
            margin-bottom: 10px;
            font-size: 28px;
          }
          .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 15px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 8px;
            color: #1d1d1f;
          }
          input {
            width: 100%;
            padding: 12px;
            border: 1px solid #e1e4e8;
            border-radius: 6px;
            font-size: 15px;
            transition: border-color 0.2s;
          }
          input:focus {
            outline: none;
            border-color: #000;
          }
          .btn-primary {
            width: 100%;
            padding: 14px;
            background: #000;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 15px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }
          .btn-primary:hover:not(:disabled) {
            background: #2d2d2d;
            transform: translateY(-1px);
          }
          .btn-primary:disabled {
            background: #e1e4e8;
            color: #666;
            cursor: not-allowed;
          }
          .message {
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 14px;
            display: none;
          }
          .message.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
          }
          .message.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
          }
          .divider {
            text-align: center;
            margin: 30px 0;
            position: relative;
          }
          .divider:before {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 1px;
            background: #e1e4e8;
          }
          .divider span {
            background: white;
            padding: 0 15px;
            color: #666;
            font-size: 14px;
            position: relative;
          }
          .slack-section {
            text-align: center;
          }
          .slack-section h2 {
            font-size: 18px;
            color: #1d1d1f;
            margin-bottom: 15px;
          }
          code {
            background: #f0f0f0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 15px;
            color: #e01e5a;
          }
          small {
            display: block;
            color: #999;
            font-size: 13px;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <h1>🧠 Welcome to Corteza</h1>
            <p class="subtitle">Your team's searchable knowledge base</p>

            <div id="message" class="message"></div>

            <form id="email-form">
              <div class="form-group">
                <label for="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  placeholder="you@company.com"
                  required
                  autocomplete="email"
                />
              </div>

              <div class="form-group">
                <label for="workspace">Workspace Name</label>
                <input
                  type="text"
                  id="workspace"
                  placeholder="my-team"
                  required
                  autocomplete="organization"
                  pattern="[a-zA-Z0-9-]+"
                  minlength="2"
                />
                <small>Use lowercase letters, numbers, and hyphens only</small>
              </div>

              <button type="submit" class="btn-primary" id="submit-btn">
                Send Magic Link
              </button>
            </form>

            <div class="divider">
              <span>or</span>
            </div>

            <div class="slack-section">
              <h2>Login with Slack</h2>
              <p style="color: #666; line-height: 1.6;">
                If your team uses Slack, type <code>/login</code> in your workspace to get a login link.
              </p>
            </div>
          </div>
        </div>

        <script>
          const form = document.getElementById('email-form');
          const submitBtn = document.getElementById('submit-btn');
          const messageEl = document.getElementById('message');

          form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value.trim();
            const workspace = document.getElementById('workspace').value.trim().toLowerCase();

            // Clear previous messages
            messageEl.style.display = 'none';
            messageEl.className = 'message';

            // Disable button
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';

            try {
              const response = await fetch('/auth/send-magic-link', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  email: email,
                  workspace_name: workspace
                })
              });

              const data = await response.json();

              if (response.ok && data.success) {
                // Success
                messageEl.textContent = data.message;
                messageEl.classList.add('success');
                messageEl.style.display = 'block';
                form.reset();
              } else {
                // Error
                messageEl.textContent = data.error || 'Failed to send magic link';
                messageEl.classList.add('error');
                messageEl.style.display = 'block';
              }
            } catch (error) {
              messageEl.textContent = 'Network error. Please try again.';
              messageEl.classList.add('error');
              messageEl.style.display = 'block';
            } finally {
              // Re-enable button
              submitBtn.disabled = false;
              submitBtn.textContent = 'Send Magic Link';
            }
          });
        </script>
      </body>
    </html>
  `);
}

module.exports = {
  generateLoginToken,  // Now exported for email-auth to use
  handleTokenLogin,
  handleLoginPage
};
