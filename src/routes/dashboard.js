const fs = require('fs');
const path = require('path');

// Outcome detail modal shared by Home and Search (views/partials/detail-modal.html)
const detailModalHTML = fs.readFileSync(path.join(__dirname, '../views/partials/detail-modal.html'), 'utf8');

/** Puts shared partials into a page template (once, at startup) */
function withPartials(html) {
  return html.replace('<!-- DETAIL_MODAL -->', () => detailModalHTML);
}

// Load new dashboard HTML (now the main dashboard)
const dashboardHTML = withPartials(fs.readFileSync(
  path.join(__dirname, '../views/dashboard-new.html'),
  'utf8'
));

// Load AI analytics HTML once at startup
const aiAnalyticsHTML = fs.readFileSync(
  path.join(__dirname, '../views/ai-analytics.html'),
  'utf8'
);

// Load new settings HTML (Material Design 3)
const settingsNewHTML = fs.readFileSync(
  path.join(__dirname, '../views/settings-new.html'),
  'utf8'
);

// Load AI search HTML once at startup
const aiSearchHTML = withPartials(fs.readFileSync(
  path.join(__dirname, '../views/ai-search.html'),
  'utf8'
));

// Load space selector HTML once at startup
const spaceSelectorHTML = fs.readFileSync(
  path.join(__dirname, '../views/space-selector.html'),
  'utf8'
);

/**
 * What the dashboard would otherwise fetch first (/auth/me and /api/spaces),
 * computed while serving the page so the browser skips a round trip.
 * @returns {Promise<Object|null>} { user, spaces } or null if it can't be computed
 */
async function dashboardBootstrap(sessionUser) {
  try {
    const { getSlackClient } = require('../config/slack-client');
    const { isAdmin } = require('../services/permissions');
    const { listSpacesForUser } = require('../core/spaces/list-spaces');
    const { workspace_id: workspaceId, user_id: userId, user_name: userName } = sessionUser;
    const client = await getSlackClient(workspaceId).catch(() => null);
    const isAdminUser = await isAdmin(client, workspaceId, userId);
    const spaces = await listSpacesForUser({ workspaceId, userId, userName, isAdminUser });
    return { user: { ...sessionUser, is_admin: isAdminUser }, spaces };
  } catch (error) {
    console.error('⚠️  Dashboard bootstrap failed, the page will fetch it instead:', error.message);
    return null;
  }
}

/** JSON that is safe inside a <script> tag */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Sends a page that runs dashboard.js, with the workspace id and preloaded data filled in
 */
async function sendPreloadedPage(req, res, template) {
  const workspaceId = req.session?.user?.workspace_id || '';
  let html = template.replace(/<WORKSPACE_ID>/g, workspaceId);

  const bootstrap = req.session?.user ? await dashboardBootstrap(req.session.user) : null;
  if (bootstrap) {
    // Function replacement: "$" sequences in the data must not be treated as replace patterns
    html = html.replace('<!-- BOOTSTRAP -->', () => `<script>window.__CORTEZA_BOOTSTRAP__ = ${scriptJson(bootstrap)};</script>`);
  }

  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  res.end(html);
}

/**
 * GET /dashboard - Serves the new Tailwind/Material Design dashboard
 */
function serveDashboard(req, res) {
  return sendPreloadedPage(req, res, dashboardHTML);
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

  // Replace placeholders with actual values (using new Material Design 3 version)
  let html = settingsNewHTML.replace(/<WORKSPACE_ID>/g, workspaceId);
  html = html.replace(/<USER_ID>/g, userId);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

/**
 * GET /ai-search - Serves the AI search interface HTML
 */
function serveAISearch(req, res) {
  return sendPreloadedPage(req, res, aiSearchHTML);
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
  scriptJson,
  serveDashboard,
  serveAIAnalytics,
  serveAISearch,
  serveSettings,
  serveSpaceSelector,
  redirectToDashboard
};
