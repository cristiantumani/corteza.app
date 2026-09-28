const crypto = require('crypto');
const { getDatabase } = require('../../config/database');
const { resolveOwners } = require('./owners');

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
 *     decision_id|null, source: { type, external_id, title, url, occurred_at },
 *     rationale, evidence_quote, capture: 'ai'|'manual', confidence,
 *     created_by: { user_id, name }, due_date_requested_at, completed_at, created_at, updated_at }
 */

const STATUSES = ['open', 'done', 'cancelled'];
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
 * @param {string|null} [params.dueDate] - 'YYYY-MM-DD'
 * @param {number|null} [params.decisionId]
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
  workspaceId, spaceId, spaceName = null, text, ownerNames = [], dueDate = null, decisionId = null,
  source = null, rationale = null, evidenceQuote = null, capture = 'manual', confidence = null, author = null, members
}) {
  if (!workspaceId || !spaceId) throw new Error('createActionItem requires workspaceId and spaceId');
  if (!text || !text.trim()) throw new Error('createActionItem requires text');

  const owners = await resolveOwners(workspaceId, ownerNames, members);
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
 * @param {Object} filters
 * @param {string[]} filters.spaceIds - spaces the viewer can access
 * @param {string} [filters.ownerId] - only items owned by this user
 * @param {'open'|'done'|'cancelled'|'all'} [filters.status='open']
 * @param {'overdue'|'none'|'week'} [filters.due]
 * @param {number} [filters.decisionId]
 * @param {Date} [filters.now]
 * @returns {Promise<Object[]>}
 */
async function listActionItems(workspaceId, { spaceIds, ownerId, status = 'open', due, decisionId, now = new Date() } = {}) {
  const query = { workspace_id: workspaceId, space_id: { $in: spaceIds || [] } };
  if (ownerId) query.owner_ids = ownerId;
  if (STATUSES.includes(status)) query.status = status;
  if (typeof decisionId === 'number') query.decision_id = decisionId;

  const today = now.toISOString().slice(0, 10);
  const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (due === 'overdue') query.due_date = { $ne: null, $lt: today };
  if (due === 'none') query.due_date = null;
  if (due === 'week') query.due_date = { $ne: null, $gte: today, $lte: inAWeek };

  const items = await collection().find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(500).toArray();
  return items.sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });
}

/** One action item of a workspace, or null */
async function getActionItem(workspaceId, itemId) {
  return collection().findOne({ workspace_id: workspaceId, item_id: itemId }, { projection: { _id: 0 } });
}

/**
 * Updates status and/or due date
 * @param {string} workspaceId
 * @param {string} itemId
 * @param {Object} changes - { status?, due_date? ('YYYY-MM-DD' or null to clear) }
 * @returns {Promise<Object|null|{ error: string }>} the updated item, null if not found
 */
async function updateActionItem(workspaceId, itemId, changes = {}) {
  const set = { updated_at: new Date() };
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
    { $set: set },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
}

/** Marks items as having had their due date requested (so owners are asked once) */
async function markDueDateRequested(itemIds) {
  if (itemIds.length === 0) return;
  await collection().updateMany({ item_id: { $in: itemIds } }, { $set: { due_date_requested_at: new Date() } });
}

module.exports = {
  createActionItem,
  listActionItems,
  getActionItem,
  updateActionItem,
  markDueDateRequested,
  STATUSES
};
