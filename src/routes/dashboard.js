const { renderView } = require('../http/page-partials');
const { localizedPage } = require('../core/i18n/i18n');
const config = require('../config/environment');
const { allowDrivePicker } = require('../middleware/auth');

// Pages rendered once per language at startup, with the shared sidebar and detail modal filled in
const dashboardHTML = localizedPage(renderView('dashboard-new.html', { active: 'home' }));
const settingsNewHTML = localizedPage(renderView('settings-new.html', { active: 'settings' }));
const aiSearchHTML = localizedPage(renderView('ai-search.html', { active: 'search' }));

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
    const { hasSeenOnboarding } = require('../core/onboarding/onboarding-service');
    const [spaces, onboardingSeen] = await Promise.all([
      listSpacesForUser({ workspaceId, userId, userName, isAdminUser }),
      hasSeenOnboarding(workspaceId, userId)
    ]);
    return { user: { ...sessionUser, is_admin: isAdminUser, onboarding_seen: onboardingSeen }, spaces };
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
  let html = template(req).replace(/<WORKSPACE_ID>/g, workspaceId);

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
 * GET /settings - Serves the settings page HTML
 */
function serveSettings(req, res) {
  // Get user info from session
  const workspaceId = req.session?.user?.workspace_id || '';
  const userId = req.session?.user?.user_id || '';

  // Replace placeholders with actual values (using new Material Design 3 version)
  let html = settingsNewHTML(req).replace(/<WORKSPACE_ID>/g, workspaceId);
  html = html.replace(/<USER_ID>/g, userId);

  // Add from Google Drive (Context for the AI) needs Google's Picker on this page only
  if (config.google.picker.isConfigured) allowDrivePicker(res);

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
 * GET / - Redirect to dashboard
 */
function redirectToDashboard(req, res) {
  res.writeHead(302, { Location: '/dashboard' });
  res.end();
}

module.exports = {
  scriptJson,
  serveDashboard,
  serveAISearch,
  serveSettings,
  redirectToDashboard
};
