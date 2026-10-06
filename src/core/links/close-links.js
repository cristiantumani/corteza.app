const { getDecisionsCollection, getDatabase } = require('../../config/database');
const { setResolution } = require('../decisions/questions-risks');
const { updateActionItem } = require('../actions/action-service');

/**
 * Closing what a decision may resolve (its `resolves`, see cross-meeting.js): a question
 * answered, a risk mitigated, an action item done. Only when a person asks (Confirm on the
 * review card, or Close selected in the detail modal); undo reopens them.
 *
 * Every earlier item is checked against what the person can see: outcomes in their spaces,
 * action items in their spaces or owned by them. Anything else is skipped silently.
 */

/**
 * @typedef {Object} Access
 * @property {string[]} spaceIds - spaces the person can access
 * @property {string} userId
 */

function actions() {
  return getDatabase().collection('action_items');
}

/** The earlier items of `resolves` the viewer can see, keyed `${kind}:${id}` */
async function loadTargets(workspaceId, resolves, { spaceIds, userId }) {
  const decisionIds = resolves.filter(r => r.kind === 'decision').map(r => r.id).filter(Number.isInteger);
  const itemIds = resolves.filter(r => r.kind === 'action_item').map(r => r.id).filter(id => typeof id === 'string');
  const [outcomes, items] = await Promise.all([
    decisionIds.length ? getDecisionsCollection().find(
      { workspace_id: workspaceId, id: { $in: decisionIds }, space_id: { $in: spaceIds } },
      { projection: { _id: 0, id: 1, workspace_id: 1, type: 1, text: 1, source_details: 1, timestamp: 1, resolution_status: 1, owner_name: 1 } }
    ).toArray() : [],
    itemIds.length ? actions().find(
      { workspace_id: workspaceId, item_id: { $in: itemIds }, $or: [{ space_id: { $in: spaceIds } }, { owner_ids: userId }] },
      { projection: { _id: 0, item_id: 1, text: 1, source: 1, created_at: 1, status: 1, owners: 1, due_date: 1 } }
    ).toArray() : []
  ]);
  const targets = new Map();
  outcomes.forEach(o => targets.set(`decision:${o.id}`, o));
  items.forEach(i => targets.set(`action_item:${i.item_id}`, i));
  return targets;
}

/** Still open: a question or risk not resolved, an action item not done or cancelled */
function isOpen(kind, target) {
  return kind === 'decision' ? target.resolution_status !== 'resolved' : target.status === 'open';
}

/**
 * What these decisions may close, ready for the browser: only suggestions still open that
 * the viewer can see, with the earlier item's text, type, meeting, date and owners
 * @param {string} workspaceId
 * @param {Object[]} decisions - with `resolves`
 * @param {Access} access
 * @returns {Promise<Map<number, Object[]>>} decision id → [{ kind, id, relation, reason, type, text, meeting, date, owners, due_date }]
 */
async function describeLinks(workspaceId, decisions, access) {
  const withLinks = decisions.filter(d => Array.isArray(d.resolves) && d.resolves.some(r => r.status === 'suggested'));
  const result = new Map();
  if (withLinks.length === 0) return result;
  const targets = await loadTargets(workspaceId, withLinks.flatMap(d => d.resolves), access);
  for (const decision of withLinks) {
    const list = decision.resolves.filter(r => r.status === 'suggested').flatMap(r => {
      const target = targets.get(`${r.kind}:${r.id}`);
      if (!target || !isOpen(r.kind, target)) return [];
      return [r.kind === 'decision'
        ? { kind: r.kind, id: r.id, relation: r.relation, reason: r.reason || null, type: target.type, text: target.text, meeting: target.source_details?.title || null, date: target.timestamp || null, owners: target.owner_name ? [target.owner_name] : [], due_date: null }
        : { kind: r.kind, id: r.id, relation: r.relation, reason: r.reason || null, type: 'action_item', text: target.text, meeting: target.source?.title || null, date: target.source?.occurred_at || target.created_at || null, owners: (target.owners || []).map(o => o.name).filter(Boolean), due_date: target.due_date || null }];
    });
    if (list.length) result.set(decision.id, list);
  }
  return result;
}

/**
 * Closes the chosen suggestions of a decision
 * @param {Object} decision - the stored decision (the caller checked the person may change it)
 * @param {unknown} chosen - [{ kind, id }] from the request; only entries of decision.resolves count
 * @param {{ user_id: string, name?: string|null }} user
 * @param {Access} access
 * @param {(key: string, vars?: Object) => string} t - in the person's language, for the note
 * @returns {Promise<{ kind: string, id: number|string }[]>} what was closed
 */
async function closeLinks(decision, chosen, user, access, t) {
  const resolves = Array.isArray(decision.resolves) ? decision.resolves : [];
  const wanted = (Array.isArray(chosen) ? chosen : []).filter(c => c && typeof c === 'object')
    .map(c => `${c.kind}:${c.id}`);
  const picked = resolves.filter(r => r.status === 'suggested' && wanted.includes(`${r.kind}:${r.id}`));
  if (picked.length === 0) return [];

  const targets = await loadTargets(decision.workspace_id, picked, access);
  const meeting = decision.source_details && decision.source_details.title;
  const note = t('links.resolvedNote', { text: decision.text, meeting: meeting || t('links.manual'), date: String(decision.timestamp || '').slice(0, 10) });
  const closed = [];
  for (const entry of picked) {
    const target = targets.get(`${entry.kind}:${entry.id}`);
    if (!target || !isOpen(entry.kind, target)) continue;
    if (entry.kind === 'decision') {
      const result = await setResolution(target, 'resolved', user, note);
      if (result && 'error' in result) continue;
    } else {
      await updateActionItem(decision.workspace_id, entry.id, { status: 'done' });
    }
    closed.push({ kind: entry.kind, id: entry.id });
  }
  await markLinks(decision, closed, 'closed');
  return closed;
}

/**
 * Undo: reopens what closeLinks closed for this decision
 * @param {Object} decision
 * @param {unknown} items - [{ kind, id }]
 * @param {{ user_id: string, name?: string|null }} user
 * @param {Access} access
 * @returns {Promise<{ kind: string, id: number|string }[]>} what was reopened
 */
async function reopenLinks(decision, items, user, access) {
  const resolves = Array.isArray(decision.resolves) ? decision.resolves : [];
  const wanted = (Array.isArray(items) ? items : []).filter(c => c && typeof c === 'object').map(c => `${c.kind}:${c.id}`);
  const picked = resolves.filter(r => r.status === 'closed' && wanted.includes(`${r.kind}:${r.id}`));
  const targets = await loadTargets(decision.workspace_id, picked, access);
  const reopened = [];
  for (const entry of picked) {
    const target = targets.get(`${entry.kind}:${entry.id}`);
    if (!target) continue;
    if (entry.kind === 'decision') await setResolution(target, 'open', user);
    else await updateActionItem(decision.workspace_id, entry.id, { status: 'open' });
    reopened.push({ kind: entry.kind, id: entry.id });
  }
  await markLinks(decision, reopened, 'suggested');
  return reopened;
}

/** Sets the status of some entries of decision.resolves */
async function markLinks(decision, entries, status) {
  if (entries.length === 0) return;
  const keys = new Set(entries.map(e => `${e.kind}:${e.id}`));
  const resolves = decision.resolves.map(r => (keys.has(`${r.kind}:${r.id}`) ? { ...r, status } : r));
  await getDecisionsCollection().updateOne({ workspace_id: decision.workspace_id, id: decision.id }, { $set: { resolves } });
  decision.resolves = resolves;
}

module.exports = { describeLinks, closeLinks, reopenLinks };
