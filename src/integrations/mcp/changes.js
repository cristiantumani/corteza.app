const crypto = require('crypto');
const { getDatabase, getDecisionsCollection, getWorkspaceMembersCollection, getWorkspaceSpacesCollection } = require('../../config/database');
const { getUserAccessibleSpaces, isAdmin, canAccessSpace, canCreateInSpace } = require('../../services/permissions');
const { ensurePersonalSpace } = require('../../services/spaces');
const actions = require('../../core/actions/action-service');
const closeLoop = require('../../core/actions/close-loop');
const { reviewColleagueAssignments } = require('../../core/actions/colleague-assignments');
const decide = require('../../core/agent/decide');
const { setResolution, TYPES: QUESTION_TYPES } = require('../../core/decisions/questions-risks');
const { useAsAnswer } = require('../../core/topics/thread-edits');
const { checkAiBudget } = require('../../core/usage/ai-usage');
const { getEmailLanguage } = require('../../core/users/language');
const { translate } = require('../../core/i18n/i18n');
const { findMember, outcomeCard, actionCard } = require('./tools');

/**
 * Changes an AI assistant makes for the person (docs/specs/2026-10-mcp-v2-write.md). Never in one step:
 *
 *   preview(kind, args)  checks access, works out exactly what would change, stores it as a pending
 *                        change (10 minutes, bound to the grant) and returns it; writes nothing else
 *   apply(change_id)     checks access again and applies exactly what was previewed (record_decision and
 *                        closing an action item can pick which proposed items to close)
 *   undo(change_id)      puts things back, within 24 hours
 *
 * Each kind reuses the service the app uses for the same thing, with the same permission rule.
 * Changed items carry `changed_via` ({ kind: 'assistant', client_name, change_id, at }) so the app can
 * say "via Claude".
 *
 * Collection `mcp_changes`:
 *   { change_id, grant_id, client_name, workspace_id, user_id, kind, status: 'pending'|'applied'|'undone',
 *     payload_json, preview_json, undo_json (encrypted: they hold meeting content), target: { kind, id },
 *     created_at, expires_at, applied_at, undo_until, undone_at }
 */

const KINDS = ['record_decision', 'update_action_item', 'resolve_outcome', 'add_action_item'];
const PENDING_TTL_MS = 10 * 60 * 1000;
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PER_HOUR_PER_GRANT = 20;
const MAX_PER_DAY_PER_PERSON = 100;
const MAX_TEXT = 500;
const MAX_NOTE = 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {Object} WriteCaller
 * @property {string} workspaceId
 * @property {string} userId
 * @property {string} grantId
 * @property {string} clientName
 */

const changes = () => getDatabase().collection('mcp_changes');
const actionItems = () => getDatabase().collection('action_items');

/** @param {string} value @returns {boolean} */
function validDate(value) {
  return typeof value === 'string' && DATE.test(value) && !isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The person: name, admin, spaces and language, once per call */
async function personOf(caller) {
  const [member, admin, spaceIds, lang] = await Promise.all([
    getWorkspaceMembersCollection().findOne({ workspace_id: caller.workspaceId, user_id: caller.userId, removed_at: null }, { projection: { _id: 0, user_name: 1, email: 1 } }),
    isAdmin(null, caller.workspaceId, caller.userId),
    getUserAccessibleSpaces(null, caller.workspaceId, caller.userId),
    getEmailLanguage(caller.workspaceId, caller.userId)
  ]);
  return {
    user: { user_id: caller.userId, name: (member && (member.user_name || member.email)) || null },
    admin: Boolean(admin),
    spaceIds,
    t: (key, vars) => translate(lang, key, vars)
  };
}

/** The "via" mark written on what a change touches */
function viaMark(caller, changeId) {
  return { kind: 'assistant', client_name: caller.clientName, change_id: changeId, at: new Date() };
}

/** An action item the person can see (owner, or in one of their spaces), never a sensitive one */
async function visibleItem(caller, person, itemId) {
  if (typeof itemId !== 'string' || !/^act_[a-f0-9]{8,40}$/.test(itemId)) return null;
  const item = await actions.getActionItem(caller.workspaceId, itemId);
  if (!item || item.sensitive) return null;
  const isOwner = (item.owner_ids || []).includes(caller.userId);
  return isOwner || person.spaceIds.includes(item.space_id) ? item : null;
}

/** Owners, whoever added it, or an admin (as PATCH /api/action-items/:id) */
function mayUpdateItem(item, caller, person) {
  return person.admin || (item.owner_ids || []).includes(caller.userId) || (item.created_by && item.created_by.user_id) === caller.userId;
}

/** A question or risk the person can see, never a sensitive one */
async function visibleQuestion(caller, id) {
  const outcomeId = typeof id === 'number' ? id : Number(id);
  if (!Number.isInteger(outcomeId) || outcomeId <= 0) return null;
  const outcome = await getDecisionsCollection().findOne({ workspace_id: caller.workspaceId, id: outcomeId, type: { $in: QUESTION_TYPES } }, { projection: { embedding: 0 } });
  if (!outcome || outcome.sensitive) return null;
  return (await canAccessSpace(null, caller.workspaceId, outcome.space_id, caller.userId)) ? outcome : null;
}

const NOT_FOUND = { error: 'Not found. Use an id from a Corteza tool result.' };

// ---------------------------------------------------------------------------------------------
// Previews: what would change. Each returns { payload, preview, target } or { error }.
// ---------------------------------------------------------------------------------------------

async function previewRecordDecision(caller, person, args) {
  const text = typeof args.text === 'string' ? args.text.trim().slice(0, MAX_TEXT) : '';
  if (!text) return { error: 'Write the decision.' };
  const rationale = typeof args.rationale === 'string' && args.rationale.trim() ? args.rationale.trim().slice(0, MAX_NOTE) : null;
  const budget = await checkAiBudget(caller.workspaceId, caller.userId);
  if (!budget.ok) return { error: budget.message || 'Today’s AI limit was reached. Try again tomorrow, or record it in Corteza.' };
  const found = await decide.previewDecision({ workspaceId: caller.workspaceId, userId: caller.userId, spaceIds: person.spaceIds, admin: person.admin, text });
  const closable = found.items.filter(item => item.can_close);
  const proposals = closable.map(item => ({
    kind: item.kind, id: item.id, type: item.type, text: item.text, relation: item.relation, confidence: item.confidence,
    reason: item.reason, meeting: item.meeting, owners: item.owners, due_date: item.due_date
  }));
  return {
    payload: { text: found.decision || text, rationale, proposals },
    target: { kind: 'decision', id: null },
    preview: {
      action: 'Record a decision',
      decision: found.decision || text,
      why: rationale,
      reads_like_a_decision: found.is_decision,
      would_close: proposals.map(p => ({ id: p.id, type: p.type, text: p.text, relation: p.relation, confidence: p.confidence, reason: p.reason, meeting: p.meeting, closed_by_default: p.confidence === 'high' })),
      cannot_close: found.items.filter(item => !item.can_close).map(item => ({ id: item.id, type: item.type, text: item.text, why: 'Only its owners or an admin can close it' })),
      related_left_open: found.related.map(item => ({ id: item.id, type: item.type, text: item.text }))
    }
  };
}

async function previewUpdateActionItem(caller, person, args) {
  const item = await visibleItem(caller, person, args.item_id);
  if (!item) return NOT_FOUND;
  if (!mayUpdateItem(item, caller, person)) return { error: 'Only its owners, whoever added it, or an admin can change this action item.' };
  /** @type {{ status?: string, due_date?: string|null, text?: string }} */
  const change = {};
  if (args.status !== undefined && args.status !== item.status) {
    if (!['open', 'done', 'cancelled'].includes(args.status)) return { error: 'status is open, done or cancelled.' };
    change.status = args.status;
  }
  if (args.due_date !== undefined && args.due_date !== item.due_date) {
    if (args.due_date !== null && args.due_date !== '' && !validDate(args.due_date)) return { error: 'due_date is YYYY-MM-DD (or null to clear it).' };
    change.due_date = args.due_date || null;
  }
  if (typeof args.text === 'string' && args.text.trim() && args.text.trim() !== item.text) change.text = args.text.trim().slice(0, MAX_TEXT);
  if (!Object.keys(change).length) return { error: 'Nothing to change: it already is like that.' };

  const closing = item.status === 'open' && (change.status === 'done' || change.status === 'cancelled');
  const access = { spaceIds: person.spaceIds, userId: caller.userId };
  const mayResolve = closing && change.status === 'done' ? (await closeLoop.relatedOutcomes(caller.workspaceId, item, access)).outcomes : [];
  const orphaned = closing && change.status === 'cancelled' ? await closeLoop.orphanedBy(caller.workspaceId, item, access) : [];
  const fromTo = Object.fromEntries(Object.entries(change).map(([key, value]) => [key, { from: item[key] === undefined ? null : item[key], to: value }]));
  return {
    payload: { item_id: item.item_id, change, may_resolve: mayResolve.map(o => o.id) },
    target: { kind: 'action_item', id: item.item_id },
    preview: {
      action: 'Update an action item',
      action_item: actionCard(item),
      changes: fromTo,
      may_also_resolve: mayResolve.map(o => ({ id: o.id, type: o.type, text: o.text })),
      left_without_next_step: orphaned.map(o => ({ id: o.id, type: o.type, text: o.text })),
      ...(mayResolve.length ? { note: 'Ask the person whether it also resolves these. Pass the ones they confirm as close in apply_change; none are closed by default.' } : {})
    }
  };
}

async function previewResolveOutcome(caller, person, args) {
  const outcome = await visibleQuestion(caller, args.id);
  if (!outcome) return NOT_FOUND;
  const reopen = args.action === 'reopen';
  const resolved = outcome.resolution_status === 'resolved';
  if (reopen && !resolved) return { error: 'It is already open.' };
  if (!reopen && resolved) return { error: `It is already ${outcome.type === 'risk' ? 'mitigated' : 'answered'}.` };
  const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim().slice(0, MAX_NOTE) : null;
  let answeredBy = null;
  if (!reopen && args.answered_by !== undefined && args.answered_by !== null) {
    answeredBy = Number(args.answered_by);
    const decision = Number.isInteger(answeredBy) && outcome.topic_id ? await getDecisionsCollection().findOne(
      { workspace_id: caller.workspaceId, id: answeredBy, type: 'decision', topic_id: outcome.topic_id, space_id: { $in: person.spaceIds }, sensitive: { $ne: true } },
      { projection: { _id: 0, id: 1, text: 1 } }
    ) : null;
    if (!decision) return { error: 'answered_by must be a decision of the same thread (see get_thread).' };
  }
  const verb = reopen ? 'Reopen' : outcome.type === 'risk' ? 'Mark as mitigated' : 'Mark as answered';
  return {
    payload: { id: outcome.id, action: reopen ? 'reopen' : 'resolve', note, answered_by: answeredBy },
    target: { kind: 'decision', id: outcome.id },
    preview: { action: verb, outcome: outcomeCard(outcome), note, answered_by_decision: answeredBy }
  };
}

async function previewAddActionItem(caller, person, args) {
  const text = typeof args.text === 'string' ? args.text.trim().slice(0, MAX_TEXT) : '';
  if (!text) return { error: 'Write what needs to be done.' };
  if (args.due_date && !validDate(args.due_date)) return { error: 'due_date is YYYY-MM-DD.' };

  // Owner: me by default, else the member the name or email points to
  let owner = { user_id: caller.userId, name: person.user.name };
  let unmatched = null;
  const who = typeof args.owner === 'string' ? args.owner.trim() : '';
  if (who && !['me', 'mine', 'yo'].includes(who.toLowerCase())) {
    const member = await findMember(caller.workspaceId, who);
    if (member === 'ambiguous') return { error: `More than one person matches "${who}". Ask for their full name or email.` };
    if (member) owner = member;
    else { owner = null; unmatched = who; }
  }

  // Where it goes: the decision's space (and thread), else the person's personal space
  let decision = null;
  if (args.decision_id !== undefined && args.decision_id !== null) {
    const id = Number(args.decision_id);
    decision = Number.isInteger(id) ? await getDecisionsCollection().findOne(
      { workspace_id: caller.workspaceId, id, space_id: { $in: person.spaceIds }, sensitive: { $ne: true } },
      { projection: { _id: 0, id: 1, text: 1, space_id: 1, topic_id: 1, topic: 1 } }
    ) : null;
    if (!decision) return NOT_FOUND;
    if (!(await canCreateInSpace(null, caller.workspaceId, decision.space_id, caller.userId))) return { error: 'You can’t add action items there.' };
  }
  let topic = decision && decision.topic_id ? { topic_id: decision.topic_id, topic: decision.topic || null } : null;
  if (!decision && typeof args.topic_id === 'string' && /^top_[a-f0-9]{8,32}$/.test(args.topic_id)) {
    const inThread = await getDecisionsCollection().findOne(
      { workspace_id: caller.workspaceId, topic_id: args.topic_id, space_id: { $in: person.spaceIds }, sensitive: { $ne: true } },
      { projection: { _id: 0, topic_id: 1, topic: 1 } }
    );
    if (!inThread) return NOT_FOUND;
    topic = { topic_id: inThread.topic_id, topic: inThread.topic || null };
  }
  return {
    payload: { text, owner_user_id: owner ? owner.user_id : null, due_date: args.due_date || null, decision_id: decision ? decision.id : null, space_id: decision ? decision.space_id : null, topic },
    target: { kind: 'action_item', id: null },
    preview: {
      action: 'Add an action item',
      task: text,
      owner: owner ? owner.name : null,
      ...(unmatched ? { owner_note: `Nobody in this workspace matches "${unmatched}": it would stay unassigned. Ask the person who it is, or apply as is.` } : {}),
      due_date: args.due_date || null,
      for_decision: decision ? { id: decision.id, text: decision.text } : null,
      thread: topic ? topic.topic : null
    }
  };
}

const PREVIEWS = {
  record_decision: previewRecordDecision,
  update_action_item: previewUpdateActionItem,
  resolve_outcome: previewResolveOutcome,
  add_action_item: previewAddActionItem
};

/**
 * Works out a change and parks it for apply_change
 * @param {WriteCaller} caller
 * @param {string} kind
 * @param {Object} args
 * @returns {Promise<any>} { change_id, preview, expires_in } or { error }
 */
async function preview(caller, kind, args) {
  if (!KINDS.includes(kind)) return { error: 'Unknown change' };
  const person = await personOf(caller);
  const result = await PREVIEWS[kind](caller, person, args || {});
  if (result.error) return result;
  const changeId = `chg_${crypto.randomBytes(16).toString('hex')}`;
  const now = new Date();
  await changes().insertOne({
    change_id: changeId, grant_id: caller.grantId, client_name: caller.clientName, workspace_id: caller.workspaceId, user_id: caller.userId,
    kind, status: 'pending', payload_json: JSON.stringify(result.payload), preview_json: JSON.stringify(result.preview), undo_json: null,
    target: result.target, created_at: now, expires_at: new Date(now.getTime() + PENDING_TTL_MS), applied_at: null, undo_until: null, undone_at: null
  });
  return {
    change_id: changeId,
    preview: result.preview,
    expires_in: PENDING_TTL_MS / 1000,
    next: 'Show this to the person in your own words. Only if they confirm, call apply_change with this change_id.'
  };
}

// ---------------------------------------------------------------------------------------------
// Apply: exactly what was previewed, permissions checked again. Each returns { result, undo, target } or { error }.
// ---------------------------------------------------------------------------------------------

/** The `close` choice: ids among the proposals; default the high-confidence ones */
function chosenProposals(proposals, close) {
  if (!Array.isArray(close)) return proposals.filter(p => p.confidence === 'high');
  const wanted = new Set(close.map(String));
  return proposals.filter(p => wanted.has(String(p.id)));
}

async function applyRecordDecision(caller, person, payload, close, changeId) {
  const chosen = chosenProposals(payload.proposals || [], close);
  const recorded = await decide.recordDecision({
    workspaceId: caller.workspaceId, user: person.user, spaceIds: person.spaceIds, admin: person.admin,
    text: payload.text, rationale: payload.rationale, close: chosen.map(p => ({ kind: p.kind, id: p.id, relation: p.relation })), t: person.t
  });
  if (recorded.error) return { error: recorded.error };
  const decision = recorded.decision;
  await getDecisionsCollection().updateOne({ workspace_id: caller.workspaceId, id: decision.id }, { $set: { changed_via: viaMark(caller, changeId) } });
  return {
    target: { kind: 'decision', id: decision.id },
    undo: { decision_id: decision.id },
    result: { decision: outcomeCard(decision), closed: recorded.closed }
  };
}

async function applyUpdateActionItem(caller, person, payload, close, changeId) {
  const item = await visibleItem(caller, person, payload.item_id);
  if (!item) return NOT_FOUND;
  if (!mayUpdateItem(item, caller, person)) return { error: 'You can no longer change this action item.' };
  const before = { status: item.status, due_date: item.due_date || null, text: item.text, completed_at: item.completed_at || null };
  const updated = await actions.updateActionItem(caller.workspaceId, item.item_id, payload.change);
  if (!updated || updated.error) return { error: (updated && updated.error) || 'Couldn’t update it.' };
  await actionItems().updateOne({ workspace_id: caller.workspaceId, item_id: item.item_id }, { $set: { changed_via: viaMark(caller, changeId) } });

  // "Does this also resolve…?": only the ones the person confirmed, among the previewed
  const resolved = [];
  const wanted = new Set((Array.isArray(close) ? close : []).map(String));
  for (const id of (payload.may_resolve || []).filter(id => wanted.has(String(id)))) {
    const outcome = await visibleQuestion(caller, id);
    if (!outcome || outcome.resolution_status === 'resolved') continue;
    await setResolution(outcome, 'resolved', person.user, person.t('loop.resolvedByItem', { item: updated.text }));
    await getDecisionsCollection().updateOne({ workspace_id: caller.workspaceId, id: outcome.id }, { $set: { changed_via: viaMark(caller, changeId) } });
    resolved.push(outcome.id);
  }
  return { target: { kind: 'action_item', id: item.item_id }, undo: { item_id: item.item_id, before, resolved }, result: { action_item: actionCard(updated), resolved } };
}

async function applyResolveOutcome(caller, person, payload, _close, changeId) {
  const outcome = await visibleQuestion(caller, payload.id);
  if (!outcome) return NOT_FOUND;
  const before = {
    resolution_status: outcome.resolution_status || 'open', resolution_note: outcome.resolution_note || null,
    resolved_by: outcome.resolved_by || null, resolved_at: outcome.resolved_at || null, answered_by: outcome.answered_by || null
  };
  const fields = payload.action === 'reopen'
    ? await setResolution(outcome, 'open', person.user)
    : payload.answered_by !== null && payload.answered_by !== undefined
      ? await useAsAnswer({ question: outcome, decisionId: payload.answered_by, user: person.user, spaceIds: person.spaceIds, t: person.t })
      : await setResolution(outcome, 'resolved', person.user, payload.note);
  if ('error' in fields) return { error: /** @type {any} */ (fields).error };
  await getDecisionsCollection().updateOne({ workspace_id: caller.workspaceId, id: outcome.id }, { $set: { changed_via: viaMark(caller, changeId) } });
  return { target: { kind: 'decision', id: outcome.id }, undo: { id: outcome.id, before }, result: { outcome: outcomeCard({ ...outcome, ...fields }) } };
}

async function applyAddActionItem(caller, person, payload, _close, changeId) {
  let space;
  if (payload.space_id) {
    if (!(await canCreateInSpace(null, caller.workspaceId, payload.space_id, caller.userId))) return { error: 'You can no longer add action items there.' };
    space = await getWorkspaceSpacesCollection().findOne({ workspace_id: caller.workspaceId, space_id: payload.space_id }, { projection: { _id: 0, space_id: 1, name: 1 } });
    if (!space) return NOT_FOUND;
  } else {
    space = await ensurePersonalSpace(caller.workspaceId, caller.userId, person.user.name);
  }
  const item = await actions.createActionItem({
    workspaceId: caller.workspaceId, spaceId: space.space_id, spaceName: space.name || null, text: payload.text,
    ownerUserIds: payload.owner_user_id ? [payload.owner_user_id] : [], dueDate: payload.due_date, decisionId: payload.decision_id,
    topicId: payload.topic ? payload.topic.topic_id : null, topic: payload.topic ? payload.topic.topic : null,
    source: { type: 'assistant', title: caller.clientName }, capture: 'manual', author: person.user
  });
  await actionItems().updateOne({ workspace_id: caller.workspaceId, item_id: item.item_id }, { $set: { changed_via: viaMark(caller, changeId) } });
  // A colleague who owns it sees it as new, assigned by the person (as when added in the app)
  await reviewColleagueAssignments([item], { checkDuplicates: false });
  return { target: { kind: 'action_item', id: item.item_id }, undo: { item_id: item.item_id }, result: { action_item: actionCard(item) } };
}

const APPLIERS = {
  record_decision: applyRecordDecision,
  update_action_item: applyUpdateActionItem,
  resolve_outcome: applyResolveOutcome,
  add_action_item: applyAddActionItem
};

/**
 * Applies a pending change previewed by the same assistant
 * @param {WriteCaller} caller
 * @param {string} changeId
 * @param {{ close?: unknown[] }} [options]
 * @returns {Promise<any>}
 */
async function apply(caller, changeId, { close } = {}) {
  if (typeof changeId !== 'string' || !/^chg_[a-f0-9]{32}$/.test(changeId)) return { error: 'Unknown change_id. Preview the change first.' };
  const now = new Date();
  const [lastHour, today] = await Promise.all([
    changes().countDocuments({ grant_id: caller.grantId, applied_at: { $gt: new Date(now.getTime() - 60 * 60 * 1000) } }),
    changes().countDocuments({ workspace_id: caller.workspaceId, user_id: caller.userId, applied_at: { $gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } })
  ]);
  if (lastHour >= MAX_PER_HOUR_PER_GRANT || today >= MAX_PER_DAY_PER_PERSON) {
    return { error: 'Too many changes through assistants for now. Make this one in Corteza, or try again later.' };
  }
  // Single use: claimed atomically, only by the grant that previewed it, before it expires
  const row = await changes().findOneAndUpdate(
    { change_id: changeId, grant_id: caller.grantId, workspace_id: caller.workspaceId, user_id: caller.userId, status: 'pending', expires_at: { $gt: now } },
    { $set: { status: 'applying' } }
  );
  if (!row) return { error: 'This change expired or was already applied. Preview it again.' };
  try {
    const person = await personOf(caller);
    const done = await APPLIERS[row.kind](caller, person, JSON.parse(row.payload_json), close, changeId);
    if (done.error) {
      await changes().updateOne({ change_id: changeId }, { $set: { status: 'failed' } });
      return { error: done.error };
    }
    const undoUntil = new Date(Date.now() + UNDO_WINDOW_MS);
    await changes().updateOne({ change_id: changeId }, { $set: { status: 'applied', applied_at: new Date(), undo_until: undoUntil, undo_json: JSON.stringify(done.undo), target: done.target } });
    return { applied: true, change_id: changeId, ...done.result, undo_until: undoUntil.toISOString() };
  } catch (error) {
    await changes().updateOne({ change_id: changeId }, { $set: { status: 'failed' } });
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Undo: within 24 hours, by the person (from the assistant or from Settings)
// ---------------------------------------------------------------------------------------------

async function undoRecordDecision(caller, person, undo) {
  const result = await decide.undoDecision({ workspaceId: caller.workspaceId, user: person.user, spaceIds: person.spaceIds, id: undo.decision_id });
  return result.notFound ? { error: 'It was already deleted.' } : { reopened: result.reopened };
}

async function undoUpdateActionItem(caller, person, undo) {
  const { before } = undo;
  await actionItems().updateOne(
    { workspace_id: caller.workspaceId, item_id: undo.item_id },
    { $set: { status: before.status, due_date: before.due_date, text: before.text, completed_at: before.completed_at ? new Date(before.completed_at) : null, updated_at: new Date() }, $unset: { changed_via: '' } }
  );
  let reopened = 0;
  for (const id of undo.resolved || []) {
    const outcome = await visibleQuestion(caller, id);
    // Only if nobody changed it since
    if (outcome && outcome.resolution_status === 'resolved' && outcome.resolved_by && outcome.resolved_by.user_id === caller.userId) {
      await setResolution(outcome, 'open', person.user);
      reopened += 1;
    }
  }
  return { reopened };
}

async function undoResolveOutcome(caller, _person, undo) {
  const { before } = undo;
  await getDecisionsCollection().updateOne(
    { workspace_id: caller.workspaceId, id: undo.id },
    { $set: { ...before, resolved_at: before.resolved_at ? new Date(before.resolved_at) : null }, $unset: { changed_via: '' } }
  );
  return {};
}

async function undoAddActionItem(caller, _person, undo) {
  const result = await actionItems().deleteOne({ workspace_id: caller.workspaceId, item_id: undo.item_id });
  return result.deletedCount ? {} : { error: 'It was already deleted.' };
}

const UNDOERS = {
  record_decision: undoRecordDecision,
  update_action_item: undoUpdateActionItem,
  resolve_outcome: undoResolveOutcome,
  add_action_item: undoAddActionItem
};

/**
 * Undoes an applied change of the person's, within 24 hours
 * @param {{ workspaceId: string, userId: string }} caller
 * @param {string} changeId
 * @returns {Promise<any>}
 */
async function undo(caller, changeId) {
  if (typeof changeId !== 'string' || !/^chg_[a-f0-9]{32}$/.test(changeId)) return { error: 'Unknown change_id.' };
  const row = await changes().findOneAndUpdate(
    { change_id: changeId, workspace_id: caller.workspaceId, user_id: caller.userId, status: 'applied', undo_until: { $gt: new Date() } },
    { $set: { status: 'undoing' } }
  );
  if (!row) return { error: 'It can’t be undone any more (more than 24 hours, or already undone). Change it in Corteza.' };
  try {
    const person = await personOf(/** @type {any} */ (caller));
    const done = await UNDOERS[row.kind](caller, person, JSON.parse(row.undo_json || '{}'));
    await changes().updateOne({ change_id: changeId }, { $set: { status: 'undone', undone_at: new Date() } });
    return { undone: true, change_id: changeId, ...done };
  } catch (error) {
    await changes().updateOne({ change_id: changeId }, { $set: { status: 'applied' } });
    throw error;
  }
}

/**
 * A person's recent changes through assistants (Settings → AI assistants)
 * @param {string} workspaceId
 * @param {string} userId
 * @param {number} [limit]
 * @returns {Promise<Array<{ change_id: string, kind: string, client_name: string, summary: string, applied_at: Date, status: string, can_undo: boolean }>>}
 */
async function recentChanges(workspaceId, userId, limit = 20) {
  const rows = await changes().find(
    { workspace_id: workspaceId, user_id: userId, status: { $in: ['applied', 'undone'] } },
    { projection: { _id: 0, change_id: 1, kind: 1, client_name: 1, preview_json: 1, applied_at: 1, undo_until: 1, status: 1 } }
  ).sort({ applied_at: -1 }).limit(limit).toArray();
  const now = new Date();
  return rows.map(row => {
    const shown = JSON.parse(row.preview_json || '{}');
    const summary = shown.decision || shown.task || (shown.action_item && shown.action_item.task) || (shown.outcome && shown.outcome.headline) || '';
    return {
      change_id: row.change_id, kind: row.kind, client_name: row.client_name, summary: String(summary).slice(0, 200),
      applied_at: row.applied_at, status: row.status, can_undo: row.status === 'applied' && row.undo_until > now
    };
  });
}

module.exports = { preview, apply, undo, recentChanges, KINDS, PENDING_TTL_MS, UNDO_WINDOW_MS, MAX_PER_HOUR_PER_GRANT, MAX_PER_DAY_PER_PERSON };
