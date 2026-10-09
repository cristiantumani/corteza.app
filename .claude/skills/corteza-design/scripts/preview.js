#!/usr/bin/env node
/**
 * Corteza UI preview: serves the real app pages with fake data (fixtures.js) and takes screenshots,
 * desktop and mobile, without MongoDB, Google sign-in or any real account.
 *
 *   node .claude/skills/corteza-design/scripts/preview.js                       # every page, default data
 *   node .claude/skills/corteza-design/scripts/preview.js --pages home,actions  # some pages
 *   node .claude/skills/corteza-design/scripts/preview.js --state empty         # empty | onboarding | member
 *   node .claude/skills/corteza-design/scripts/preview.js --out /tmp/shots      # where to write (default: ./ui-preview, gitignored)
 *   node .claude/skills/corteza-design/scripts/preview.js --lang es             # the app in Spanish (en | es)
 *   node .claude/skills/corteza-design/scripts/preview.js --serve               # only serve, print the URL, keep running
 *
 * Writes <out>/<page>-<desktop|mobile>.png and <out>/report.json (console errors, page errors,
 * API calls with no fixture). Pages and API routes are the app's own HTML and scripts from src/views
 * and public/, so a change to them shows up on the next run.
 */
/* global document, window */ // used inside page.evaluate callbacks, which run in the browser
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const root = path.resolve(__dirname, '../../../..');
const express = require(path.join(root, 'node_modules/express'));
const { renderView } = require(path.join(root, 'src/http/page-partials'));
const { localizeHtml } = require(path.join(root, 'src/core/i18n/i18n'));
const fixtures = require('./fixtures');

const PAGES = {
  home: { path: '/dashboard', view: 'dashboard-new.html', active: 'home', preload: true },
  actions: { path: '/actions', view: 'actions.html', active: 'actions' },
  questions: { path: '/questions', view: 'questions.html', active: 'questions' },
  search: { path: '/ai-search', view: 'ai-search.html', active: 'search', preload: true, prepare: async page => {
    const input = page.locator('input[type="text"], textarea').first();
    if (await input.count()) { await input.fill('¿Qué decidimos sobre el plan anual?'); await input.press('Enter'); }
  } },
  settings: { path: '/settings', view: 'settings-new.html', active: 'settings' },
  login: { path: '/auth/login', view: 'login.html' }
};
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

/** Fixtures for a named state (default | empty | onboarding | member) */
function routesFor(state) {
  const routes = { ...fixtures.routes };
  const user = { ...fixtures.user };
  if (state === 'onboarding') {
    user.onboarding_seen = false;
    routes['GET /api/onboarding'] = { success: true, seen: false, is_admin: true };
  }
  if (state === 'member') {
    user.is_admin = false;
    routes['GET /api/ai-context'] = { ...routes['GET /api/ai-context'], can_edit_company: false };
  }
  if (state === 'empty') {
    routes['GET /api/decisions'] = { decisions: [], pagination: { total: 0, page: 1, pages: 0, limit: 50 } };
    routes['GET /api/stats'] = { total: 0, byType: {}, byCategory: {}, lastWeek: 0 };
    routes['GET /api/action-items'] = { success: true, items: [], user_id: user.user_id };
    routes['GET /api/action-items/from-colleagues'] = { success: true, count: 0, from: [] };
    routes['GET /api/questions-risks'] = { success: true, items: [], counts: {} };
    routes['GET /api/integrations/google'] = { success: true, configured: true, connected: false };
    routes['GET /api/home/today'] = { success: true, status: 'no_calendar', meetings: [] };
    routes['GET /api/home'] = {
      success: true, since: new Date().toISOString(),
      summary: { new_outcomes: 0, meetings: 0, overdue: 0, due_today: 0, open_action_items: 0, to_review: 0, open_questions: 0, open_risks: 0, new_questions: 0, new_risks: 0 },
      headline: { voice: 'sarcastic', situation: 'all_clear', title: process.argv.includes('es') ? 'Cero atrasados. ¿Quién eres?' : 'Zero overdue. Who are you?', follow: null, item_id: null },
      owe: [], open: [], decided: [], review: []
    };
  }
  routes['GET /auth/me'] = { authenticated: true, user };
  return { routes, user };
}

function createApp(state, unmocked, lang) {
  const { routes, user } = routesFor(state);
  const app = express();
  const bootstrap = `<script>window.__CORTEZA_BOOTSTRAP__ = ${JSON.stringify({ user, spaces: fixtures.spaces }).replace(/</g, '\\u003c')};</script>`;

  for (const page of Object.values(PAGES)) {
    const html = localizeHtml(renderView(page.view, { active: page.active }), lang)
      .replace(/<WORKSPACE_ID>/g, user.workspace_id)
      .replace(/<USER_ID>/g, user.user_id)
      .replace('<!-- BOOTSTRAP -->', () => (page.preload ? bootstrap : ''));
    app.get(page.path, (req, res) => res.type('html').send(html));
  }
  app.use(express.static(path.join(root, 'public')));
  app.use(express.json());
  app.use((req, res) => {
    const key = `${req.method} ${req.path}`;
    const fixture = routes[key];
    if (fixture === undefined) {
      unmocked.add(key);
      return res.json({ success: true });
    }
    res.json(typeof fixture === 'function' ? fixture(req) : fixture);
  });
  return app;
}

const fontCache = new Map();
/**
 * Behind an HTTPS proxy (cloud sessions) Chromium can't reach Google Fonts directly while also
 * loading the local server, so fonts are fetched with curl, which honors HTTPS_PROXY. Without the
 * fonts, icons would show as words ("home", "search") and the screenshots would mislead.
 */
async function fetchThroughProxy(route) {
  const url = route.request().url();
  try {
    if (!fontCache.has(url)) {
      const tmp = path.join(require('os').tmpdir(), `corteza-font-${fontCache.size}`);
      const type = execFileSync('curl', ['-sS', '--fail', '-A', route.request().headers()['user-agent'] || 'Mozilla/5.0', '-o', tmp, '-w', '%{content_type}', url]).toString();
      fontCache.set(url, { body: fs.readFileSync(tmp), contentType: type || 'application/octet-stream' });
    }
    await route.fulfill({ ...fontCache.get(url), headers: { 'Access-Control-Allow-Origin': '*' } });
  } catch (error) {
    await route.abort();
  }
}

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* not a project dependency */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}

async function main() {
  const state = arg('state', 'default');
  const out = path.resolve(arg('out', path.join(root, 'ui-preview')));
  const names = (arg('pages', Object.keys(PAGES).join(','))).split(',').map(s => s.trim()).filter(Boolean);
  const unknown = names.filter(n => !PAGES[n]);
  if (unknown.length) throw new Error(`Unknown page(s): ${unknown.join(', ')}. Pages: ${Object.keys(PAGES).join(', ')}`);

  const unmocked = new Set();
  const lang = arg('lang', 'en');
  const server = createApp(state, unmocked, lang).listen(Number(arg('port', 0)));
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  if (process.argv.includes('--serve')) {
    console.log(`Serving with "${state}" data at ${base}`);
    for (const [name, page] of Object.entries(PAGES)) console.log(`  ${name.padEnd(10)} ${base}${page.path}`);
    return;
  }

  fs.mkdirSync(out, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const report = { state, lang, base, pages: {} };

  for (const name of names) {
    const page = PAGES[name];
    report.pages[name] = {};
    for (const [viewport, size] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
      if (process.env.HTTPS_PROXY) await context.route(/fonts\.(googleapis|gstatic)\.com/, fetchThroughProxy);
      const tab = await context.newPage();
      const errors = [];
      tab.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
      tab.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
      tab.on('dialog', dialog => { errors.push(`dialog: ${dialog.message()}`); dialog.dismiss(); });
      await tab.goto(base + page.path, { waitUntil: 'networkidle' }).catch(error => errors.push(`goto: ${error.message}`));
      if (page.prepare) await page.prepare(tab).catch(error => errors.push(`prepare: ${error.message}`));
      await tab.waitForLoadState('networkidle').catch(() => {});
      await tab.waitForTimeout(400);
      // Pages scroll inside <main> (body is overflow-hidden): let it grow so fullPage captures everything
      await tab.evaluate(() => {
        document.documentElement.style.overflow = 'visible';
        document.body.style.overflow = 'visible';
        for (const el of document.querySelectorAll('main, [class*="overflow-y-auto"]')) {
          if (el.scrollHeight > el.clientHeight + 1) Object.assign(el.style, { height: 'auto', maxHeight: 'none', overflow: 'visible' });
        }
      });
      const file = path.join(out, `${name}-${viewport}.png`);
      await tab.screenshot({ path: file, fullPage: true });
      const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      report.pages[name][viewport] = { file, errors, horizontal_overflow_px: Math.max(0, overflow) };
      await context.close();
    }
  }

  await browser.close();
  server.close();
  report.unmocked_api_calls = [...unmocked].sort();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Screenshots and report.json in ${out}`);
  for (const [name, views] of Object.entries(report.pages)) {
    const notes = Object.entries(views).map(([v, r]) => `${v}: ${r.errors.length} error(s)${r.horizontal_overflow_px ? `, ${r.horizontal_overflow_px}px horizontal overflow` : ''}`);
    console.log(`  ${name.padEnd(10)} ${notes.join(' · ')}`);
  }
  if (report.unmocked_api_calls.length) console.log(`  API calls with no fixture: ${report.unmocked_api_calls.join(', ')}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
