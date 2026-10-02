const { getDecisionsCollection, getDatabase } = require('../../config/database');

/**
 * Reads topic threads (see topics.js): the outcomes (`decisions`) and action items that
 * share a `topic_id`. Visibility follows spaces, like everything else: outcomes in spaces
 * the viewer can access, and action items in those spaces or owned by the viewer (minus
 * copies of items they already have, see core/actions/colleague-assignments).
 */

const MAX_PER_THREAD = 20;
const OUTCOME_FIELDS = { _id: 0, id: 1, type: 1, text: 1, owner_name: 1, resolution_status: 1, topic_id: 1, topic: 1, timestamp: 1 };
const ACTION_FIELDS = { _id: 0, item_id: 1, text: 1, owners: 1, due_date: 1, status: 1, topic_id: 1, topic: 1, decision_id: 1 };

/**
 * @typedef {Object} Thread
 * @property {string} topic_id
 * @property {string|null} topic
 * @property {Object[]} outcomes - { id, type, text, owner_name, resolution_status ('open'|'resolved'), timestamp }
 * @property {Object[]} actions - { item_id, text, owners: [{ name }], due_date, status, decision_id }
 */

/**
 * Loads the threads with these ids, as the viewer can see them
 * @param {string} workspaceId
 * @param {string[]} topicIds
 * @param {{ spaceIds: string[], viewerId?: string|null }} access
 * @returns {Promise<Map<string, Thread>>}
 */
async function loadThreads(workspaceId, topicIds, { spaceIds, viewerId = null }) {
  const ids = [...new Set(topicIds.filter(id => typeof id === 'string' && id))];
  const threads = new Map();
  if (ids.length === 0) return threads;

  const actionAccess = viewerId
    ? [{ space_id: { $in: spaceIds || [] } }, { owner_ids: viewerId, 'owner_duplicates.user_id': { $ne: viewerId } }]
    : [{ space_id: { $in: spaceIds || [] } }];
  const [outcomes, actions] = await Promise.all([
    getDecisionsCollection()
      .find({ workspace_id: workspaceId, topic_id: { $in: ids }, space_id: { $in: spaceIds || [] } }, { projection: OUTCOME_FIELDS })
      .sort({ timestamp: 1, id: 1 }).limit(ids.length * MAX_PER_THREAD).toArray(),
    getDatabase().collection('action_items')
      .find({ workspace_id: workspaceId, topic_id: { $in: ids }, $or: actionAccess }, { projection: ACTION_FIELDS })
      .sort({ created_at: 1 }).limit(ids.length * MAX_PER_THREAD).toArray()
  ]);

  const threadFor = (/** @type {{ topic_id: string, topic?: string|null }} */ row) => {
    if (!threads.has(row.topic_id)) threads.set(row.topic_id, { topic_id: row.topic_id, topic: row.topic || null, outcomes: [], actions: [] });
    return /** @type {Thread} */ (threads.get(row.topic_id));
  };
  const withoutThread = row => { const copy = { ...row }; delete copy.topic_id; delete copy.topic; return copy; };
  for (const outcome of outcomes) {
    threadFor(outcome).outcomes.push({ ...withoutThread(outcome), resolution_status: outcome.resolution_status || 'open' });
  }
  for (const action of actions) {
    threadFor(action).actions.push({ ...withoutThread(action), owners: (action.owners || []).map(owner => ({ name: owner.name || null })) });
  }
  return threads;
}

/**
 * A thread's summary for an action item: "Part of: <topic> · N questions, M risks"
 * @param {Thread|undefined} thread
 * @returns {{ topic_id: string, topic: string|null, questions: number, risks: number, open_questions: { id: number, text: string }[] }|null}
 *   null when the thread has no question or risk the viewer can see
 */
function threadSummary(thread) {
  if (!thread) return null;
  const questions = thread.outcomes.filter(outcome => outcome.type === 'open_question');
  const risks = thread.outcomes.filter(outcome => outcome.type === 'risk');
  if (questions.length + risks.length === 0) return null;
  return {
    topic_id: thread.topic_id,
    topic: thread.topic,
    questions: questions.length,
    risks: risks.length,
    open_questions: questions.filter(q => q.resolution_status !== 'resolved').map(q => ({ id: q.id, text: q.text }))
  };
}

/**
 * Adds `thread` (threadSummary) to action items that belong to one
 * @param {string} workspaceId
 * @param {Object[]} items - action items
 * @param {{ spaceIds: string[], viewerId?: string|null }} access
 * @returns {Promise<Object[]>} the same items, each with `thread` (or null)
 */
async function withThreadSummaries(workspaceId, items, access) {
  const threads = await loadThreads(workspaceId, items.map(item => item.topic_id), access);
  return items.map(item => ({ ...item, thread: item.topic_id ? threadSummary(threads.get(item.topic_id)) : null }));
}

/**
 * Adds `linked` to questions and risks: the other items of their thread
 * @param {string} workspaceId
 * @param {Object[]} items - outcomes (questions and risks)
 * @param {{ spaceIds: string[], viewerId?: string|null }} access
 * @returns {Promise<Object[]>} each with `topic_id`, `topic` and `linked: { outcomes, actions }` (empty when none)
 */
async function withLinkedItems(workspaceId, items, access) {
  const threads = await loadThreads(workspaceId, items.map(item => item.topic_id), access);
  return items.map(item => {
    const thread = item.topic_id ? threads.get(item.topic_id) : undefined;
    return {
      ...item,
      linked: thread
        ? { outcomes: thread.outcomes.filter(outcome => outcome.id !== item.id), actions: thread.actions }
        : { outcomes: [], actions: [] }
    };
  });
}

/**
 * Open outcomes of one type in a thread, for close-the-loop suggestions
 * @param {string} workspaceId
 * @param {string|null|undefined} topicId
 * @param {'open_question'|'risk'} type
 * @param {{ spaceIds: string[] }} access
 * @returns {Promise<{ id: number, type: string, text: string }[]>}
 */
async function openInThread(workspaceId, topicId, type, { spaceIds }) {
  if (typeof topicId !== 'string' || !topicId) return [];
  return getDecisionsCollection().find(
    { workspace_id: workspaceId, topic_id: topicId, type, space_id: { $in: spaceIds || [] }, resolution_status: { $ne: 'resolved' } },
    { projection: { _id: 0, id: 1, type: 1, text: 1 } }
  ).sort({ id: 1 }).limit(MAX_PER_THREAD).toArray();
}

module.exports = { loadThreads, threadSummary, withThreadSummaries, withLinkedItems, openInThread };
