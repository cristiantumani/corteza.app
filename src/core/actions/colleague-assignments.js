const { getDatabase } = require('../../config/database');

/**
 * Action items a colleague's meeting assigns to someone else.
 *
 * A colleague captures a meeting (automatically or by importing it) and the AI names
 * another member as an owner. Before that member sees the item, two checks run:
 *
 * 1. Is it one they already have? Same meeting, same text, or (with OpenAI embeddings)
 *    the same meaning, among their own items from around that time: from a meeting within
 *    3 days of this one, or added by hand from 3 days before to 30 days after (a weekly
 *    meeting's recurring task is a new task each week). If so, the new copy
 *    is a duplicate for them: `owner_duplicates: [{ user_id, item_id, status }]` keeps it
 *    out of their list and their morning summary. When every owner already had it and
 *    finished it (done or cancelled), the new copy is saved as done too
 *    (`completed_earlier: true`), so the colleague doesn't chase finished work.
 * 2. Otherwise it's new for them: `unseen_by: [user_id]` until they open Action items,
 *    which shows "New from <colleague>'s meeting" and a count in the sidebar.
 *
 * Item embeddings (`embedding`, text-embedding-3-small) are stored on the action item the
 * first time they're needed and never sent to the browser.
 */

const DEFAULT_SIMILARITY = 0.86; // cosine; same task worded differently scores ~0.88-0.97, related tasks ~0.6-0.8
const WINDOW_DAYS = 60; // candidates: the owner's items created since 60 days before the meeting
const SAME_MEETING_DAYS = 3; // an item from another meeting is the same task only if that meeting was this close
const LATER_NOTE_DAYS = 30; // an item added by hand counts from 3 days before the meeting to 30 after
const MAX_CANDIDATES = 200;
const MAX_NEW_EMBEDDINGS = 40; // per owner per check, for older items saved without one
const DAY_MS = 24 * 60 * 60 * 1000;

function collection() {
  return getDatabase().collection('action_items');
}

/** Similarity above which two items are the same task (ACTION_DUPLICATE_SIMILARITY) */
function similarityThreshold() {
  const value = parseFloat(process.env.ACTION_DUPLICATE_SIMILARITY || '');
  return value > 0 && value < 1 ? value : DEFAULT_SIMILARITY;
}

/** Lowercase, no accents or punctuation, single spaces */
function normalizeText(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} cosine similarity, 0 when either is missing
 */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

/** Text embedding for action items, or null when embeddings are off or fail */
function defaultEmbedder() {
  const embeddings = require('../../services/embeddings');
  if (!embeddings.isEmbeddingsEnabled()) return null;
  return text => embeddings.generateQueryEmbedding(text);
}

/** The item's embedding, computed and stored when missing; null when unavailable */
async function embeddingOf(item, embed) {
  if (Array.isArray(item.embedding) && item.embedding.length) return item.embedding;
  if (!embed) return null;
  try {
    const embedding = await embed(item.text);
    if (Array.isArray(embedding) && embedding.length) {
      await collection().updateOne({ item_id: item.item_id }, { $set: { embedding } });
      item.embedding = embedding;
      return embedding;
    }
  } catch (error) {
    console.warn(`⚠️  Action item embedding failed for ${item.item_id}:`, error.message);
  }
  return null;
}

/**
 * The owner's existing item that is the same task as `item`, if any
 * @param {Object} item - the new action item (from a colleague's capture)
 * @param {string} ownerId
 * @param {Object} [deps]
 * @param {((text: string) => Promise<number[]>)|null} [deps.embed]
 * @returns {Promise<Object|null>} { item_id, status, completed_at } of the match
 */
async function findOwnerDuplicate(item, ownerId, { embed } = {}) {
  const occurred = item.source && item.source.occurred_at ? new Date(item.source.occurred_at) : new Date(item.created_at || Date.now());
  const candidates = await collection().find({
    workspace_id: item.workspace_id,
    owner_ids: ownerId,
    item_id: { $ne: item.item_id },
    'owner_duplicates.user_id': { $ne: ownerId }, // never match against a copy already hidden from them
    created_at: { $gte: new Date(occurred.getTime() - WINDOW_DAYS * DAY_MS) }
  }, { projection: { _id: 0, item_id: 1, text: 1, status: 1, completed_at: 1, source: 1, created_by: 1, created_at: 1, embedding: 1 } })
    .sort({ created_at: -1 }).limit(MAX_CANDIDATES).toArray();

  const author = item.created_by && item.created_by.user_id;
  const meeting = item.source && item.source.external_id;
  const others = candidates.filter(c => {
    const sameMeeting = meeting && c.source && c.source.external_id === meeting;
    // Other items from this same capture are siblings, not the same task
    if (sameMeeting) return !(c.created_by && c.created_by.user_id === author);
    // Recurring meetings repeat tasks every week: only items from around this meeting's date count
    const days = ((c.source && c.source.occurred_at ? new Date(c.source.occurred_at) : new Date(c.created_at)).getTime() - occurred.getTime()) / DAY_MS;
    return c.source && c.source.occurred_at
      ? Math.abs(days) <= SAME_MEETING_DAYS
      : days >= -SAME_MEETING_DAYS && days <= LATER_NOTE_DAYS;
  });
  if (others.length === 0) return null;

  const text = normalizeText(item.text);
  const exact = others.find(c => normalizeText(c.text) === text);
  if (exact) return exact;

  const target = await embeddingOf(item, embed);
  if (!target) return null;
  let best = null;
  let bestScore = 0;
  let computed = 0;
  for (const candidate of others) {
    if (!candidate.embedding) {
      if (computed >= MAX_NEW_EMBEDDINGS) continue;
      computed++;
    }
    const score = cosine(target, await embeddingOf(candidate, embed));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= similarityThreshold() ? best : null;
}

/**
 * Checks the action items one capture created for owners other than its author:
 * marks the ones they already have, and the rest as new for them
 * @param {Object[]} items - action items just created by one capture
 * @param {Object} [deps]
 * @param {((text: string) => Promise<number[]>)|null} [deps.embed] - default: OpenAI embeddings when configured
 * @param {boolean} [deps.checkDuplicates=true] - false for items a person assigned by hand (only flag them as new)
 * @returns {Promise<{ duplicates: number, completedEarlier: number, newForOwners: number }>}
 */
async function reviewColleagueAssignments(items, deps = {}) {
  const checkDuplicates = deps.checkDuplicates !== false;
  const embed = !checkDuplicates ? null : deps.embed !== undefined ? deps.embed : defaultEmbedder();
  const totals = { duplicates: 0, completedEarlier: 0, newForOwners: 0 };

  for (const item of items) {
    const author = item.created_by && item.created_by.user_id;
    const owners = (item.owner_ids || []).filter(id => id && id !== author);
    if (owners.length === 0) continue;

    const duplicates = [];
    const unseenBy = [];
    for (const ownerId of owners) {
      const match = checkDuplicates ? await findOwnerDuplicate(item, ownerId, { embed }) : null;
      if (match) duplicates.push({ user_id: ownerId, item_id: match.item_id, status: match.status, completed_at: match.completed_at || null });
      else unseenBy.push(ownerId);
    }

    const set = { owner_duplicates: duplicates.map(({ completed_at, ...rest }) => rest), unseen_by: unseenBy };
    // Every named member already had it and finished it: so is this copy
    const allOwners = (item.owner_ids || []).filter(Boolean);
    const finished = duplicates.length > 0 && duplicates.length === allOwners.length && duplicates.every(d => d.status === 'done' || d.status === 'cancelled');
    if (finished && item.status === 'open') {
      set.status = 'done';
      set.completed_at = duplicates.map(d => d.completed_at).filter(Boolean).sort().pop() || new Date();
      set.completed_earlier = true;
      totals.completedEarlier++;
    }
    await collection().updateOne({ item_id: item.item_id }, { $set: set });
    Object.assign(item, set);
    delete item.embedding; // stored, but callers send items to the browser
    totals.duplicates += duplicates.length;
    totals.newForOwners += unseenBy.length;
  }
  return totals;
}

/**
 * Action items colleagues' meetings assigned to a person that they haven't seen yet
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<{ count: number, from: { name: string, count: number }[] }>} from: by colleague, most first
 */
async function unseenFromColleagues(workspaceId, userId) {
  const rows = await collection().aggregate([
    { $match: { workspace_id: workspaceId, unseen_by: userId } },
    { $group: { _id: '$created_by.name', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  return {
    count: rows.reduce((sum, row) => sum + row.count, 0),
    from: rows.map(row => ({ name: row._id || 'A colleague', count: row.count }))
  };
}

/**
 * The person has seen the action items colleagues assigned them (they opened Action items)
 * @returns {Promise<number>} items marked seen
 */
async function markColleagueAssignmentsSeen(workspaceId, userId) {
  const result = await collection().updateMany({ workspace_id: workspaceId, unseen_by: userId }, { $pull: { unseen_by: userId } });
  return result.modifiedCount;
}

module.exports = {
  reviewColleagueAssignments,
  findOwnerDuplicate,
  unseenFromColleagues,
  markColleagueAssignmentsSeen,
  normalizeText,
  cosine,
  similarityThreshold
};
