/**
 * Extraction through the Message Batches API, for imports of past meetings: the same
 * request as a live call (services/claude.buildExtractionParams) at half the price, in
 * exchange for waiting (most batches end within minutes, at most 24 hours).
 *
 * Used by ingestion/meet-import.js: it submits one batch per import, then the Meet
 * poller collects the results (resumeStaleImports → runImport). Automatic capture of new
 * meetings stays live. AI_BATCH_IMPORTS=false turns batching off.
 *
 * Batch requests can't use server-side refusal fallbacks; a refused or failed request is
 * extracted again live.
 */

/** @returns {boolean} imports use the Batches API (on unless AI_BATCH_IMPORTS=false) */
function batchImportsEnabled() {
  return process.env.AI_BATCH_IMPORTS !== 'false';
}

/**
 * The batch client: create, check and read results. Injectable in tests.
 * @returns {{ create: Function, retrieve: Function, results: Function }}
 */
function defaultBatchClient() {
  const claude = require('../services/claude');
  const anthropic = claude.createClient();
  return {
    /** @param {{ custom_id: string, params: Object }[]} requests */
    create: requests => anthropic.messages.batches.create({ requests: /** @type {any} */ (requests) }),
    /** @param {string} id */
    retrieve: id => anthropic.messages.batches.retrieve(id),
    /** @param {string} id */
    results: id => anthropic.messages.batches.results(id)
  };
}

/**
 * Submits one batch of extraction prompts
 * @param {{ customId: string, prompt: string }[]} prompts
 * @param {{ client?: Object }} [deps]
 * @returns {Promise<string>} the batch id
 */
async function submitExtractionBatch(prompts, { client } = {}) {
  const { buildExtractionParams } = require('../services/claude');
  const batches = client || defaultBatchClient();
  const batch = await batches.create(prompts.map(({ customId, prompt }) => ({ custom_id: customId, params: buildExtractionParams(prompt) })));
  console.log(`📦 Extraction batch ${batch.id} submitted: ${prompts.length} request(s)`);
  return batch.id;
}

/**
 * Results of a batch once it has ended
 * @param {string} batchId
 * @param {{ client?: Object }} [deps]
 * @returns {Promise<Map<string, { message?: any, error?: string }>|null>} custom_id → the Message, or
 *   why it has none (errored, expired, canceled); null while the batch is still running
 */
async function fetchExtractionResults(batchId, { client } = {}) {
  const batches = client || defaultBatchClient();
  const batch = await batches.retrieve(batchId);
  if (batch.processing_status !== 'ended') return null;

  const results = new Map();
  for await (const entry of await batches.results(batchId)) {
    // Results come in any order: key them by custom_id
    results.set(entry.custom_id, entry.result.type === 'succeeded'
      ? { message: entry.result.message }
      : { error: entry.result.type === 'errored' ? (entry.result.error?.error?.type || entry.result.error?.type || 'errored') : entry.result.type });
  }
  return results;
}

module.exports = { batchImportsEnabled, submitExtractionBatch, fetchExtractionResults };
