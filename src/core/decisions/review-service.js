const crypto = require('crypto');
const { getDecisionsCollection, getAIFeedbackCollection } = require('../../config/database');

/**
 * Reviewing AI-captured outcomes: confirm (it's right) or dismiss (it shouldn't be here).
 *
 * - Confirm sets `review_status: 'confirmed'` on the outcome and saves an "approved" example.
 * - Dismiss removes the outcome and saves a "rejected" example, with the reason and a copy
 *   of the outcome, so it can be restored (undo) and so the extraction learns what not to
 *   capture (few-shot examples in services/claude.js, per person).
 *
 * An outcome with `capture: 'ai'` and no `review_status` is waiting for review.
 */

/** Why an outcome was dismissed: key → wording used in the extraction prompt's examples */
const DISMISS_REASONS = {
  not_relevant: 'not relevant to the business',
  not_an_outcome: 'nobody decided or committed to this',
  inaccurate: 'inaccurate: not what was said',
  duplicate: 'duplicate of another item',
  about_a_person: 'a judgment about a person; never capture these'
};

/** Filter for AI-captured outcomes nobody has reviewed yet */
const PENDING_REVIEW = { capture: 'ai', review_status: null };

function feedbackExample(decision) {
  return { decision_text: decision.text, decision_type: decision.type };
}

/**
 * Marks an outcome as right. Idempotent.
 * @param {Object} decision - the stored outcome (the caller checked access)
 * @param {{ user_id: string }} reviewer
 * @returns {Promise<Object>} the updated fields
 */
async function confirmDecision(decision, reviewer) {
  const review = { review_status: 'confirmed', reviewed_by: reviewer.user_id, reviewed_at: new Date() };
  await getDecisionsCollection().updateOne({ _id: decision._id }, { $set: review });
  if (decision.capture === 'ai' && decision.review_status !== 'confirmed') {
    await getAIFeedbackCollection().insertOne({
      feedback_id: `feedback_${crypto.randomUUID()}`,
      workspace_id: decision.workspace_id,
      user_id: reviewer.user_id,
      decision_id: decision.id,
      source: 'review',
      action: 'approved',
      original_suggestion: feedbackExample(decision),
      created_at: new Date().toISOString()
    });
  }
  return review;
}

/**
 * Removes an outcome that shouldn't have been captured, keeping a copy to undo and to learn from
 * @param {Object} decision - the stored outcome (the caller checked access)
 * @param {{ user_id: string }} reviewer
 * @param {string|null} [reason] - a key of DISMISS_REASONS
 * @returns {Promise<{ feedback_id: string }>}
 */
async function dismissDecision(decision, reviewer, reason = null) {
  const reasonKey = Object.prototype.hasOwnProperty.call(DISMISS_REASONS, reason) ? reason : null;
  // eslint-disable-next-line no-unused-vars
  const { _id, embedding, ...snapshot } = decision;
  const feedbackId = `feedback_${crypto.randomUUID()}`;
  await getAIFeedbackCollection().insertOne({
    feedback_id: feedbackId,
    workspace_id: decision.workspace_id,
    user_id: reviewer.user_id,
    decision_id: decision.id,
    source: 'review',
    action: 'rejected',
    reason: reasonKey,
    rejection_reason: reasonKey ? DISMISS_REASONS[reasonKey] : null,
    original_suggestion: feedbackExample(decision),
    snapshot,
    created_at: new Date().toISOString()
  });
  await getDecisionsCollection().deleteOne({ _id: decision._id });
  return { feedback_id: feedbackId };
}

/**
 * Undo a dismissal: puts the outcome back (same number) and forgets the rejected example.
 * Only the person who dismissed it can restore it.
 * @param {string} workspaceId
 * @param {string} userId
 * @param {number} decisionId
 * @returns {Promise<Object|null>} the restored outcome, or null if there's nothing to restore
 */
async function restoreDecision(workspaceId, userId, decisionId) {
  const feedback = getAIFeedbackCollection();
  const dismissal = await feedback.findOne(
    { workspace_id: workspaceId, user_id: userId, decision_id: decisionId, source: 'review', action: 'rejected', snapshot: { $exists: true } },
    { sort: { created_at: -1 } }
  );
  if (!dismissal) return null;

  const decisions = getDecisionsCollection();
  const existing = await decisions.findOne({ workspace_id: workspaceId, id: decisionId }, { projection: { _id: 1 } });
  if (!existing) {
    const restored = { ...dismissal.snapshot, workspace_id: workspaceId, id: decisionId };
    await decisions.insertOne(restored);
    // Embedding for semantic search (it isn't kept in the copy)
    const { generateDecisionEmbedding, isEmbeddingsEnabled } = require('../../services/embeddings');
    if (isEmbeddingsEnabled()) {
      generateDecisionEmbedding(restored)
        .then(embedding => decisions.updateOne({ _id: restored._id }, { $set: { embedding } }))
        .catch(error => console.error('Embedding generation failed:', error.message));
    }
  }
  await feedback.deleteOne({ _id: dismissal._id });
  return decisions.findOne({ workspace_id: workspaceId, id: decisionId }, { projection: { embedding: 0 } });
}

/**
 * Adds why to the latest dismissal of an outcome (the reason chips shown after dismissing)
 * @param {string} workspaceId
 * @param {string} userId - who dismissed it
 * @param {number} decisionId
 * @param {string} reason - a key of DISMISS_REASONS
 * @returns {Promise<boolean>} false for an unknown reason or no dismissal
 */
async function setDismissReason(workspaceId, userId, decisionId, reason) {
  if (!Object.prototype.hasOwnProperty.call(DISMISS_REASONS, reason)) return false;
  const feedback = getAIFeedbackCollection();
  const dismissal = await feedback.findOne(
    { workspace_id: workspaceId, user_id: userId, decision_id: decisionId, source: 'review', action: 'rejected' },
    { sort: { created_at: -1 }, projection: { _id: 1 } }
  );
  if (!dismissal) return false;
  await feedback.updateOne({ _id: dismissal._id }, { $set: { reason, rejection_reason: DISMISS_REASONS[reason] } });
  return true;
}

module.exports = {
  DISMISS_REASONS,
  setDismissReason,
  PENDING_REVIEW,
  confirmDecision,
  dismissDecision,
  restoreDecision
};
