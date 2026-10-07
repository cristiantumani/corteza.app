const crypto = require('crypto');
const { getDatabase } = require('../../config/database');
const { resolveOwners, ownersFromUserIds } = require('./owners');

/**
 * Action items ("pendientes"): commitments that come out of a meeting, with
 * owners, a due date and a status. Kept apart from decisions so they can be
 * filtered by owner / due date and followed up; each can point to the decision
 * it carries out (`decision_id`, the per-workspace decision number).
 *
 * Collection `action_items`:
 *   { item_id, workspace_id, space_id, space_name, text,
 *     owners: [{ name, user_id|null, email|null }], owner_ids: [user_id],
 *     due_date: 'YYYY-MM-DD'|null, status: 'open'|'done'|'cancelled',
 *     decision_id|null, topic_id|null, topic|null (its thread, see core/topics),
 *     source: { type, external_id, title, url, occurred_at },
 *     rationale, evidence_quote, capture: 'ai'|'manual', confidence,
 *     created_by: { user_id, name }, due_date_requested_at, completed_at, created_at, updated_at,
 *     owner_duplicates: [{ user_id, item_id, status }], unseen_by: [user_id], completed_earlier, embedding }
 *   (the last four: see colleague-assignments.js)
 */

const STATUSES = ['open', 'done', 'cancelled'];
/** Never sent to the browser: the embedding is large, owner_duplicates and unseen_by name colleagues' items and ids */
const LIST_PROJECTION = { _id: 0, embedding: 0, owner_duplicates: 0 };
const PUBLIC_PROJECTION = { ...LIST_PROJECTION, unseen_by: 0 };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function collection() {
  return getDatabase().collection('action_items');
}

function validDate(value) {
  return typeof value === 'string' && DATE_PATTERN.test(value) && !isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null;
}

/**
 * Creates an action item
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {string} params.spaceId
 * @param {string|null} [params.spaceName]
 * @param {string} params.text
 * @param {string[]} [params.ownerNames] - names as said in the meeting; matched to members
 * @param {string[]} [params.ownerUserIds] - members picked by hand (used instead of ownerNames when given)
 * @param {string|null} [params.dueDate] - 'YYYY-MM-DD'
 * @param {number|null} [params.decisionId]
 * @param {string|null} [params.topicId] - thread it belongs to (`top_<hex>`, see core/topics)
 * @param {string|null} [params.topic] - the thread's label
 * @param {Object|null} [params.source] - { type, external_id, title, url, occurred_at }
 * @param {string|null} [params.rationale]
 * @param {string|null} [params.evidenceQuote]
 * @param {'ai'|'manual'} [params.capture]
 * @param {number|null} [params.confidence]
 * @param {Object} [params.author] - { user_id, name }
 * @param {Object[]} [params.members] - workspace members (avoids reloading them per item)
 * @returns {Promise<Object>} the saved item
 */
async function createActionItem({
  workspaceId, spaceId, spaceName = null, text, ownerNames = [], ownerUserIds = null, dueDate = null, decisionId = null,
  source = null, rationale = null, evidenceQuote = null, capture = 'manual', confidence = null, author = null, members,
  topicId = null, topic = null
}) {
  if (!workspaceId || !spaceId) throw new Error('createActionItem requires workspaceId and spaceId');
  if (!text || !text.trim()) throw new Error('createActionItem requires text');

  const owners = Array.isArray(ownerUserIds)
    ? await ownersFromUserIds(workspaceId, ownerUserIds, members)
    : await resolveOwners(workspaceId, ownerNames, members);
  const now = new Date();
  const item = {
    item_id: `act_${crypto.randomBytes(10).toString('hex')}`,
    workspace_id: workspaceId,
    space_id: spaceId,
    space_name: spaceName,
    text: text.trim(),
    owners,
    owner_ids: owners.map(owner => owner.user_id).filter(Boolean),
    due_date: validDate(dueDate),
    status: 'open',
    decision_id: typeof decisionId === 'number' ? decisionId : null,
    topic_id: topicId || null,
    topic: topicId && topic ? String(topic).slice(0, 80) : null,
    source: source ? { ...source } : null,
    rationale: rationale || null,
    evidence_quote: evidenceQuote || null,
    capture,
    confidence: typeof confidence === 'number' ? confidence : null,
    created_by: author ? { user_id: author.user_id || null, name: author.name || null } : null,
    due_date_requested_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now
  };
  await collection().insertOne(item);
  return item;
}

/**
 * Lists action items of a workspace, most urgent first (overdue and soonest due, then undated, newest first)
 * @param {string} workspaceId
 * @param {Object} [filters]
 * @param {string[]} [filters.spaceIds] - spaces the viewer can access
 * @param {string} [filters.viewerId] - also include items this user owns, in any space
 *   (an action item from a colleague's private meeting still reaches its owner)
 * @param {string} [filters.ownerId] - only items owned by this user
 * @param {'open'|'done'|'cancelled'|'resolved'|'all'} [filters.status='open'] - resolved: done or cancelled, most recently finished first
 * @param {'overdue'|'today'|'none'|'week'} [filters.due]
 * @param {number} [filters.decisionId]
 * @param {Date} [filters.now]
 * @param {string} [filters.today] - 'YYYY-MM-DD' in the viewer's time zone (default: UTC date of `now`)
 * @returns {Promise<Object[]>} each with `new_from_colleague` (true when a colleague's meeting assigned it to the viewer and they haven't seen it)
 */
async function listActionItems(workspaceId, { spaceIds, viewerId, ownerId, status = 'open', due, decisionId, now = new Date(), today: localToday } = {}) {
  const query = { workspace_id: workspaceId, space_id: { $in: spaceIds || [] } };
  if (viewerId) {
    delete query.space_id;
    // An item that duplicates one the viewer already has (colleague-assignments) only shows through their own copy
    query.$or = [{ space_id: { $in: spaceIds || [] } }, { owner_ids: viewerId, 'owner_duplicates.user_id': { $ne: viewerId } }];
  }
  if (ownerId) query.owner_ids = ownerId;
  if (STATUSES.includes(status)) query.status = status;
  if (status === 'resolved') query.status = { $in: ['done', 'cancelled'] };
  if (typeof decisionId === 'number') query.decision_id = decisionId;

  const today = /^\d{4}-\d{2}-\d{2}$/.test(localToday || '') ? localToday : now.toISOString().slice(0, 10);
  const weekAhead = new Date(`${today}T12:00:00Z`);
  weekAhead.setUTCDate(weekAhead.getUTCDate() + 7);
  const inAWeek = weekAhead.toISOString().slice(0, 10);
  if (due === 'overdue') query.due_date = { $ne: null, $lt: today };
  if (due === 'today') query.due_date = today;
  if (due === 'none') query.due_date = null;
  if (due === 'week') query.due_date = { $ne: null, $gte: today, $lte: inAWeek };

  let items = await collection().find(query, { projection: LIST_PROJECTION }).sort({ created_at: -1 }).limit(500).toArray();
  if (viewerId) items = await withoutColleaguesCopies(workspaceId, viewerId, spaceIds || [], items);
  for (const item of items) {
    // A colleague's meeting assigned it to the viewer and they haven't opened Action items since
    item.new_from_colleague = Boolean(viewerId && Array.isArray(item.unseen_by) && item.unseen_by.includes(viewerId));
    delete item.unseen_by;
  }
  // Resolved: most recently finished first
  if (status === 'resolved') {
    const finished = item => new Date(item.completed_at || item.updated_at || item.created_at || 0).getTime();
    return items.sort((a, b) => finished(b) - finished(a));
  }
  return items.sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });
}

/**
 * When colleagues are in the same meeting, each captures it into their own space, so an
 * item the viewer owns can exist twice: in their own capture and in a colleague's. The
 * viewer keeps only their own copy (whatever its status) of meetings they captured.
 * @returns {Promise<Object[]>}
 */
async function withoutColleaguesCopies(workspaceId, viewerId, spaceIds, items) {
  const own = new Set(spaceIds);
  const meetingOf = item => (item.source && item.source.external_id) || null;
  const fromColleagues = items.filter(item => !own.has(item.space_id) && meetingOf(item));
  if (fromColleagues.length === 0) return items;

  const captured = new Set(await getDatabase().collection('ingestions').distinct('external_id', {
    workspace_id: workspaceId,
    user_id: viewerId,
    status: 'completed',
    external_id: { $in: [...new Set(fromColleagues.map(meetingOf))] }
  }));
  return items.filter(item => own.has(item.space_id) || !captured.has(meetingOf(item)));
}

/** One action item of a workspace, or null */
/**
 * New owners for an item: members picked by id, plus owners the item already had that matched
 * no member (a name only), kept when still listed
 * @param {Object} item - the stored item
 * @param {unknown} userIds - member user_ids
 * @param {unknown} keepNames - names of the item's unmatched owners to keep
 * @returns {Promise<{ name: string, user_id: string|null, email: string|null }[]>}
 */
async function ownersForUpdate(item, userIds, keepNames) {
  const ids = Array.isArray(userIds) ? userIds.filter(id => typeof id === 'string') : [];
  const names = Array.isArray(keepNames) ? keepNames.filter(name => typeof name === 'string') : [];
  const members = await ownersFromUserIds(item.workspace_id, ids);
  const unmatched = (item.owners || []).filter(owner => !owner.user_id && names.includes(owner.name))
    .map(owner => ({ name: owner.name, user_id: null, email: null }));
  return [...members, ...unmatched];
}

async function getActionItem(workspaceId, itemId) {
  return collection().findOne({ workspace_id: workspaceId, item_id: itemId }, { projection: PUBLIC_PROJECTION });
}

const MAX_TEXT = 1000;
const MAX_RATIONALE = 2000;

/**
 * Updates status, due date, text, why and/or owners
 * @param {string} workspaceId
 * @param {string} itemId
 * @param {Object} changes
 * @param {string} [changes.status]
 * @param {string|null} [changes.due_date] - 'YYYY-MM-DD', or null to clear
 * @param {unknown} [changes.text] - what has to be done (not empty)
 * @param {unknown} [changes.rationale] - why; '' or null clears it
 * @param {{ name: string, user_id: string|null, email: string|null }[]} [changes.owners] - already resolved (see ownersForUpdate)
 * @returns {Promise<Object|null|{ error: string }>} the updated item, null if not found
 */
async function updateActionItem(workspaceId, itemId, changes = {}) {
  const set = { updated_at: new Date() };
  /** @type {Record<string, ''>} */
  const unset = {};
  if (changes.text !== undefined) {
    const text = typeof changes.text === 'string' ? changes.text.trim() : '';
    if (!text) return { error: 'Write what needs to be done' };
    set.text = text.slice(0, MAX_TEXT);
    unset.embedding = ''; // recomputed from the new text when it's next needed
  }
  if (changes.rationale !== undefined) {
    if (changes.rationale !== null && typeof changes.rationale !== 'string') return { error: 'Invalid why' };
    const why = typeof changes.rationale === 'string' ? changes.rationale.trim() : '';
    set.rationale = why ? why.slice(0, MAX_RATIONALE) : null;
  }
  if (changes.owners !== undefined) {
    set.owners = changes.owners;
    set.owner_ids = changes.owners.map(owner => owner.user_id).filter(Boolean);
  }
  if (changes.status !== undefined) {
    if (!STATUSES.includes(changes.status)) return { error: 'Invalid status' };
    set.status = changes.status;
    set.completed_at = changes.status === 'done' ? new Date() : null;
  }
  if (changes.due_date !== undefined) {
    if (changes.due_date !== null && !validDate(changes.due_date)) return { error: 'Invalid due date (use YYYY-MM-DD)' };
    set.due_date = changes.due_date;
  }
  return collection().findOneAndUpdate(
    { workspace_id: workspaceId, item_id: itemId },
    Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set },
    { returnDocument: 'after', projection: PUBLIC_PROJECTION }
  );
}

module.exports = {
  createActionItem,
  listActionItems,
  getActionItem,
  updateActionItem,
  ownersForUpdate,
  STATUSES
};
