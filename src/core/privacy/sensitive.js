const { getDatabase, getDecisionsCollection } = require('../../config/database');
const { ensurePersonalSpace } = require('../../services/spaces');
const { getUserAccessibleSpaces } = require('../../services/permissions');

/**
 * Sensitive topics (docs/specs/2026-10-sensitive-topics.md): layoffs, people leaving, low
 * performance, pay, health, legal or disciplinary matters, restructurings that name people.
 * A sensitive outcome or action item is visible only to one person (`private_to`): it lives in
 * their personal space, and an action item's other owners keep their name on it but no access
 * (`owner_ids` holds only `private_to`, when they own it), so it never reaches their Action
 * items, morning summary, search, meeting prep or "new from a colleague".
 *
 * Marking one marks its whole thread (`topic_id`) and the items tied to it (`decision_id`).
 */

function actions() {
  return getDatabase().collection('action_items');
}

/**
 * The owner_ids an action item grants access with
 * @param {{ user_id?: string|null }[]} owners
 * @param {boolean} sensitive
 * @param {string|null} privateTo - who a sensitive item stays visible to
 * @returns {string[]}
 */
function ownerIdsFor(owners, sensitive, privateTo) {
  const ids = (owners || []).map(owner => owner && owner.user_id).filter(Boolean);
  if (!sensitive) return [...new Set(ids)];
  return privateTo && ids.includes(privateTo) ? [privateTo] : [];
}

/**
 * Marks an outcome or action item, and its thread, sensitive (or not)
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {'decision'|'action_item'} params.kind
 * @param {number|string} params.id - decision id, or action item_id
 * @param {boolean} params.value
 * @param {{ user_id: string, name?: string|null }} params.actor - who marks it; a sensitive item stays visible to them
 * @param {string[]} params.spaceIds - spaces the actor can access (only items there change)
 * @returns {Promise<{ notFound?: boolean, decisions: number, action_items: number }>}
 */
async function setSensitive({ workspaceId, kind, id, value, actor, spaceIds }) {
  const decisionsCol = getDecisionsCollection();
  const target = kind === 'decision'
    ? await decisionsCol.findOne({ workspace_id: workspaceId, id, space_id: { $in: spaceIds } }, { projection: { _id: 0, id: 1, topic_id: 1, decision_id: 1 } })
    : await actions().findOne({ workspace_id: workspaceId, item_id: id, space_id: { $in: spaceIds } }, { projection: { _id: 0, item_id: 1, topic_id: 1, decision_id: 1 } });
  if (!target) return { notFound: true, decisions: 0, action_items: 0 };

  // The group: its thread, plus what's tied by decision_id
  const decisionIds = new Set();
  if (kind === 'decision') decisionIds.add(target.id);
  else if (typeof target.decision_id === 'number') decisionIds.add(target.decision_id);
  const accessible = { workspace_id: workspaceId, space_id: { $in: spaceIds } };
  /** @type {Object[]} */
  const decisionOr = [{ id: { $in: [...decisionIds] } }];
  if (target.topic_id) decisionOr.push({ topic_id: target.topic_id });
  const groupDecisions = await decisionsCol.find({ ...accessible, $or: decisionOr }, { projection: { _id: 0, id: 1 } }).toArray();
  groupDecisions.forEach(decision => decisionIds.add(decision.id));
  /** @type {Object[]} */
  const actionOr = [{ decision_id: { $in: [...decisionIds] } }];
  if (kind === 'action_item') actionOr.push({ item_id: target.item_id });
  if (target.topic_id) actionOr.push({ topic_id: target.topic_id });
  const groupActions = await actions().find({ ...accessible, $or: actionOr }, { projection: { _id: 0, item_id: 1, owners: 1 } }).toArray();

  const now = new Date();
  const personal = value ? await ensurePersonalSpace(workspaceId, actor.user_id, actor.name || null) : null;
  const where = personal ? { space_id: personal.space_id, space_name: personal.name || null } : {};
  const flags = { sensitive: !!value, private_to: value ? actor.user_id : null };

  if (decisionIds.size) {
    await decisionsCol.updateMany(
      { ...accessible, id: { $in: [...decisionIds] } },
      { $set: { ...flags, ...where } }
    );
  }
  for (const item of groupActions) {
    const update = { $set: { ...flags, ...where, owner_ids: ownerIdsFor(item.owners, !!value, actor.user_id), updated_at: now } };
    // Hidden from colleagues: no "new from a colleague" for them either
    if (value) update.$unset = { unseen_by: '' };
    await actions().updateOne({ workspace_id: workspaceId, item_id: item.item_id }, update);
  }
  return { decisions: decisionIds.size, action_items: groupActions.length };
}

/**
 * Threads with a sensitive item make the rest of it sensitive too, private to the same person
 * (a capture's or another meeting's item joined a sensitive thread, or a sensitive one joined a thread)
 * @param {string} workspaceId
 * @param {string[]} topicIds
 * @returns {Promise<number>} items newly marked
 */
async function spreadSensitivity(workspaceId, topicIds) {
  const decisionsCol = getDecisionsCollection();
  let marked = 0;
  for (const topicId of [...new Set(topicIds.filter(Boolean))]) {
    const filter = { workspace_id: workspaceId, topic_id: topicId };
    const [decisionSource, actionSource] = await Promise.all([
      decisionsCol.findOne({ ...filter, sensitive: true }, { projection: { _id: 0, private_to: 1 } }),
      actions().findOne({ ...filter, sensitive: true }, { projection: { _id: 0, private_to: 1 } })
    ]);
    const privateTo = (decisionSource && decisionSource.private_to) || (actionSource && actionSource.private_to) || null;
    if (!privateTo) continue;
    // Only items in spaces that person can access: a colleague's own capture in their personal space stays theirs
    const spaceIds = await getUserAccessibleSpaces(null, workspaceId, privateTo);
    const reachable = { ...filter, space_id: { $in: spaceIds }, sensitive: { $ne: true } };
    const personal = await ensurePersonalSpace(workspaceId, privateTo);
    const set = { sensitive: true, private_to: privateTo, space_id: personal.space_id, space_name: personal.name || null };
    const result = await decisionsCol.updateMany(reachable, { $set: set });
    marked += result.modifiedCount || 0;
    const open = await actions().find(reachable, { projection: { _id: 0, item_id: 1, owners: 1 } }).toArray();
    for (const item of open) {
      await actions().updateOne(
        { workspace_id: workspaceId, item_id: item.item_id },
        { $set: { ...set, owner_ids: ownerIdsFor(item.owners, true, privateTo), updated_at: new Date() }, $unset: { unseen_by: '' } }
      );
      marked++;
    }
  }
  return marked;
}

module.exports = { ownerIdsFor, setSensitive, spreadSensitivity };
