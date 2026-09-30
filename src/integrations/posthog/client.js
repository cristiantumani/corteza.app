const { PostHog } = require('posthog-node');

/**
 * Product analytics (PostHog). Server-side only.
 *
 * Privacy rule: events carry counts, types and ids, never meeting content (transcripts,
 * outcome text, search questions or answers, context). That keeps us within Google's
 * Limited Use policy for Meet data. AI calls are tracked as $ai_generation with model,
 * tokens and latency only, so PostHog can show cost per user without the prompts.
 *
 * Off (every helper is a no-op) when POSTHOG_PROJECT_TOKEN or POSTHOG_HOST is missing,
 * in tests, or with POSTHOG_DISABLED=1 (the extraction eval sets it).
 */

const apiKey = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
const disabled = process.env.NODE_ENV === 'test' || process.env.POSTHOG_DISABLED === '1';

let posthog = null;
if (apiKey && host && !disabled) {
  posthog = new PostHog(apiKey, { host, enableExceptionAutocapture: true });
  console.log('📈 PostHog analytics enabled');
}

/**
 * Request properties for events: the path without its query string. Query strings can
 * carry search text or OAuth codes (/auth/google/callback?code=…), so they're never sent.
 * @param {import('express').Request} req
 * @returns {Object}
 */
function requestProperties(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].split('#')[0];
  return { $current_url: path, $request_path: path, $request_method: req.method };
}

/** Who a request belongs to: only the session's user (client-sent headers are ignored) */
function requestIdentity(req) {
  const userId = req.session?.user?.user_id;
  return userId ? { distinctId: userId, sessionId: req.sessionID } : {};
}

/**
 * Per-request context, so capture() calls inside a request are attributed to the
 * signed-in user without passing a distinctId. Register after the session middleware.
 * @param {import('express').Application} app
 */
function setupRequestContext(app) {
  if (!posthog) return;
  app.use((req, res, next) => {
    posthog.withContext({ ...requestIdentity(req), properties: requestProperties(req) }, () => next());
  });
}

/**
 * Captures uncaught route errors ($exception), then passes them on. Register after all routes.
 * @param {import('express').Application} app
 */
function setupErrorHandler(app) {
  if (!posthog) return;
  app.use((error, req, res, next) => {
    try {
      const { distinctId, sessionId } = requestIdentity(req);
      posthog.captureException(error, distinctId, { ...requestProperties(req), ...(sessionId ? { $session_id: sessionId } : {}) });
    } catch (captureError) {
      console.warn('⚠️  PostHog exception capture failed:', captureError.message);
    }
    next(error);
  });
}

/**
 * Records an event. Inside a request the signed-in user is used; outside one
 * (poller, background jobs) pass distinctId. Never throws.
 * @param {string} event
 * @param {Object} [properties] - counts, types, ids; never meeting content
 * @param {string|null} [distinctId]
 */
function track(event, properties = {}, distinctId = null) {
  if (!posthog) return;
  try {
    posthog.capture({ event, properties, ...(distinctId ? { distinctId } : {}) });
  } catch (error) {
    console.warn('⚠️  PostHog capture failed:', error.message);
  }
}

/**
 * Sets who a user is (email, name, workspace), so events show a person, not an id
 * @param {string} distinctId - the membership's user_id
 * @param {Object} properties
 */
function identify(distinctId, properties = {}) {
  if (!posthog || !distinctId) return;
  try {
    posthog.identify({ distinctId, properties: { $set: properties } });
  } catch (error) {
    console.warn('⚠️  PostHog identify failed:', error.message);
  }
}

/**
 * Records a Claude call as $ai_generation: model, tokens, latency. No prompt, no output.
 * @param {Object} params
 * @param {string} params.feature - e.g. 'extraction', 'search_answer'
 * @param {Object} params.response - Anthropic Message (only model, usage and stop_reason are read)
 * @param {number} params.latencyMs
 * @param {string|null} [params.distinctId]
 * @param {Object} [params.properties] - extra counts (e.g. item_count)
 */
function trackAiGeneration({ feature, response, latencyMs, distinctId = null, properties = {} }) {
  if (!posthog || !response) return;
  track('$ai_generation', aiGenerationProperties(feature, response, latencyMs, properties), distinctId);
}

/**
 * Properties of an $ai_generation event: model, tokens, latency, stop reason. Only
 * metadata of the response is read, never its content.
 * @param {string} feature
 * @param {Object} response - Anthropic Message
 * @param {number} latencyMs
 * @param {Object} [extra]
 * @returns {Object}
 */
function aiGenerationProperties(feature, response, latencyMs, extra = {}) {
  const usage = response.usage || {};
  return {
    $ai_provider: 'anthropic',
    $ai_model: response.model,
    $ai_span_name: feature,
    $ai_input_tokens: usage.input_tokens || 0,
    $ai_output_tokens: usage.output_tokens || 0,
    $ai_cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    $ai_cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
    $ai_latency: latencyMs / 1000,
    $ai_http_status: 200,
    $ai_stop_reason: response.stop_reason || null,
    ...extra
  };
}

/**
 * Sends queued events before the process exits (Railway redeploys send SIGTERM)
 * @returns {Promise<void>}
 */
async function shutdownAnalytics() {
  if (posthog) await posthog.shutdown();
}

module.exports = {
  posthog,
  track,
  identify,
  trackAiGeneration,
  aiGenerationProperties,
  requestProperties,
  setupRequestContext,
  setupErrorHandler,
  shutdownAnalytics
};
