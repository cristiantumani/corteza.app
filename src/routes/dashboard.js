const fs = require('fs');
const path = require('path');

// Load dashboard HTML once at startup
const dashboardHTML = fs.readFileSync(
  path.join(__dirname, '../views/dashboard.html'),
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
 * GET / - Redirect to dashboard
 */
function redirectToDashboard(req, res) {
  res.writeHead(302, { Location: '/dashboard' });
  res.end();
}

module.exports = {
  serveDashboard,
  redirectToDashboard
};
