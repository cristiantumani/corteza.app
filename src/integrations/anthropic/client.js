const { Anthropic } = require('@anthropic-ai/sdk');

/**
 * Every Anthropic client comes from here, so a billing or auth failure on any Claude call raises
 * the ops alert right away (docs/specs/2026-10-ops-monitoring.md), and the next success resolves it.
 * Only the HTTP status and Anthropic's error type are looked at; request and reply bodies never
 * leave this function.
 */

/** @type {{ kind: 'ai_credit'|'ai_auth'|null }} */
const current = { kind: null };

/**
 * What an Anthropic error response means for ops
 * @param {number} status
 * @param {string} body - the error response body (JSON from Anthropic)
 * @returns {{ type: 'ai_credit'|'ai_auth', reason: string }|null}
 */
function classifyAiFailure(status, body) {
  let errorType = '';
  let message = '';
  try {
    const parsed = JSON.parse(body);
    errorType = String((parsed && parsed.error && parsed.error.type) || '');
    message = String((parsed && parsed.error && parsed.error.message) || '');
  } catch (e) { /* not JSON */ }
  if (status === 400 && /credit balance|billing/i.test(message)) return { type: 'ai_credit', reason: 'credit balance too low' };
  if (status === 402) return { type: 'ai_credit', reason: errorType || 'payment required' };
  if (status === 401 || status === 403) return { type: 'ai_auth', reason: errorType || `HTTP ${status}` };
  return null;
}

/**
 * fetch that reports billing/auth failures to the ops alerts (never changes the response)
 * @param {{ fetch?: typeof fetch, raise?: Function, resolve?: Function }} [deps]
 * @returns {typeof fetch}
 */
function watchedFetch(deps = {}) {
  const baseFetch = deps.fetch || globalThis.fetch;
  const alerts = () => require('../../core/ops/alerts');
  const raise = deps.raise || ((type, detail) => alerts().raiseAlert(type, detail));
  const resolve = deps.resolve || (type => alerts().resolveAlert(type));
  return /** @type {typeof fetch} */ (async (input, init) => {
    const response = await baseFetch(input, init);
    try {
      if (response.ok) {
        if (current.kind) {
          const kind = current.kind;
          current.kind = null;
          Promise.resolve(resolve(kind)).catch(() => {});
        }
      } else if ([400, 401, 402, 403].includes(response.status)) {
        const failure = classifyAiFailure(response.status, await response.clone().text());
        if (failure) {
          current.kind = failure.type;
          console.error(`🚨 Claude rejected a request: ${failure.type} (HTTP ${response.status})`);
          Promise.resolve(raise(failure.type, { status: response.status, reason: failure.reason })).catch(error => {
            console.warn('⚠️  Ops alert failed:', error.message);
          });
        }
      }
    } catch (error) {
      console.warn('⚠️  Could not check a Claude response:', /** @type {Error} */ (error).message);
    }
    return response;
  });
}

/**
 * An Anthropic client that reports billing and auth failures
 * @param {ConstructorParameters<typeof Anthropic>[0]} [options]
 * @returns {Anthropic}
 */
function createAnthropic(options = {}) {
  return new Anthropic({ ...options, fetch: watchedFetch() });
}

module.exports = { createAnthropic, classifyAiFailure, watchedFetch };
