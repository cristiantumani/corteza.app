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

/**
 * GET /dashboard - Serves the dashboard HTML
 */
function serveDashboard(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(dashboardHTML);
}

/**
 * GET /ai-analytics - Serves the AI analytics dashboard HTML
 */
function serveAIAnalytics(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(aiAnalyticsHTML);
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
  redirectToDashboard
};
