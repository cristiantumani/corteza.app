const crypto = require('crypto');
const { getWorkspaceMembersCollection, getWorkspaceAdminsCollection } = require('../config/database');
const { createLoginToken, peekLoginToken, consumeLoginToken } = require('../services/login-tokens');
const { ensureDefaultSpace } = require('../services/spaces');

/**
 * Generates a one-time login token for dashboard access
 * Called from /login Slack command, email magic links and password login
 * @param {string} origin - 'slack' | 'email' | 'password' | 'password_reset'
 * @param {number} [ttlMs] - Token lifetime (default 5 minutes)
 * @returns {Promise<string>}
 */
async function generateLoginToken(userId, userName, workspaceId, workspaceName, email = null, origin = 'email', ttlMs) {
  return createLoginToken({
    user_id: userId,
    user_name: userName,
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    email: email,
    origin
  }, ttlMs);
}

function tokenErrorPage(res, status, title, message) {
  return res.status(status).send(`
      <html>
        <body style="font-family: sans-serif; padding: 50px; text-align: center;">
          <h1>${title}</h1>
          <p>${message}</p>
          <p><a href="/auth/login">Back to login</a></p>
        </body>
      </html>
    `);
}

/**
 * Finds the user's membership, creating it when allowed.
 *
 * - Existing member: returned as is.
 * - Brand-new workspace (no members yet): the user becomes its first admin.
 * - Existing workspace, Slack /login: Slack already verified the user belongs to
 *   that Slack team, so they join as a regular member.
 * - Existing workspace, email magic link: refused. Anyone can type a workspace
 *   name, so joining an existing workspace requires an invite (/invite/:id).
 *
 * @returns {Promise<{member: Object|null, created: boolean}>}
 */
async function resolveMembership(userData) {
  const membersCollection = getWorkspaceMembersCollection();

  const member = await membersCollection.findOne({
    user_id: userData.user_id,
    workspace_id: userData.workspace_id,
    email: userData.email,
    removed_at: null
  });
  if (member) return { member, created: false };

  const workspaceHasMembers = await membersCollection.countDocuments({
    workspace_id: userData.workspace_id,
    removed_at: null
  }) > 0;

  if (workspaceHasMembers && userData.origin !== 'slack') {
    return { member: null, created: false };
  }

  const role = workspaceHasMembers ? 'member' : 'admin';
  const newMember = {
    membership_id: `mem_${crypto.randomBytes(12).toString('hex')}`,
    workspace_id: userData.workspace_id,
    workspace_name: userData.workspace_name,
    user_id: userData.user_id,
    user_name: userData.user_name,
    email: userData.email,
    role,
    joined_via: userData.origin === 'slack' ? 'slack' : 'email',
    joined_at: new Date().toISOString(),
    removed_at: null,
    onboarding_completed: false
  };
  await membersCollection.insertOne(newMember);

  if (role === 'admin') {
    await getWorkspaceAdminsCollection().insertOne({
      workspace_id: userData.workspace_id,
      user_id: userData.user_id,
      user_name: userData.user_name,
      email: userData.email,
      role: 'admin',
      created_at: new Date().toISOString(),
      deactivated_at: null
    });
    // New workspace: give it its default space right away
    await ensureDefaultSpace(userData.workspace_id, userData.user_id, userData.user_name);
  }

  console.log(`✅ Created ${role} membership for ${userData.email || userData.user_id} in ${userData.workspace_id}`);
  return { member: newMember, created: true };
}

function redirectPage(res, path, message) {
  return res.send(`
          <!DOCTYPE html>
          <html>
            <head><meta charset="UTF-8"><title>Redirecting...</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5;">
              <p>${message}</p>
              <script>setTimeout(() => window.location.href = '${path}', 100);</script>
            </body>
          </html>
        `);
}

/**
 * Handles dashboard login with one-time token
 * GET /auth/token?token=xxx
 */
async function handleTokenLogin(req, res) {
  try {
    const userData = await consumeLoginToken(req.query.token);

    if (!userData || userData.origin === 'password_reset') {
      return tokenErrorPage(res, 401, 'Invalid or Expired Link',
        'This login link is invalid, was already used, or has expired (links expire after 5 minutes).');
    }

    const { member, created } = await resolveMembership(userData);

    if (!member) {
      console.log(`🚫 Refused magic-link join of existing workspace ${userData.workspace_id} by ${userData.email}`);
      return tokenErrorPage(res, 403, 'You are not a member of this workspace',
        'A workspace with this name already exists. Ask one of its admins to send you an invite link.');
    }

    // Create session only after membership is confirmed
    req.session.user = {
      user_id: userData.user_id,
      user_name: userData.user_name,
      workspace_id: userData.workspace_id,
      workspace_name: userData.workspace_name,
      email: userData.email || null,
      authenticated_at: new Date().toISOString()
    };

    req.session.save(async (err) => {
      if (err) {
        console.error('❌ Failed to save session:', err);
        return res.status(500).send('<html><body>Failed to create session</body></html>');
      }

      console.log(`✅ User logged in via token: ${userData.user_name} from workspace ${userData.workspace_name}`);

      // Wait for session to propagate to MongoDB before redirecting
      await new Promise(resolve => setTimeout(resolve, 150));

      // Client-side redirect so the browser processes the Set-Cookie header first
      if (created || !member.onboarding_completed) {
        return redirectPage(res, '/auth/onboarding', 'Setting up your account...');
      }
      return redirectPage(res, '/dashboard', 'Loading dashboard...');
    });
  } catch (error) {
    console.error('❌ Token login failed:', error);
    return tokenErrorPage(res, 500, 'Something went wrong', 'Please request a new login link.');
  }
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

              <div class="form-group" id="password-group" style="display: none;">
                <label for="password">Password</label>
                <input
                  type="password"
                  id="password"
                  placeholder="Enter your password"
                  autocomplete="current-password"
                />
              </div>

              <button type="submit" class="btn-primary" id="submit-btn">
                Continue
              </button>

              <div style="text-align: center; margin-top: 12px;">
                <button type="button" id="toggle-mode-btn" style="background: none; border: none; color: #667eea; cursor: pointer; font-size: 14px; text-decoration: underline; display: none;">
                  Use magic link instead
                </button>
              </div>
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
          const passwordGroup = document.getElementById('password-group');
          const passwordInput = document.getElementById('password');
          const emailInput = document.getElementById('email');
          const workspaceInput = document.getElementById('workspace');
          const toggleModeBtn = document.getElementById('toggle-mode-btn');

          let usePasswordMode = false;
          let hasPassword = false;
          let checkTimeout = null;

          // Auto-detect password status when email/workspace change
          async function checkPasswordStatus() {
            const email = emailInput.value.trim();
            const workspace = workspaceInput.value.trim();

            if (!email || !workspace || workspace.length < 2) {
              passwordGroup.style.display = 'none';
              toggleModeBtn.style.display = 'none';
              submitBtn.textContent = 'Continue';
              return;
            }

            try {
              const response = await fetch('/auth/check-password-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, workspace })
              });

              const data = await response.json();
              hasPassword = data.has_password;

              if (hasPassword) {
                // User has password - show password mode
                usePasswordMode = true;
                passwordGroup.style.display = 'block';
                passwordInput.required = true;
                submitBtn.textContent = 'Login';
                toggleModeBtn.style.display = 'block';
                toggleModeBtn.textContent = 'Use magic link instead';
              } else {
                // No password - use magic link mode
                usePasswordMode = false;
                passwordGroup.style.display = 'none';
                passwordInput.required = false;
                submitBtn.textContent = 'Send Magic Link';
                toggleModeBtn.style.display = 'none';
              }
            } catch (error) {
              console.error('Password check error:', error);
            }
          }

          // Debounced password status check
          emailInput.addEventListener('input', () => {
            clearTimeout(checkTimeout);
            checkTimeout = setTimeout(checkPasswordStatus, 500);
          });

          workspaceInput.addEventListener('input', () => {
            clearTimeout(checkTimeout);
            checkTimeout = setTimeout(checkPasswordStatus, 500);
          });

          // Toggle between password and magic link modes
          toggleModeBtn.addEventListener('click', () => {
            usePasswordMode = !usePasswordMode;

            if (usePasswordMode) {
              passwordGroup.style.display = 'block';
              passwordInput.required = true;
              submitBtn.textContent = 'Login';
              toggleModeBtn.textContent = 'Use magic link instead';
            } else {
              passwordGroup.style.display = 'none';
              passwordInput.required = false;
              submitBtn.textContent = 'Send Magic Link';
              toggleModeBtn.textContent = 'Use password instead';
            }
          });

          // Form submission
          form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = emailInput.value.trim();
            const workspace = workspaceInput.value.trim().toLowerCase();
            const password = passwordInput.value;

            // Clear previous messages
            messageEl.style.display = 'none';
            messageEl.className = 'message';

            // Disable button
            submitBtn.disabled = true;
            const originalText = submitBtn.textContent;
            submitBtn.textContent = usePasswordMode ? 'Logging in...' : 'Sending...';

            try {
              if (usePasswordMode && password) {
                // Password login
                const response = await fetch('/auth/login-with-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email, workspace, password })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                  // Redirect to dashboard
                  messageEl.textContent = data.message || 'Login successful!';
                  messageEl.classList.add('success');
                  messageEl.style.display = 'block';
                  setTimeout(() => {
                    window.location.href = data.redirect_url;
                  }, 500);
                } else {
                  messageEl.textContent = data.error || 'Login failed';
                  messageEl.classList.add('error');
                  messageEl.style.display = 'block';
                }
              } else {
                // Magic link
                const response = await fetch('/auth/send-magic-link', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email, workspace_name: workspace })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                  messageEl.textContent = data.message;
                  messageEl.classList.add('success');
                  messageEl.style.display = 'block';
                  form.reset();
                  passwordGroup.style.display = 'none';
                  toggleModeBtn.style.display = 'none';
                } else {
                  messageEl.textContent = data.error || 'Failed to send magic link';
                  messageEl.classList.add('error');
                  messageEl.style.display = 'block';
                }
              }
            } catch (error) {
              messageEl.textContent = 'Network error. Please try again.';
              messageEl.classList.add('error');
              messageEl.style.display = 'block';
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = originalText;
            }
          });
        </script>
      </body>
    </html>
  `);
}

/**
 * Shows onboarding page for new users
 * GET /auth/onboarding
 */
async function handleOnboardingPage(req, res) {
  // Must be authenticated to access onboarding
  if (!req.session?.user) {
    return res.redirect('/auth/login');
  }

  try {
    // Check if user already completed onboarding
    const membersCollection = getWorkspaceMembersCollection();
    const member = await membersCollection.findOne({
      user_id: req.session.user.user_id,
      workspace_id: req.session.user.workspace_id,
      removed_at: null
    });

    if (member && member.onboarding_completed) {
      // Already completed onboarding, redirect to dashboard
      return res.redirect('/dashboard');
    }
  } catch (error) {
    console.error('Failed to check onboarding status:', error);
    // Continue to show onboarding on error
  }

  res.sendFile(require('path').join(__dirname, '../views', 'onboarding.html'));
}

/**
 * Validates a token and returns user data without using it up (for password reset)
 */
function validateToken(token) {
  return peekLoginToken(token);
}

/**
 * Consumes a token (deletes it after use)
 */
function consumeToken(token) {
  return consumeLoginToken(token);
}

module.exports = {
  generateLoginToken,  // Now exported for email-auth to use
  handleTokenLogin,
  handleLoginPage,
  handleOnboardingPage,
  validateToken,
  consumeToken
};
