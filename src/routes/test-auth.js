/**
 * Test Authentication Route
 *
 * DEVELOPMENT ONLY - DO NOT USE IN PRODUCTION
 *
 * Provides a simple way to authenticate as test users
 * without requiring Slack OAuth
 */

const express = require('express');
const router = express.Router();

/**
 * GET /test-login
 * Shows a simple login form with test users
 */
router.get('/test-login', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Test Login - Corteza</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
      color: #1d1c1d;
    }
    .subtitle {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 30px;
    }
    .warning {
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 24px;
      font-size: 13px;
      color: #92400e;
    }
    .user-grid {
      display: grid;
      gap: 12px;
      margin-bottom: 24px;
    }
    .user-card {
      border: 2px solid #e1e4e8;
      border-radius: 12px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.2s;
      background: white;
    }
    .user-card:hover {
      border-color: #667eea;
      background: #f8f9ff;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
    }
    .user-card input[type="radio"] {
      display: none;
    }
    .user-card input[type="radio"]:checked + .user-content {
      border-left: 4px solid #667eea;
      padding-left: 16px;
    }
    .user-content {
      transition: all 0.2s;
      padding-left: 0;
      border-left: 4px solid transparent;
    }
    .user-name {
      font-size: 16px;
      font-weight: 600;
      color: #1d1c1d;
      margin-bottom: 4px;
    }
    .user-role {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 6px;
    }
    .user-access {
      font-size: 12px;
      color: #667eea;
      font-weight: 500;
    }
    .btn-login {
      width: 100%;
      padding: 14px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-login:hover {
      background: #5568d3;
    }
    .btn-login:active {
      transform: scale(0.98);
    }
    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 12px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Test Login</h1>
    <p class="subtitle">Select a test user to access the dashboard</p>

    <div class="warning">
      ⚠️ <strong>Development Only:</strong> This login method is for testing purposes only and should never be used in production.
    </div>

    <form method="POST" action="/test-login">
      <div class="user-grid">
        <label class="user-card">
          <input type="radio" name="user_id" value="U001" checked>
          <div class="user-content">
            <div class="user-name">👩‍💼 Alice Admin</div>
            <div class="user-role">Workspace Administrator</div>
            <div class="user-access">✓ Full access to all spaces</div>
          </div>
        </label>

        <label class="user-card">
          <input type="radio" name="user_id" value="U002">
          <div class="user-content">
            <div class="user-name">👨‍💻 Bob Engineer</div>
            <div class="user-role">Engineering Team</div>
            <div class="user-access">✓ Owner of Engineering space</div>
          </div>
        </label>

        <label class="user-card">
          <input type="radio" name="user_id" value="U003">
          <div class="user-content">
            <div class="user-name">👩‍💼 Carol Marketing</div>
            <div class="user-role">Marketing Team</div>
            <div class="user-access">✓ Owner of Marketing space</div>
          </div>
        </label>

        <label class="user-card">
          <input type="radio" name="user_id" value="U004">
          <div class="user-content">
            <div class="user-name">👔 Dave CEO</div>
            <div class="user-role">Chief Executive Officer</div>
            <div class="user-access">✓ Owner of CEO Private space</div>
          </div>
        </label>
      </div>

      <button type="submit" class="btn-login">
        🚀 Login to Dashboard
      </button>
    </form>

    <div class="footer">
      Test Workspace: TEST_WORKSPACE<br>
      This will create a session and redirect to the dashboard
    </div>
  </div>
</body>
</html>
  `;

  res.send(html);
});

/**
 * POST /test-login
 * Creates a test session for the selected user
 */
router.post('/test-login', express.urlencoded({ extended: true }), (req, res) => {
  const userId = req.body.user_id;

  // Test user data
  const testUsers = {
    'U001': { user_id: 'U001', user_name: 'Alice Admin', email: 'alice@test.com' },
    'U002': { user_id: 'U002', user_name: 'Bob Engineer', email: 'bob@test.com' },
    'U003': { user_id: 'U003', user_name: 'Carol Marketing', email: 'carol@test.com' },
    'U004': { user_id: 'U004', user_name: 'Dave CEO', email: 'dave@test.com' }
  };

  const user = testUsers[userId];

  if (!user) {
    return res.status(400).send('Invalid user selection');
  }

  // Create session (matching the structure used by dashboard-auth.js)
  req.session.user = {
    user_id: user.user_id,
    user_name: user.user_name,
    email: user.email,
    workspace_id: 'TEST_WORKSPACE',
    workspace_name: 'Test Company',
    authenticated_at: new Date().toISOString()
  };

  // Save session and redirect
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).send('Failed to create session');
    }

    console.log(`✅ Test login: ${user.user_name} (${user.user_id}) in TEST_WORKSPACE`);
    res.redirect('/dashboard');
  });
});

/**
 * GET /test-logout
 * Destroys the test session
 */
router.get('/test-logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
    res.redirect('/test-login');
  });
});

module.exports = router;
