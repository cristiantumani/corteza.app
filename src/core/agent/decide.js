const { getDecisionsCollection, getDatabase } = require('../../config/database');
const crossMeeting = require('../links/cross-meeting');
const { closeLinks, reopenLinks } = require('../links/close-links');
const { createDecision } = require('../decisions/decision-service');
const { ensurePersonalSpace } = require('../../services/spaces');

/**
 * Decide and close (docs/specs/2026-10-decide-and-close.md): the person types a decision ("we're not
 * going for ISO 27001 for now"); Corteza finds the open questions, risks and action items about the
 * same subject, proposes what to close, and on confirmation records the decision and closes them.
 * Nothing is written by the preview.
 */

const WINDOW_DAYS = 365;
const MAX_TEXT = 500;
const MAX_RATIONALE = 1000;
/** What a decision can do to an open item, by the item's type */
const ALLOWED = { open_question: ['answers', 'drops'], risk: ['mitigates', 'drops'], action_item: ['completes', 'drops'] };

/** Whether typed text reads like a decision (shared with the browser: public/scripts/decide-words.js) */
const { looksLikeDecision } = require('../../../public/scripts/decide-words');

/**
 * The prompt: is it a decision, its clean wording, and what it settles among the candidates
 * @param {string} statement
 * @param {Object[]} candidates - with `label`
 * @returns {string}
 */
function buildPrompt(statement, candidates) {
  return `A person typed this into their team's decision log:

"${statement}"

First, is it a DECISION the team has made (or a commitment not to do something), as opposed to a question or a search? Then write it as one clear decision sentence in the same language as the statement (keep their meaning and specifics; don't add facts).

Below are OPEN items from the team's earlier meetings (E…). For each one about the SAME specific subject (the same project, certification, hire, deal, problem or task — not merely the same broad area), say what the decision does to it:
- "answers": settles an Open question (the answer may be "no").
- "mitigates": handles a Risk (the risk is addressed).
- "completes": an Action item is done because of it.
- "drops": the item no longer applies because of the decision (a question or risk that stops mattering, an action item that won't be done anymore and is cancelled).
- "none": same subject, but the decision doesn't settle it (it stays open).

Rules:
- "answers" only for an Open question, "mitigates" only for a Risk, "completes" only for an Action item; "drops" for any of the three. An earlier Decision can only be "none".
- confidence: "high" when it is clearly about the same subject and clearly settled by the decision; otherwise "low".
- Leave out items about other subjects entirely.
- reason: one short sentence in the statement's language.

Open items:
${candidates.map(item => crossMeeting.describeItem(item.label, item)).join('\n')}

Reply with JSON only: {"is_decision": true|false, "decision": "...", "links": [{"earlier": "E1", "relation": "answers|mitigates|completes|drops|none", "confidence": "high|low", "reason": "..."}]}`;
}

/**
 * Reads Claude's reply; keeps known labels and relations that fit each item's type
 * @param {string} text
 * @param {Map<string, Object>} byLabel
 * @returns {{ isDecision: boolean, decision: string|null, links: { candidate: Object, relation: string, confidence: 'high'|'low', reason: string|null }[] }|null}
 */
function parseReply(text, byLabel) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  let data;
  try { data = JSON.parse(match[0]); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const seen = new Set();
  const links = (Array.isArray(data.links) ? data.links : []).flatMap(link => {
    const candidate = byLabel.get(String(link && link.earlier));
    if (!candidate || seen.has(candidate.label)) return [];
    seen.add(candidate.label);
    const allowed = ALLOWED[candidate.type] || [];
    const relation = allowed.includes(link.relation) ? link.relation : 'none';
    const reason = typeof link.reason === 'string' && link.reason.trim() ? link.reason.trim().slice(0, 300) : null;
    return [{ candidate, relation, confidence: link.confidence === 'high' && relation !== 'none' ? 'high' : 'low', reason }];
  });
  const decision = typeof data.decision === 'string' && data.decision.trim() ? data.decision.trim().slice(0, MAX_TEXT) : null;
  return { isDecision: data.is_decision !== false, decision, links };
}

/** One Claude call, metered as feature "decide" */
async function judgeWithClaude(prompt, { workspaceId, userId }) {
  const { createClient, SAMPLING_MODELS } = require('../../services/claude');
  const { recordAiUsage } = require('../usage/ai-usage');
  const { trackAiGeneration } = require('../../integrations/posthog/client');
  const config = require('../../config/environment');
  const model = config.claude.model;
  /** @type {any} */
  const request = { model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] };
  if (SAMPLING_MODELS.test(model)) request.temperature = 0;
  else request.output_config = { effort: 'low' };
  const started = Date.now();
  const response = await createClient().messages.create(request);
  trackAiGeneration({ feature: 'decide', response, latencyMs: Date.now() - started });
  await recordAiUsage({ workspaceId, userId, feature: 'decide', response });
  return (response.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
}

/**
 * Whether the person may close an action item (as PATCH /api/action-items/:id allows)
 * @param {{ owner_ids?: string[], author_id?: string|null }} item
 * @param {string} userId
 * @param {boolean} admin
 */
function canCloseItem(item, userId, admin) {
  return admin || (item.owner_ids || []).includes(userId) || item.author_id === userId;
}

/**
 * @typedef {Object} Proposal
 * @property {'decision'|'action_item'} kind
 * @property {number|string} id
 * @property {string} type
 * @property {string} text
 * @property {string|null} meeting
 * @property {string|null} date
 * @property {string[]} owners
 * @property {string|null} due_date
 * @property {string} relation
 * @property {'high'|'low'} confidence
 * @property {string|null} reason
 * @property {boolean} can_close
 */

/** @returns {Proposal} */
function toProposal(link, userId, admin) {
  const c = link.candidate;
  return {
    kind: c.kind, id: c.id, type: c.type, text: c.text, meeting: c.meeting || null,
    date: c.date ? new Date(c.date).toISOString() : null, owners: c.owners || [], due_date: c.due_date || null,
    relation: link.relation, confidence: link.confidence, reason: link.reason,
    can_close: c.kind === 'decision' ? true : canCloseItem(c, userId, admin)
  };
}

/**
 * What a typed decision would close (writes nothing)
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {string} params.userId
 * @param {string[]} params.spaceIds - spaces the person can access
 * @param {boolean} params.admin
 * @param {string} params.text
 * @param {Object} [deps]
 * @param {((text: string) => Promise<number[]>)|null} [deps.embed]
 * @param {(prompt: string) => Promise<string>} [deps.judge]
 * @returns {Promise<{ is_decision: boolean, decision: string, items: Proposal[], related: Proposal[] }>}
 */
async function previewDecision({ workspaceId, userId, spaceIds, admin, text }, deps = {}) {
  const statement = String(text || '').trim().slice(0, MAX_TEXT);
  const asTyped = { is_decision: true, decision: statement, items: [], related: [] };
  const embed = deps.embed !== undefined ? deps.embed : crossMeeting.defaultEmbedder();
  if (!embed || !spaceIds.length) return asTyped;

  const earlier = await crossMeeting.loadEarlierItems({ workspaceId, spaceIds, ownerId: userId, meetingId: null, before: new Date(), windowDays: WINDOW_DAYS });
  if (!earlier.length) return asTyped;
  let embedding = null;
  try { embedding = await embed(statement); } catch (error) { console.warn('⚠️  Embedding failed for a typed decision:', error.message); }
  if (!embedding) return asTyped;
  const candidates = await crossMeeting.selectCandidates([{ text: statement, embedding }], earlier, embed);
  if (!candidates.length) return asTyped;
  candidates.forEach((candidate, i) => { candidate.label = `E${i + 1}`; });

  const judge = deps.judge || (prompt => judgeWithClaude(prompt, { workspaceId, userId }));
  const parsed = parseReply(await judge(buildPrompt(statement, candidates)), new Map(candidates.map(c => [c.label, c])));
  if (!parsed) return asTyped;
  const proposals = parsed.links.map(link => toProposal(link, userId, admin));
  const order = p => (p.confidence === 'high' ? 0 : 1);
  return {
    is_decision: parsed.isDecision,
    decision: parsed.decision || statement,
    items: proposals.filter(p => p.relation !== 'none').sort((a, b) => order(a) - order(b)),
    related: proposals.filter(p => p.relation === 'none' && p.type !== 'decision')
  };
}

/**
 * Records the decision and closes the chosen items
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {{ user_id: string, name?: string|null }} params.user
 * @param {string[]} params.spaceIds
 * @param {boolean} params.admin
 * @param {unknown} params.text
 * @param {unknown} [params.rationale]
 * @param {unknown} [params.close] - [{ kind, id, relation }]
 * @param {(key: string, vars?: Object) => string} params.t - in the person's language, for the notes
 * @returns {Promise<{ error?: string, decision?: Object, closed?: { kind: string, id: number|string }[] }>}
 */
async function recordDecision({ workspaceId, user, spaceIds, admin, text, rationale, close, t }) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'Write the decision' };
  const why = typeof rationale === 'string' && rationale.trim() ? rationale.trim().slice(0, MAX_RATIONALE) : null;

  // The chosen items, checked again: visible, open, a relation that fits, and closable by this person
  const wanted = (Array.isArray(close) ? close : []).filter(c => c && typeof c === 'object' && ['decision', 'action_item'].includes(c.kind));
  const outcomeIds = wanted.filter(c => c.kind === 'decision' && Number.isInteger(c.id)).map(c => c.id);
  const itemIds = wanted.filter(c => c.kind === 'action_item' && typeof c.id === 'string').map(c => c.id);
  const [outcomes, items] = await Promise.all([
    outcomeIds.length ? getDecisionsCollection().find(
      { workspace_id: workspaceId, id: { $in: outcomeIds }, space_id: { $in: spaceIds }, type: { $in: ['open_question', 'risk'] }, resolution_status: { $ne: 'resolved' } },
      { projection: { _id: 0, id: 1, type: 1, topic_id: 1, topic: 1 } }
    ).toArray() : [],
    itemIds.length ? getDatabase().collection('action_items').find(
      { workspace_id: workspaceId, item_id: { $in: itemIds }, status: 'open', $or: [{ space_id: { $in: spaceIds } }, { owner_ids: user.user_id }] },
      { projection: { _id: 0, item_id: 1, owner_ids: 1, created_by: 1, topic_id: 1, topic: 1 } }
    ).toArray() : []
  ]);
  const found = new Map([
    ...outcomes.map(o => [`decision:${o.id}`, { kind: 'decision', id: o.id, type: o.type, topic_id: o.topic_id || null, topic: o.topic || null }]),
    ...items.filter(i => canCloseItem({ owner_ids: i.owner_ids, author_id: i.created_by && i.created_by.user_id }, user.user_id, admin))
      .map(i => [`action_item:${i.item_id}`, { kind: 'action_item', id: i.item_id, type: 'action_item', topic_id: i.topic_id || null, topic: i.topic || null }])
  ]);
  const chosen = wanted.flatMap(c => {
    const target = found.get(`${c.kind}:${c.id}`);
    if (!target || !(ALLOWED[target.type] || []).includes(c.relation)) return [];
    found.delete(`${c.kind}:${c.id}`); // once
    return [{ ...target, relation: c.relation }];
  });

  const personal = await ensurePersonalSpace(workspaceId, user.user_id, user.name || null);
  const decision = await createDecision({
    workspaceId, spaceId: personal.space_id, spaceName: personal.name || null, text: text.trim().slice(0, MAX_TEXT),
    type: 'decision', author: { user_id: user.user_id, name: user.name || null }, source: { type: 'dashboard', via: 'decide' },
    capture: 'manual', rationale: why
  });

  // Threads: the decision joins what it closes (and sensitive threads stay sensitive), then they close
  const newItem = { kind: 'decision', id: decision.id, type: 'decision', topic_id: null, topic: null };
  const links = chosen.map(item => ({ newItem, earlier: item, relation: item.relation, reason: null }));
  if (links.length) {
    await crossMeeting.applyLinks(workspaceId, links);
  }
  const stored = await getDecisionsCollection().findOne({ workspace_id: workspaceId, id: decision.id });
  const closed = links.length
    ? await closeLinks(stored, chosen.map(c => ({ kind: c.kind, id: c.id })), user, { spaceIds: [...spaceIds, personal.space_id], userId: user.user_id }, t)
    : [];
  return { decision: { ...stored, embedding: undefined, resolves: undefined }, closed };
}

/**
 * Undo: reopens what a recorded decision closed and deletes it
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {{ user_id: string, name?: string|null }} params.user
 * @param {string[]} params.spaceIds
 * @param {number} params.id
 * @returns {Promise<{ notFound?: boolean, reopened?: number }>}
 */
async function undoDecision({ workspaceId, user, spaceIds, id }) {
  const decision = await getDecisionsCollection().findOne({ workspace_id: workspaceId, id, user_id: user.user_id, 'source_details.via': 'decide' });
  if (!decision) return { notFound: true };
  const closed = (decision.resolves || []).filter(r => r.status === 'closed').map(r => ({ kind: r.kind, id: r.id }));
  const reopened = closed.length ? await reopenLinks(decision, closed, user, { spaceIds: [...spaceIds, decision.space_id], userId: user.user_id }) : [];
  await getDecisionsCollection().deleteOne({ workspace_id: workspaceId, id });
  return { reopened: reopened.length };
}

module.exports = { looksLikeDecision, buildPrompt, parseReply, previewDecision, recordDecision, undoDecision, canCloseItem, ALLOWED };
