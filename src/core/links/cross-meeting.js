const { getDecisionsCollection, getDatabase } = require('../../config/database');
const { cosine } = require('../actions/colleague-assignments');
const { newTopicId } = require('../topics/topics');

/**
 * Cross-meeting links (docs/specs/2026-10-cross-meeting-links.md).
 *
 * When a meeting is captured, its new outcomes are compared with **open** items from earlier
 * meetings: open questions, open risks, open action items, plus earlier decisions for context.
 * Candidates come from embedding similarity; Claude judges each pair (same subject? does the
 * new outcome resolve the earlier one?). Then:
 *
 * - new items about the same subject join the earlier item's thread (`topic_id`), so the
 *   thread spans meetings;
 * - a new decision stores what it may close: `resolves: [{ kind, id, relation, reason }]`.
 *   Nothing is closed until a person confirms it (closeLinks).
 *
 * Only for workspaces in CROSS_MEETING_LINKS_DOMAINS (Google domains, comma-separated, or "all").
 */

const WINDOW_DAYS = 120;
const PER_ITEM = 15; // candidates per new item
const MAX_CANDIDATES = 40; // per meeting, sent to Claude
const MAX_POOL = 400; // earlier items read per meeting
const MAX_NEW_EMBEDDINGS = 40; // earlier action items saved without an embedding
const DEFAULT_SIMILARITY = 0.45; // loose: a pre-filter, Claude decides
const DAY_MS = 24 * 60 * 60 * 1000;

/** What a new decision can do to an earlier item, by the earlier item's type */
const RELATION_FOR = { open_question: 'answers', risk: 'mitigates', action_item: 'completes' };
const RELATIONS = Object.values(RELATION_FOR);

function similarityThreshold() {
  const value = parseFloat(process.env.CROSS_MEETING_SIMILARITY || '');
  return value > 0 && value < 1 ? value : DEFAULT_SIMILARITY;
}

/**
 * Whether cross-meeting links are on for this workspace
 * @param {{ google_domain?: string|null }|null} workspace
 * @param {string} [setting] - CROSS_MEETING_LINKS_DOMAINS
 * @returns {boolean}
 */
function linksEnabled(workspace, setting = process.env.CROSS_MEETING_LINKS_DOMAINS || '') {
  const domains = setting.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  if (domains.includes('all')) return true;
  const domain = workspace && typeof workspace.google_domain === 'string' ? workspace.google_domain.toLowerCase() : null;
  return Boolean(domain && domains.includes(domain));
}

/** Text embeddings, or null when embeddings are off */
function defaultEmbedder() {
  const embeddings = require('../../services/embeddings');
  if (!embeddings.isEmbeddingsEnabled()) return null;
  return text => embeddings.generateQueryEmbedding(text);
}

/** Earlier item as a candidate: same shape for outcomes and action items */
function asCandidate(row, kind) {
  return kind === 'decision'
    ? {
      kind, id: row.id, type: row.type, text: row.text, topic_id: row.topic_id || null, topic: row.topic || null,
      meeting: row.source_details && row.source_details.title, date: row.timestamp, owners: row.owner_name ? [row.owner_name] : [],
      embedding: row.embedding || null
    }
    : {
      kind, id: row.item_id, type: 'action_item', text: row.text, topic_id: row.topic_id || null, topic: row.topic || null,
      meeting: row.source && row.source.title, date: row.source && row.source.occurred_at ? row.source.occurred_at : row.created_at,
      owners: (row.owners || []).map(o => o.name).filter(Boolean), due_date: row.due_date || null, embedding: row.embedding || null
    };
}

/**
 * Open items from earlier meetings that the meeting's owner can see
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {string[]} params.spaceIds - spaces the owner can access
 * @param {string|null} params.ownerId - their action items in other spaces count too
 * @param {string|null} params.meetingId - this meeting's external id (its own items are excluded)
 * @param {Date} params.before - only items from before this meeting
 * @returns {Promise<Object[]>} candidates
 */
async function loadEarlierItems({ workspaceId, spaceIds, ownerId, meetingId, before }) {
  const since = new Date(before.getTime() - WINDOW_DAYS * DAY_MS);
  const [outcomes, actions] = await Promise.all([
    getDecisionsCollection().find({
      workspace_id: workspaceId,
      space_id: { $in: spaceIds },
      ...(meetingId ? { 'source_details.external_id': { $ne: meetingId } } : {}),
      timestamp: { $gte: since.toISOString(), $lt: before.toISOString() },
      $or: [{ type: { $in: ['open_question', 'risk'] }, resolution_status: { $ne: 'resolved' } }, { type: 'decision' }]
    }, { projection: { _id: 0, id: 1, type: 1, text: 1, topic_id: 1, topic: 1, source_details: 1, timestamp: 1, owner_name: 1, embedding: 1 } })
      .sort({ timestamp: -1 }).limit(MAX_POOL).toArray(),
    getDatabase().collection('action_items').find({
      workspace_id: workspaceId,
      status: 'open',
      ...(meetingId ? { 'source.external_id': { $ne: meetingId } } : {}),
      created_at: { $gte: since, $lt: before },
      $or: [{ space_id: { $in: spaceIds } }, ...(ownerId ? [{ owner_ids: ownerId, 'owner_duplicates.user_id': { $ne: ownerId } }] : [])]
    }, { projection: { _id: 0, item_id: 1, text: 1, topic_id: 1, topic: 1, source: 1, created_at: 1, owners: 1, due_date: 1, embedding: 1 } })
      .sort({ created_at: -1 }).limit(MAX_POOL).toArray()
  ]);
  return [...outcomes.map(row => asCandidate(row, 'decision')), ...actions.map(row => asCandidate(row, 'action_item'))];
}

/**
 * The earlier items most similar to the new ones (embedding pre-filter)
 * @param {Object[]} newItems - { key, text, embedding }
 * @param {Object[]} earlier - from loadEarlierItems
 * @param {(text: string) => Promise<number[]>} embed
 * @returns {Promise<Object[]>} at most MAX_CANDIDATES, most similar first
 */
async function selectCandidates(newItems, earlier, embed) {
  let computed = 0;
  for (const candidate of earlier) {
    if (candidate.embedding || computed >= MAX_NEW_EMBEDDINGS) continue;
    computed++;
    try {
      candidate.embedding = await embed(candidate.text);
      if (candidate.kind === 'action_item' && Array.isArray(candidate.embedding)) {
        await getDatabase().collection('action_items').updateOne({ item_id: candidate.id }, { $set: { embedding: candidate.embedding } });
      }
    } catch (error) {
      console.warn(`⚠️  Embedding failed for a ${candidate.kind}:`, error.message);
    }
  }

  const threshold = similarityThreshold();
  const best = new Map(); // candidate → best score
  for (const item of newItems) {
    if (!item.embedding) continue;
    earlier
      .map(candidate => ({ candidate, score: cosine(item.embedding, candidate.embedding) }))
      .filter(({ score }) => score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_ITEM)
      .forEach(({ candidate, score }) => best.set(candidate, Math.max(score, best.get(candidate) || 0)));
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDIDATES).map(([candidate]) => candidate);
}

const TYPE_NAMES = { decision: 'Decision', open_question: 'Open question', risk: 'Risk', action_item: 'Action item' };

/** One line per item for the prompt (no ids beyond the label) */
function describeItem(label, item) {
  const parts = [`${label} [${TYPE_NAMES[item.type] || item.type}]`];
  if (item.date) parts.push(String(item.date).slice(0, 10));
  if (item.meeting) parts.push(`meeting "${item.meeting}"`);
  if (item.owners && item.owners.length) parts.push(`owner: ${item.owners.join(', ')}`);
  return `${parts.join(' · ')}\n   ${item.text}`;
}

/**
 * The prompt that asks Claude which earlier items the new ones are about
 * @param {Object[]} newItems - { label, type, text, owners }
 * @param {Object[]} candidates - { label, type, text, date, meeting, owners }
 * @returns {string}
 */
function buildLinkPrompt(newItems, candidates) {
  return `A team's meetings are captured as outcomes: decisions, open questions, risks and action items. Below are the outcomes of the latest meeting (N…) and open items from earlier meetings (E…).

For each pair that is about the SAME specific subject (the same hire, deal, project, problem or task, not just the same area like "hiring" or "sales"), say whether the new outcome RESOLVES the earlier item:
- "answers": a new decision settles an earlier open question.
- "mitigates": a new decision removes or handles an earlier risk.
- "completes": a new decision shows an earlier action item is done or no longer needed (e.g. "We hired Ana" completes "Interview the shortlisted candidates").
- "none": same subject, but it doesn't settle it (progress, a new detail, a follow-up).

Rules:
- Precision matters more than recall: a wrong link closes someone's work by mistake. When unsure, leave the pair out.
- Only new items of type Decision can resolve anything; for other new items use "none".
- "answers" only for an Open question, "mitigates" only for a Risk, "completes" only for an Action item.
- An earlier Decision can only be "none" (same subject, for context).
- reason: one short sentence in the language of the outcomes, saying what settles it.

New outcomes (latest meeting):
${newItems.map(item => describeItem(item.label, item)).join('\n')}

Earlier items:
${candidates.map(item => describeItem(item.label, item)).join('\n')}

Reply with JSON only: {"links": [{"new": "N1", "earlier": "E3", "relation": "answers|mitigates|completes|none", "reason": "..."}]}. Use {"links": []} when nothing is about the same subject.`;
}

/**
 * Reads Claude's reply; keeps only valid labels and relations that fit the types
 * @param {string} text
 * @param {Map<string, Object>} newByLabel
 * @param {Map<string, Object>} earlierByLabel
 * @returns {{ newItem: Object, earlier: Object, relation: string, reason: string|null }[]}
 */
function parseLinks(text, newByLabel, earlierByLabel) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return [];
  let data;
  try { data = JSON.parse(match[0]); } catch { return []; }
  const seen = new Set();
  return (Array.isArray(data && data.links) ? data.links : []).flatMap(link => {
    const newItem = newByLabel.get(String(link && link.new));
    const earlier = earlierByLabel.get(String(link && link.earlier));
    if (!newItem || !earlier) return [];
    const key = `${newItem.label}:${earlier.label}`;
    if (seen.has(key)) return [];
    seen.add(key);
    let relation = RELATIONS.includes(link.relation) ? link.relation : 'none';
    // A resolution must fit both types; anything else is only "same subject"
    if (relation !== 'none' && (newItem.type !== 'decision' || RELATION_FOR[earlier.type] !== relation)) relation = 'none';
    const reason = typeof link.reason === 'string' && link.reason.trim() ? link.reason.trim().slice(0, 300) : null;
    return [{ newItem, earlier, relation, reason }];
  });
}

/** Claude's judgement for one meeting */
async function judgeWithClaude(prompt, { workspaceId, userId }) {
  const { createClient, SAMPLING_MODELS } = require('../../services/claude');
  const { recordAiUsage } = require('../usage/ai-usage');
  const { trackAiGeneration } = require('../../integrations/posthog/client');
  const config = require('../../config/environment');
  const model = config.claude.model;
  /** @type {any} */
  const request = { model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] };
  if (SAMPLING_MODELS.test(model)) request.temperature = 0;
  else request.output_config = { effort: 'low' };
  const started = Date.now();
  const response = await createClient().messages.create(request);
  trackAiGeneration({ feature: 'cross_meeting_links', response, latencyMs: Date.now() - started });
  await recordAiUsage({ workspaceId, userId: userId || null, feature: 'cross_meeting_links', response });
  return (response.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
}

/**
 * Links one meeting's new outcomes to open items from earlier meetings
 * @param {Object} params
 * @param {string} params.workspaceId
 * @param {string[]} params.spaceIds - spaces the meeting's owner can access
 * @param {string|null} [params.ownerId]
 * @param {string|null} [params.meetingId]
 * @param {Date|string|null} [params.occurredAt]
 * @param {Object[]} params.decisions - outcomes this meeting created (stored documents)
 * @param {Object[]} [params.actionItems] - action items it created
 * @param {Object} [deps]
 * @param {((text: string) => Promise<number[]>)|null} [deps.embed]
 * @param {(prompt: string) => Promise<string>} [deps.judge] - Claude (tests pass a stub)
 * @param {boolean} [deps.apply=true] - false: work out the links but write nothing (dry run)
 * @returns {Promise<{ candidates: number, links: Object[], resolves: number }>}
 */
async function linkAcrossMeetings({ workspaceId, spaceIds, ownerId = null, meetingId = null, occurredAt = null, decisions, actionItems = [] }, deps = {}) {
  const embed = deps.embed !== undefined ? deps.embed : defaultEmbedder();
  const empty = { candidates: 0, links: [], resolves: 0 };
  if (!embed || !Array.isArray(spaceIds) || spaceIds.length === 0) return empty;

  /** @type {any[]} */
  const newItems = [
    ...decisions.map((d, i) => ({ label: `N${i + 1}`, kind: 'decision', id: d.id, type: d.type, text: d.text, topic_id: d.topic_id || null, topic: d.topic || null, owners: d.owner_name ? [d.owner_name] : [] })),
    ...actionItems.map((a, i) => ({ label: `N${decisions.length + i + 1}`, kind: 'action_item', id: a.item_id, type: 'action_item', text: a.text, topic_id: a.topic_id || null, topic: a.topic || null, owners: (a.owners || []).map(o => o.name).filter(Boolean) }))
  ].filter(item => typeof item.text === 'string' && item.text.trim());
  if (newItems.length === 0) return empty;

  const before = occurredAt && !isNaN(new Date(occurredAt).getTime()) ? new Date(occurredAt) : new Date();
  const earlier = await loadEarlierItems({ workspaceId, spaceIds, ownerId, meetingId, before });
  if (earlier.length === 0) return empty;

  for (const item of newItems) {
    try { item.embedding = await embed(item.text); } catch (error) { console.warn('⚠️  Embedding failed for a new outcome:', error.message); }
  }
  const candidates = await selectCandidates(newItems, earlier, embed);
  if (candidates.length === 0) return empty;
  candidates.forEach((candidate, i) => { candidate.label = `E${i + 1}`; });

  const judge = deps.judge || (prompt => judgeWithClaude(prompt, { workspaceId, userId: ownerId }));
  const reply = await judge(buildLinkPrompt(newItems, candidates));
  const links = parseLinks(reply, new Map(newItems.map(i => [i.label, i])), new Map(candidates.map(c => [c.label, c])));
  if (deps.apply === false) return { candidates: candidates.length, links, resolves: links.filter(l => l.relation !== 'none').length };

  await applyLinks(workspaceId, links);
  return { candidates: candidates.length, links, resolves: links.filter(l => l.relation !== 'none').length };
}

/**
 * Writes the links: threads joined, and `resolves` on the new decisions
 * @param {string} workspaceId
 * @param {Object[]} links - from parseLinks
 */
async function applyLinks(workspaceId, links) {
  const decisions = getDecisionsCollection();
  const actions = getDatabase().collection('action_items');
  const update = (item, set) => item.kind === 'decision'
    ? decisions.updateOne({ workspace_id: workspaceId, id: item.id }, { $set: set })
    : actions.updateOne({ workspace_id: workspaceId, item_id: item.id }, { $set: set });

  // Threads: each new item joins the thread of an earlier item it's linked to (the first that has
  // one), bringing along the rest of its own meeting's thread; linked earlier items without a
  // thread join it too. Two existing threads are never merged.
  const linksByNew = new Map();
  for (const link of links) {
    const list = linksByNew.get(link.newItem) || [];
    list.push(link.earlier);
    linksByNew.set(link.newItem, list);
  }
  for (const [newItem, earlierItems] of linksByNew) {
    const threaded = earlierItems.find(item => item.topic_id);
    const topicId = (threaded && threaded.topic_id) || newItem.topic_id || newTopicId();
    const topic = (threaded && threaded.topic) || newItem.topic || null;
    for (const item of earlierItems) {
      if (item.topic_id) continue;
      await update(item, { topic_id: topicId, ...(topic ? { topic } : {}) });
      item.topic_id = topicId;
    }
    if (newItem.topic_id && newItem.topic_id !== topicId) {
      const from = { workspace_id: workspaceId, topic_id: newItem.topic_id };
      const set = { topic_id: topicId, ...(topic ? { topic } : {}) };
      await Promise.all([decisions.updateMany(from, { $set: set }), actions.updateMany(from, { $set: set })]);
    } else if (!newItem.topic_id) {
      await update(newItem, { topic_id: topicId, ...(topic ? { topic } : {}) });
    }
    newItem.topic_id = topicId;
  }

  // What each new decision may close
  const byDecision = new Map();
  for (const link of links) {
    if (link.relation === 'none') continue;
    const list = byDecision.get(link.newItem.id) || [];
    list.push({ kind: link.earlier.kind, id: link.earlier.id, relation: link.relation, reason: link.reason, status: 'suggested' });
    byDecision.set(link.newItem.id, list);
  }
  for (const [id, resolves] of byDecision) {
    await decisions.updateOne({ workspace_id: workspaceId, id }, { $set: { resolves } });
  }
}

module.exports = {
  linksEnabled,
  linkAcrossMeetings,
  loadEarlierItems,
  selectCandidates,
  buildLinkPrompt,
  parseLinks,
  applyLinks,
  RELATION_FOR,
  WINDOW_DAYS
};
