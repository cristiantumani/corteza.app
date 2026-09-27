const { getDatabase } = require('../config/database');
const { createDecision } = require('../core/decisions/decision-service');

/**
 * Ingestion pipeline: Transcript → dedupe → AI extraction → saved decisions.
 *
 * Source adapters (ingestion/sources/*) turn external input into a Transcript and
 * call ingestTranscript(). Decisions are saved automatically (no review step),
 * marked capture: 'ai' with the source and confidence, so people can edit or
 * delete them afterwards.
 *
 * The `ingestions` collection (unique on workspace_id + source + external_id)
 * guarantees each meeting is processed once, even if several participants have
 * connected Google or the poller runs on several instances. Failed ingestions are
 * retried up to MAX_ATTEMPTS times, at most every RETRY_AFTER_MS.
 */

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 10 * 60 * 1000;
const MIN_WORDS = 50;

/**
 * @typedef {Object} Transcript
 * @property {string} workspaceId
 * @property {string} source - e.g. 'google_meet'
 * @property {string} externalId - stable ID in the source (e.g. conference record name)
 * @property {string} title
 * @property {string} text - transcript and/or meeting notes
 * @property {string[]} [participants] - display names
 * @property {Date|string} [occurredAt]
 * @property {string|null} [url] - link back to the transcript/notes
 * @property {string} spaceId - where decisions are saved
 * @property {string|null} [spaceName]
 * @property {Object} author - { user_id, name }: who captured decisions are attributed to
 */

function ingestions() {
  return getDatabase().collection('ingestions');
}

/**
 * Claims a transcript for processing
 * @param {Transcript} transcript
 * @param {boolean} [manual] - a person chose this meeting (import): also re-process
 *   meetings that were skipped automatically or failed, but never completed ones
 * @returns {Promise<Object|null>} the ingestion document, or null if already handled/in progress
 */
async function claim(transcript, manual = false) {
  const key = { workspace_id: transcript.workspaceId, source: transcript.source, external_id: transcript.externalId };
  const now = new Date();

  try {
    const doc = {
      ...key,
      title: transcript.title,
      status: 'processing',
      attempts: 1,
      decisions_created: 0,
      created_at: now,
      updated_at: now
    };
    await ingestions().insertOne(doc);
    return doc;
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  // Already known: automatic runs retry only if a previous attempt failed a while ago
  const retryable = manual
    ? { status: { $in: ['skipped', 'failed'] } }
    : { status: 'failed', attempts: { $lt: MAX_ATTEMPTS }, updated_at: { $lt: new Date(now - RETRY_AFTER_MS) } };
  return ingestions().findOneAndUpdate(
    { ...key, ...retryable },
    { $set: { status: 'processing', updated_at: now }, $unset: { skip_reason: '' }, $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
}

/**
 * Records a meeting that was deliberately not processed (1:1, excluded title, no transcript…)
 * so it isn't looked at again.
 */
async function recordSkipped(transcript, reason) {
  await ingestions().updateOne(
    { workspace_id: transcript.workspaceId, source: transcript.source, external_id: transcript.externalId },
    {
      $setOnInsert: {
        title: transcript.title || null,
        status: 'skipped',
        skip_reason: reason,
        attempts: 0,
        decisions_created: 0,
        created_at: new Date(),
        updated_at: new Date()
      }
    },
    { upsert: true }
  );
}

/**
 * Ingestion status for many external items at once
 * @returns {Promise<Map<string, Object>>} external_id → ingestion document
 */
async function getStatuses(workspaceId, source, externalIds) {
  const docs = await ingestions()
    .find({ workspace_id: workspaceId, source, external_id: { $in: externalIds } })
    .project({ external_id: 1, status: 1, skip_reason: 1, decisions_created: 1, _id: 0 })
    .toArray();
  return new Map(docs.map(doc => [doc.external_id, doc]));
}

/** Has this external item been handled already (processed, skipped, or given up on)? */
async function isHandled(workspaceId, source, externalId) {
  const doc = await ingestions().findOne({ workspace_id: workspaceId, source, external_id: externalId });
  return !!doc && (doc.status !== 'failed' || doc.attempts >= MAX_ATTEMPTS);
}

function buildExtractionText(transcript) {
  const header = [
    transcript.title ? `Meeting: ${transcript.title}` : null,
    transcript.occurredAt ? `Date: ${new Date(transcript.occurredAt).toISOString().slice(0, 10)}` : null,
    transcript.participants?.length ? `Participants: ${transcript.participants.join(', ')}` : null
  ].filter(Boolean).join('\n');
  return header ? `${header}\n\n${transcript.text}` : transcript.text;
}

/**
 * Processes a transcript end to end
 * @param {Transcript} transcript
 * @param {Object} [options]
 * @param {Function} [options.extract] - (text, workspaceId) => { decisions } (defaults to Claude)
 * @param {boolean} [options.manual] - chosen by a person (see claim)
 * @returns {Promise<{ status: 'completed'|'duplicate'|'skipped'|'failed', decisions: Object[], error?: string }>}
 */
async function ingestTranscript(transcript, { extract, manual = false } = {}) {
  const ingestion = await claim(transcript, manual);
  if (!ingestion) return { status: 'duplicate', decisions: [] };

  const key = { workspace_id: transcript.workspaceId, source: transcript.source, external_id: transcript.externalId };

  try {
    const wordCount = (transcript.text || '').split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS) {
      await ingestions().updateOne(key, { $set: { status: 'skipped', skip_reason: 'too_short', word_count: wordCount, updated_at: new Date() } });
      return { status: 'skipped', decisions: [] };
    }

    const extractDecisions = extract || require('../services/claude').extractDecisionsFromTranscript;
    const result = await extractDecisions(buildExtractionText(transcript), transcript.workspaceId);

    const decisions = [];
    for (const extracted of result.decisions || []) {
      decisions.push(await createDecision({
        workspaceId: transcript.workspaceId,
        spaceId: transcript.spaceId,
        spaceName: transcript.spaceName || null,
        text: extracted.decision_text,
        type: extracted.decision_type,
        tags: extracted.tags,
        epicKey: extracted.epic_key,
        alternatives: [
          `Captured automatically from "${transcript.title || 'a meeting'}".`,
          extracted.rationale ? `Why: ${extracted.rationale}` : null,
          extracted.evidence_quote ? `Quote: "${extracted.evidence_quote}"` : (extracted.context ? `Context: ${extracted.context}` : null),
          extracted.supersedes_hint ? `Replaces: ${extracted.supersedes_hint}` : null
        ].filter(Boolean).join('\n\n'),
        ownerName: extracted.owner_name || null,
        dueDate: extracted.due_date || null,
        rationale: extracted.rationale || null,
        evidenceQuote: extracted.evidence_quote || null,
        author: transcript.author,
        source: {
          type: transcript.source,
          external_id: transcript.externalId,
          title: transcript.title || null,
          url: transcript.url || null,
          occurred_at: transcript.occurredAt ? new Date(transcript.occurredAt).toISOString() : null
        },
        capture: 'ai',
        confidence: extracted.confidence,
        decidedAt: transcript.occurredAt || null
      }));
    }

    await ingestions().updateOne(key, {
      $set: {
        status: 'completed',
        word_count: wordCount,
        decisions_created: decisions.length,
        decision_ids: decisions.map(d => d.id),
        model: result.model || null,
        completed_at: new Date(),
        updated_at: new Date()
      },
      $unset: { error: '' }
    });

    console.log(`🧠 Ingested ${transcript.source} "${transcript.title}" for ${transcript.workspaceId}: ${decisions.length} decision(s)`);
    return { status: 'completed', decisions };
  } catch (error) {
    console.error(`❌ Ingestion failed for ${transcript.source} ${transcript.externalId}:`, error.message);
    await ingestions().updateOne(key, { $set: { status: 'failed', error: error.message.slice(0, 500), updated_at: new Date() } });
    return { status: 'failed', decisions: [], error: error.message };
  }
}

module.exports = {
  ingestTranscript,
  recordSkipped,
  isHandled,
  getStatuses,
  buildExtractionText,
  MAX_ATTEMPTS
};
