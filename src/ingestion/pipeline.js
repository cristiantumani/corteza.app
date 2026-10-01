const { getDatabase } = require('../config/database');
const { createDecision } = require('../core/decisions/decision-service');
const { countByType } = require('../core/decisions/types');
const { track } = require('../integrations/posthog/client');
const { createActionItem } = require('../core/actions/action-service');
const { getWorkspaceMembersCollection } = require('../config/database');

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
 * @property {string|null} [language] - 'es' | 'en' | 'pt' to write outcomes in; otherwise the language spoken in the meeting
 */

function ingestions() {
  return getDatabase().collection('ingestions');
}

/** Whose meeting this is: only they see it in their list of latest meetings */
function ownerOf(transcript) {
  return (transcript.author && transcript.author.user_id) || null;
}

/**
 * One ingestion per person per meeting: colleagues in the same meeting each get
 * its outcomes in their own personal space
 */
function keyOf(transcript) {
  return { workspace_id: transcript.workspaceId, user_id: ownerOf(transcript), source: transcript.source, external_id: transcript.externalId };
}

/**
 * Latest meetings a person's Google Meet connection handled (never a colleague's)
 * @param {string} workspaceId
 * @param {string} userId
 * @param {string} source
 * @param {number} [limit]
 * @returns {Promise<Object[]>}
 */
async function listRecentForUser(workspaceId, userId, source, limit = 10) {
  return ingestions()
    .find({ workspace_id: workspaceId, user_id: userId, source })
    .sort({ updated_at: -1 })
    .limit(limit)
    .project({ title: 1, status: 1, skip_reason: 1, decisions_created: 1, outcomes_by_type: 1, action_items_created: 1, updated_at: 1, _id: 0 })
    .toArray();
}

/**
 * Claims a transcript for processing
 * @param {Transcript} transcript
 * @param {boolean} [manual] - a person chose this meeting (import): also re-process
 *   meetings that were skipped automatically or failed, but never completed ones
 * @returns {Promise<Object|null>} the ingestion document, or null if already handled/in progress
 */
async function claim(transcript, manual = false) {
  const key = keyOf(transcript);
  const now = new Date();

  try {
    const doc = {
      ...key,
      title: transcript.title,
      manual, // imported past meeting (or a manual retry): not counted as "today" in the daily digest
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
    : { status: 'failed', attempts: { $lt: MAX_ATTEMPTS }, updated_at: { $lt: new Date(now.getTime() - RETRY_AFTER_MS) } };
  return ingestions().findOneAndUpdate(
    { ...key, ...retryable },
    { $set: { status: 'processing', manual, updated_at: now }, $unset: { skip_reason: '' }, $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
}

/**
 * Records a meeting that was deliberately not processed (1:1, excluded title, no transcript…)
 * so it isn't looked at again.
 */
async function recordSkipped(transcript, reason) {
  await ingestions().updateOne(
    keyOf(transcript),
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
 * A person's ingestion status for many external items at once
 * @param {string} workspaceId
 * @param {string} userId - whose connection (colleagues' captures of the same meeting don't count)
 * @param {string} source
 * @param {string[]} externalIds
 * @returns {Promise<Map<string, Object>>} external_id → ingestion document
 */
async function getStatuses(workspaceId, userId, source, externalIds) {
  const docs = await ingestions()
    .find({ workspace_id: workspaceId, user_id: userId, source, external_id: { $in: externalIds } })
    .project({ external_id: 1, status: 1, skip_reason: 1, decisions_created: 1, outcomes_by_type: 1, _id: 0 })
    .toArray();
  return new Map(docs.map(doc => [doc.external_id, doc]));
}

/** Has this person's connection handled this external item already (processed, skipped, or given up on)? */
async function isHandled(workspaceId, userId, source, externalId) {
  const doc = await ingestions().findOne({ workspace_id: workspaceId, user_id: userId, source, external_id: externalId });
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
 * @returns {Promise<{ status: 'completed'|'duplicate'|'skipped'|'failed', decisions: Object[], actionItems: Object[], error?: string }>}
 */
async function ingestTranscript(transcript, { extract, manual = false } = {}) {
  const ingestion = await claim(transcript, manual);
  if (!ingestion) return { status: 'duplicate', decisions: [], actionItems: [] };

  const key = keyOf(transcript);

  try {
    const wordCount = (transcript.text || '').split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS) {
      await ingestions().updateOne(key, { $set: { status: 'skipped', skip_reason: 'too_short', word_count: wordCount, updated_at: new Date() } });
      return { status: 'skipped', decisions: [], actionItems: [] };
    }

    // Imports of past meetings stop at the workspace's daily AI cap (they can be re-imported
    // tomorrow); automatic capture of new meetings is never blocked
    if (manual) {
      const budget = await require('../core/usage/ai-usage').checkAiBudget(transcript.workspaceId);
      if (!budget.ok) {
        await ingestions().updateOne(key, { $set: { status: 'skipped', skip_reason: 'ai_budget', word_count: wordCount, updated_at: new Date() } });
        return { status: 'skipped', decisions: [], actionItems: [] };
      }
    }

    const extractDecisions = extract || require('../services/claude').extractDecisionsFromTranscript;
    const result = await extractDecisions(buildExtractionText(transcript), transcript.workspaceId, {
      language: transcript.language || null,
      userId: transcript.author?.user_id || null, // their personal context, plus the company's
      personName: transcript.author?.name || null
    });

    const source = {
      type: transcript.source,
      external_id: transcript.externalId,
      title: transcript.title || null,
      url: transcript.url || null,
      occurred_at: transcript.occurredAt ? new Date(transcript.occurredAt).toISOString() : null
    };
    const extractedItems = result.decisions || [];

    // Due dates belong to action items, not to decisions: a dated commitment the AI
    // attached to a decision (with no action item of its own) becomes a linked action item
    const linkedIndexes = new Set(extractedItems
      .filter(item => item.decision_type === 'action_item' && Number.isInteger(item.decision_ref))
      .map(item => item.decision_ref));
    const datedFollowUps = extractedItems
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => item.decision_type !== 'action_item' && item.due_date && !linkedIndexes.has(index))
      .map(({ item, index }) => ({
        decision_type: 'action_item',
        decision_text: item.decision_text,
        owner_names: item.owner_names || (item.owner_name ? [item.owner_name] : []),
        due_date: item.due_date,
        decision_ref: index,
        evidence_quote: item.evidence_quote || null,
        confidence: item.confidence
      }));

    // Decisions (and open questions, risks) first, so action items can link to them
    const decisions = [];
    const decisionIdByIndex = new Map();
    for (const [index, extracted] of extractedItems.entries()) {
      if (extracted.decision_type === 'action_item') continue;
      const decision = await createDecision({
        workspaceId: transcript.workspaceId,
        spaceId: transcript.spaceId,
        spaceName: transcript.spaceName || null,
        text: extracted.decision_text,
        type: extracted.decision_type,
        tags: extracted.tags,
        epicKey: extracted.epic_key,
        alternatives: [
          `Captured automatically from "${transcript.title || 'a meeting'}".`,
          extracted.evidence_quote ? `Quote: "${extracted.evidence_quote}"` : (extracted.context ? `Context: ${extracted.context}` : null),
          extracted.supersedes_hint ? `Replaces: ${extracted.supersedes_hint}` : null
        ].filter(Boolean).join('\n\n'),
        // Accountable person; when there's a date, the owner goes to the linked action item instead
        ownerName: extracted.due_date ? null : (extracted.owner_name || (extracted.owner_names || [])[0] || null),
        rationale: extracted.rationale || null,
        evidenceQuote: extracted.evidence_quote || null,
        author: transcript.author,
        source,
        capture: 'ai',
        confidence: extracted.confidence,
        decidedAt: transcript.occurredAt || null
      });
      decisions.push(decision);
      decisionIdByIndex.set(index, decision.id);
    }

    // Action items ("pendientes"): owners matched to workspace members
    const extractedActions = [...extractedItems.filter(item => item.decision_type === 'action_item'), ...datedFollowUps];
    const members = extractedActions.length === 0 ? [] : await getWorkspaceMembersCollection()
      .find({ workspace_id: transcript.workspaceId, removed_at: null })
      .project({ user_id: 1, user_name: 1, email: 1 })
      .toArray();
    const actionItems = [];
    for (const extracted of extractedActions) {
      actionItems.push(await createActionItem({
        workspaceId: transcript.workspaceId,
        spaceId: transcript.spaceId,
        spaceName: transcript.spaceName || null,
        text: extracted.decision_text,
        ownerNames: extracted.owner_names || (extracted.owner_name ? [extracted.owner_name] : []),
        dueDate: extracted.due_date || null,
        decisionId: decisionIdByIndex.get(extracted.decision_ref) ?? null,
        source,
        rationale: extracted.rationale || null,
        evidenceQuote: extracted.evidence_quote || null,
        capture: 'ai',
        confidence: extracted.confidence,
        author: transcript.author,
        members
      }));
    }

    await ingestions().updateOne(key, {
      $set: {
        status: 'completed',
        word_count: wordCount,
        decisions_created: decisions.length,
        outcomes_by_type: countByType(decisions),
        decision_ids: decisions.map(d => d.id),
        action_items_created: actionItems.length,
        model: result.model || null,
        completed_at: new Date(),
        updated_at: new Date()
      },
      $unset: { error: '' }
    });

    console.log(`🧠 Ingested ${transcript.source} "${transcript.title}" for ${transcript.workspaceId}: ${decisions.length} outcome(s), ${actionItems.length} action item(s)`);
    // Background work (poller, imports): no request, so the owner is passed explicitly
    track('meeting_captured', {
      source: transcript.source,
      manual,
      word_count: wordCount,
      outcome_count: decisions.length,
      action_item_count: actionItems.length,
      ...Object.fromEntries(Object.entries(countByType(decisions)).map(([type, count]) => [`${type}_count`, count])),
      language: result.language || null,
      workspace_id: transcript.workspaceId
    }, ownerOf(transcript));

    return { status: 'completed', decisions, actionItems };
  } catch (error) {
    console.error(`❌ Ingestion failed for ${transcript.source} ${transcript.externalId}:`, error.message);
    await ingestions().updateOne(key, { $set: { status: 'failed', error: error.message.slice(0, 500), updated_at: new Date() } });
    track('meeting_capture_failed', { source: transcript.source, manual, workspace_id: transcript.workspaceId }, ownerOf(transcript));
    return { status: 'failed', decisions: [], actionItems: [], error: error.message };
  }
}

module.exports = {
  ingestTranscript,
  recordSkipped,
  listRecentForUser,
  isHandled,
  getStatuses,
  buildExtractionText,
  MAX_ATTEMPTS
};
