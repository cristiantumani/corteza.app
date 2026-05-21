const fs = require('fs');
const path = require('path');

// Load dashboard HTML once at startup
const dashboardHTML = fs.readFileSync(
  path.join(__dirname, '../views/dashboard.html'),
  'utf8'
);

// Load AI analytics HTML once at startup
const aiAnalyticsHTML = fs.readFileSync(
  path.join(__dirname, '../views/ai-analytics.html'),
  'utf8'
);

// Load settings HTML once at startup
const settingsHTML = fs.readFileSync(
  path.join(__dirname, '../views/settings.html'),
  'utf8'
);

/**
 * GET /dashboard - Serves the dashboard HTML
 */
function serveDashboard(req, res) {
  // Get workspace_id from session
  const workspaceId = req.session?.user?.workspace_id || '';

  // Replace <WORKSPACE_ID> placeholder with actual workspace_id
  const html = dashboardHTML.replace(/<WORKSPACE_ID>/g, workspaceId);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * GET /ai-analytics - Serves the AI analytics dashboard HTML
 */
function serveAIAnalytics(req, res) {
  // Get workspace_id from session
  const workspaceId = req.session?.user?.workspace_id || '';

  // Replace <WORKSPACE_ID> placeholder with actual workspace_id
  const html = aiAnalyticsHTML.replace(/<WORKSPACE_ID>/g, workspaceId);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * GET /settings - Serves the settings page HTML
 */
function serveSettings(req, res) {
  // Get workspace_id from session
  const workspaceId = req.session?.user?.workspace_id || '';

  // Replace <WORKSPACE_ID> placeholder with actual workspace_id
  const html = settingsHTML.replace(/<WORKSPACE_ID>/g, workspaceId);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * GET / - Redirect to dashboard
 */
function redirectToDashboard(req, res) {
  res.writeHead(302, { Location: '/dashboard' });
  res.end();
}

module.exports = {
  serveDashboard,
  serveAIAnalytics,
  serveSettings,
  redirectToDashboard
};
