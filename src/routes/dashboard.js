const fs = require('fs');
const path = require('path');

// Load new dashboard HTML (now the main dashboard)
const dashboardHTML = fs.readFileSync(
  path.join(__dirname, '../views/dashboard-new.html'),
  'utf8'
);

// Load old dashboard HTML (kept as backup)
const dashboardOldHTML = fs.readFileSync(
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

// Load AI search HTML once at startup
const aiSearchHTML = fs.readFileSync(
  path.join(__dirname, '../views/ai-search.html'),
  'utf8'
);

// Load space selector HTML once at startup
const spaceSelectorHTML = fs.readFileSync(
  path.join(__dirname, '../views/space-selector.html'),
  'utf8'
);

/**
 * GET /dashboard - Serves the new Tailwind/Material Design dashboard
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
  // Get user info from session
  const workspaceId = req.session?.user?.workspace_id || '';
  const userId = req.session?.user?.user_id || '';

  // Replace placeholders with actual values
  let html = settingsHTML.replace(/<WORKSPACE_ID>/g, workspaceId);
  html = html.replace(/<USER_ID>/g, userId);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * GET /dashboard-old - Serves the old dashboard HTML (backup/legacy)
 */
function serveDashboardOld(req, res) {
  // Get workspace_id from session
  const workspaceId = req.session?.user?.workspace_id || '';

  // Replace <WORKSPACE_ID> placeholder with actual workspace_id
  const html = dashboardOldHTML.replace(/<WORKSPACE_ID>/g, workspaceId);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * GET /ai-search - Serves the AI search interface HTML
 */
function serveAISearch(req, res) {
  // Get workspace_id from session
  const workspaceId = req.session?.user?.workspace_id || '';

  // Replace <WORKSPACE_ID> placeholder with actual workspace_id
  const html = aiSearchHTML.replace(/<WORKSPACE_ID>/g, workspaceId);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * GET /select-space - Serves the space selector page
 */
function serveSpaceSelector(req, res) {
  // Get workspace_id from session
  const workspaceId = req.session?.user?.workspace_id || '';

  // Replace <WORKSPACE_ID> placeholder with actual workspace_id
  const html = spaceSelectorHTML.replace(/<WORKSPACE_ID>/g, workspaceId);

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
  serveDashboardOld,
  serveAIAnalytics,
  serveAISearch,
  serveSettings,
  serveSpaceSelector,
  redirectToDashboard
};
