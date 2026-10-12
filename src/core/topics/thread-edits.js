const { getDecisionsCollection, getDatabase } = require('../../config/database');
const { isAdmin } = require('../../services/permissions');
const { setResolution } = require('../decisions/questions-risks');

/**
 * Changes people make to a thread (docs/specs/2026-10-thread-as-unit.md):
 *   - useAsAnswer: a decision of the thread answers its open question (or mitigates its risk)
 *   - unlinkFromThread / relinkToThread: "Not related", and its undo. The thread id goes into
 *     the item's `unlinked_topics`, so cross-meeting links never put it back (applyLinks).
 */

const KINDS = ['decision', 'action_item'];

function actions() {
  return getDatabase().collection('action_items');
}

/**
 * Closes an open question or risk with a decision from the same thread
 * @param {Object} params
 * @param {Object} params.question - the stored question or risk (the caller checked access)
 * @param {unknown} params.decisionId
 * @param {{ user_id: string, name?: string|null }} params.user
 * @param {string[]} params.spaceIds - spaces the person can access
 * @param {(key: string, vars?: Object) => string} params.t - in the person's language, for the note
 * @returns {Promise<Object|{ error: string, status: number }>} the updated fields
 */
async function useAsAnswer({ question, decisionId, user, spaceIds, t }) {
  const id = typeof decisionId === 'number' ? decisionId : Number(decisionId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Invalid decision', status: 400 };
  if (!question.topic_id) return { error: 'This item isn’t in a thread', status: 400 };
  const decision = await getDecisionsCollection().findOne(
    { workspace_id: question.workspace_id, id, type: 'decision', topic_id: question.topic_id, space_id: { $in: spaceIds || [] } },
    { projection: { _id: 0, id: 1, text: 1, source_details: 1, timestamp: 1 } }
  );
  if (!decision) return { error: 'Decision not found in this thread', status: 404 };
  const vars = {
    text: decision.text,
    meeting: (decision.source_details && decision.source_details.title) || t('links.manual'),
    date: String(decision.timestamp || '').slice(0, 10)
  };
  const note = t(question.type === 'risk' ? 'threads.mitigatedNote' : 'threads.answeredNote', vars);
  return setResolution(question, 'resolved', user, note, { answeredBy: decision.id });
}

/**
 * The item, if the person can see it, with what's needed to check they may change it
 * @param {string} workspaceId
 * @param {'decision'|'action_item'} kind
 * @param {unknown} id
 * @param {string} userId
 * @param {string[]} spaceIds
 * @returns {Promise<any|null>}
 */
async function findItem(workspaceId, kind, id, userId, spaceIds) {
  if (kind === 'decision') {
    const decisionId = typeof id === 'number' ? id : Number(id);
    if (!Number.isInteger(decisionId) || decisionId <= 0) return null;
    return getDecisionsCollection().findOne(
      { workspace_id: workspaceId, id: decisionId, space_id: { $in: spaceIds || [] } },
      { projection: { _id: 0, id: 1, user_id: 1, topic_id: 1, unlinked_topics: 1 } }
    );
  }
  if (typeof id !== 'string' || !id) return null;
  return actions().findOne(
    { workspace_id: workspaceId, item_id: id, $or: [{ space_id: { $in: spaceIds || [] } }, { owner_ids: userId }] },
    { projection: { _id: 0, item_id: 1, owner_ids: 1, created_by: 1, topic_id: 1, unlinked_topics: 1 } }
  );
}

/** Whoever can edit it: its author (outcomes) or owners and author (action items), or an admin */
async function canEdit(workspaceId, kind, item, userId) {
  const own = kind === 'decision'
    ? item.user_id === userId
    : (item.owner_ids || []).includes(userId) || (item.created_by && item.created_by.user_id) === userId;
  return own || isAdmin(null, workspaceId, userId);
}

/**
 * Loads and checks an item for unlink/relink
 * @returns {Promise<{ item: any }|{ error: string, status: number }>}
 */
async function editableItem({ workspaceId, kind, id, userId, spaceIds }) {
  if (!KINDS.includes(kind)) return { error: 'Invalid kind', status: 400 };
  const item = await findItem(workspaceId, kind, id, userId, spaceIds);
  if (!item) return { error: 'Not found', status: 404 };
  if (!await canEdit(workspaceId, kind, item, userId)) return { error: 'Only its author, owners or an admin can change this', status: 403 };
  return { item };
}

function updateItem(workspaceId, kind, item, update) {
  return kind === 'decision'
    ? getDecisionsCollection().updateOne({ workspace_id: workspaceId, id: item.id }, update)
    : actions().updateOne({ workspace_id: workspaceId, item_id: item.item_id }, update);
}

/**
 * "Not related": takes an item out of its thread for good
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {'decision'|'action_item'} params.kind
 * @param {unknown} params.id - decision id or action item_id
 * @param {string} params.userId
 * @param {string[]} params.spaceIds
 * @returns {Promise<{ topic_id: string }|{ error: string, status: number }>} the thread it left
 */
async function unlinkFromThread({ workspaceId, kind, id, userId, spaceIds }) {
  const found = await editableItem({ workspaceId, kind, id, userId, spaceIds });
  if ('error' in found) return found;
  const topicId = found.item.topic_id;
  if (!topicId) return { error: 'This item isn’t in a thread', status: 400 };
  await updateItem(workspaceId, kind, found.item, { $set: { topic_id: null, topic: null }, $addToSet: { unlinked_topics: topicId } });
  return { topic_id: topicId };
}

/**
 * Undo of "Not related": puts the item back in a thread it was taken out of
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {'decision'|'action_item'} params.kind
 * @param {unknown} params.id
 * @param {unknown} params.topicId
 * @param {string} params.userId
 * @param {string[]} params.spaceIds
 * @returns {Promise<{ topic_id: string }|{ error: string, status: number }>}
 */
async function relinkToThread({ workspaceId, kind, id, topicId, userId, spaceIds }) {
  if (typeof topicId !== 'string' || !topicId) return { error: 'Invalid thread', status: 400 };
  const found = await editableItem({ workspaceId, kind, id, userId, spaceIds });
  if ('error' in found) return found;
  if (!(found.item.unlinked_topics || []).includes(topicId)) return { error: 'It wasn’t in this thread', status: 400 };
  // The thread's name, from any item still in it
  const named = await getDecisionsCollection().findOne({ workspace_id: workspaceId, topic_id: topicId }, { projection: { _id: 0, topic: 1 } })
    || await actions().findOne({ workspace_id: workspaceId, topic_id: topicId }, { projection: { _id: 0, topic: 1 } });
  await updateItem(workspaceId, kind, found.item, {
    $set: { topic_id: topicId, topic: (named && named.topic) || null },
    $pull: { unlinked_topics: topicId }
  });
  // A thread with a sensitive item is sensitive as a whole
  await require('../privacy/sensitive').spreadSensitivity(workspaceId, [topicId]);
  return { topic_id: topicId };
}

module.exports = { useAsAnswer, unlinkFromThread, relinkToThread, KINDS };
