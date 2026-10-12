const Sentry = require('@sentry/node');

/**
 * Error monitoring with Sentry (docs/specs/2026-10-ops-monitoring.md). On only when SENTRY_DSN is
 * set. Nothing from meetings and no personal data leaves: no default integrations (they add HTTP,
 * console and database breadcrumbs, and AI-call tracing with prompts), no tracing, and beforeSend
 * keeps only the error, its stack and internal ids (workspace_id, user_id, job) as tags.
 */

let enabled = false;

/** Tags that may go to Sentry: internal ids and names of our own jobs, never content */
const ALLOWED_TAGS = ['workspace_id', 'user_id', 'job', 'feature', 'route'];

/**
 * An error message without quoted text, and at most 300 characters
 * @param {string} message
 * @returns {string}
 */
function redactMessage(message) {
  return message.replace(/"[^"]*"|'[^']*'|“[^”]*”/g, '"…"').slice(0, 300);
}

/**
 * Strips an event down to what we allow (exported for tests)
 * @param {any} event - a Sentry event
 * @returns {any} the same event, scrubbed
 */
function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;
  if (event.request) {
    // Method and path only (no query string, body, cookies or headers)
    const url = typeof event.request.url === 'string' ? event.request.url.split('?')[0] : undefined;
    event.request = { method: event.request.method, url };
  }
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  if (event.contexts) event.contexts = { runtime: event.contexts.runtime, os: event.contexts.os };
  // Exception messages: quoted text can be content (JSON.parse quotes the AI reply it choked on)
  for (const exception of (event.exception && event.exception.values) || []) {
    if (typeof exception.value === 'string') exception.value = redactMessage(exception.value);
  }
  if (event.tags) {
    event.tags = Object.fromEntries(Object.entries(event.tags).filter(([key]) => ALLOWED_TAGS.includes(key)));
  }
  return event;
}

/**
 * Starts Sentry when SENTRY_DSN is set
 * @param {{ dsn?: string, environment?: string }} [options]
 * @returns {boolean} whether it's on
 */
function initSentry({ dsn = process.env.SENTRY_DSN, environment = process.env.SENTRY_ENVIRONMENT || 'production' } = {}) {
  if (!dsn || enabled) return enabled;
  Sentry.init({
    dsn,
    environment,
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration({ mode: 'warn' }),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration()
    ],
    maxBreadcrumbs: 0,
    beforeSend: scrubEvent
  });
  enabled = true;
  console.log('🛰️  Error monitoring on (Sentry)');
  return enabled;
}

/**
 * Reports an error from a job or a catch block. Never throws.
 * @param {unknown} error
 * @param {{ job?: string, feature?: string, route?: string, workspace_id?: string|null, user_id?: string|null }} [tags]
 */
function reportError(error, tags = {}) {
  if (!enabled) return;
  try {
    Sentry.withScope(scope => {
      for (const [key, value] of Object.entries(tags)) {
        if (ALLOWED_TAGS.includes(key) && typeof value === 'string' && value) scope.setTag(key, value);
      }
      Sentry.captureException(error);
    });
  } catch (captureError) {
    console.warn('⚠️  Sentry capture failed:', /** @type {Error} */ (captureError).message);
  }
}

/**
 * Express error handler: reports uncaught route errors, then passes them on. Register after all routes.
 * @param {import('express').Express} app
 */
function setupErrorHandler(app) {
  app.use((error, req, res, next) => {
    const user = req.session && req.session.user;
    reportError(error, {
      route: req.route && typeof req.route.path === 'string' ? req.route.path : undefined,
      workspace_id: user ? user.workspace_id : undefined,
      user_id: user ? user.user_id : undefined
    });
    next(error);
  });
}

/** Sends queued events before the process exits */
async function flushSentry(timeoutMs = 2000) {
  if (enabled) await Sentry.flush(timeoutMs).catch(() => {});
}

module.exports = { initSentry, reportError, setupErrorHandler, flushSentry, scrubEvent, redactMessage, isEnabled: () => enabled };
