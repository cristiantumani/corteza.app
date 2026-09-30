const fs = require('fs');
const path = require('path');

/**
 * Shared page fragments injected into the app's HTML pages when they're loaded:
 *   <!-- SIDEBAR -->       the app sidebar (partials/sidebar.html), with the current page marked
 *   <!-- DETAIL_MODAL -->  the outcome detail modal (partials/detail-modal.html)
 *   <!-- ONBOARDING -->    the first-run "How Corteza works" steps (partials/onboarding.html, Home)
 */

const views = path.join(__dirname, '../views');
const sidebarHTML = fs.readFileSync(path.join(views, 'partials/sidebar.html'), 'utf8');
const detailModalHTML = fs.readFileSync(path.join(views, 'partials/detail-modal.html'), 'utf8');
const onboardingHTML = fs.readFileSync(path.join(views, 'partials/onboarding.html'), 'utf8');

/**
 * The sidebar with one link marked as the current page
 * @param {'home'|'actions'|'search'|'settings'} active
 * @returns {string}
 */
function sidebar(active) {
  return sidebarHTML.replace(`data-nav="${active}"`, `data-nav="${active}" aria-current="page"`);
}

/**
 * Reads a view once and fills in its partials
 * @param {string} file - file name in src/views
 * @param {Object} [options]
 * @param {string} [options.active] - sidebar link to mark as current
 * @returns {string}
 */
function renderView(file, { active } = {}) {
  let html = fs.readFileSync(path.join(views, file), 'utf8');
  if (active) html = html.replace('<!-- SIDEBAR -->', () => sidebar(active));
  return html
    .replace('<!-- DETAIL_MODAL -->', () => detailModalHTML)
    .replace('<!-- ONBOARDING -->', () => onboardingHTML);
}

module.exports = { renderView, sidebar };
