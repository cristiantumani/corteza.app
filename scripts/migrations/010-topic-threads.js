/**
 * Migration 010: topic threads for outcomes saved before the extraction returned a topic
 * (docs/specs/2026-10-topic-threads.md).
 *
 * Within each capture of a meeting (same workspace, space and meeting), each open question
 * (or a risk no question is close to) leads a thread. Risks, decisions and action items join
 * the one question or risk their embedding is closest to, when cosine ≥ --threshold
 * (default 0.6), and a thread takes at most 4 decisions and action items: the closest ones.
 * Action items with no embedding get one (OpenAI, stored with --apply); one that still has
 * none follows the decision it carries out (`decision_id`).
 * Only threads with a question or a risk are created: those have a loop to close. A
 * thread's label is its question (or risk), shortened. The dry run shows each item's
 * similarity, to tune --threshold.
 * Items that already have a `topic_id` are left alone, so it's safe to run twice.
 *
 * It's a dry run unless --apply. The dry run lists proposed threads by id; --show-text adds
 * the first words of each item (meeting content: for your own terminal, don't paste it).
 *
 * Usage:
 *   node scripts/migrations/010-topic-threads.js                      # dry run
 *   node scripts/migrations/010-topic-threads.js --show-text          # dry run, with the first words
 *   node scripts/migrations/010-topic-threads.js --apply              # write topic_id / topic
 *   node scripts/migrations/010-topic-threads.js --apply --threshold 0.6 --days 60
 */
require('dotenv').config();
const { connectToMongoDB, closeMongoDB, getDatabase } = require('../../src/config/database');
const { cosine } = require('../../src/core/actions/colleague-assignments');
const { newTopicId, MAX_TOPIC } = require('../../src/core/topics/topics');

const OUTCOME_TYPES = ['open_question', 'risk', 'decision'];
const DEFAULT_THRESHOLD = 0.6;
/** Decisions and action items per thread, at most (the closest ones) */
const MAX_ATTACHED = 4;

/**
 * Groups one capture's items (pure). Each open question is the root of a thread; a risk
 * joins the question it's closest to, or roots its own thread. Every other item (decision,
 * action item) joins only the one question or risk it's closest to, and at most
 * MAX_ATTACHED per thread, so items never chain into one thread per meeting. An action item
 * without an embedding follows the decision it carries out (`decision_id`).
 * @param {{ key: string, kind: 'outcome'|'action', type: string, id?: number, decision_id?: number|null, text: string, embedding?: number[] }[]} items
 * @param {number} threshold - minimum cosine similarity to join a thread
 * @returns {Object[][]} groups of at least two items, each led by a question or risk; every
 *   joined item carries `similarity`
 */
function groupCapture(items, threshold) {
  const best = (item, candidates) => {
    let top = null;
    for (const candidate of candidates) {
      const similarity = item.embedding && candidate.embedding ? cosine(item.embedding, candidate.embedding) : 0;
      if (similarity >= threshold && (!top || similarity > top.similarity)) top = { root: candidate, similarity };
    }
    return top;
  };

  const questions = items.filter(item => item.type === 'open_question');
  const risks = items.filter(item => item.type === 'risk');
  const members = new Map(questions.map(question => [question, []]));
  const rootOf = new Map(questions.map(question => [question, question]));
  for (const risk of risks) {
    const match = best(risk, questions);
    if (match) {
      members.get(match.root).push({ item: risk, similarity: match.similarity });
      rootOf.set(risk, match.root);
    } else {
      members.set(risk, []);
      rootOf.set(risk, risk);
    }
  }

  // Decisions and action items join the closest question or risk, through it to its thread
  const anchors = [...questions, ...risks];
  const others = items.filter(item => item.type !== 'open_question' && item.type !== 'risk');
  const candidates = [];
  for (const item of others) {
    const match = best(item, anchors);
    if (match) candidates.push({ item, root: rootOf.get(match.root), similarity: match.similarity });
  }
  // Closest first, at most MAX_ATTACHED per thread
  candidates.sort((a, b) => b.similarity - a.similarity);
  const placed = new Map();
  for (const { item, root, similarity } of candidates) {
    const list = members.get(root);
    if (list.filter(entry => entry.item.type !== 'risk').length >= MAX_ATTACHED) continue;
    list.push({ item, similarity });
    placed.set(item, root);
  }
  // An action item with no embedding of its own follows its decision
  for (const item of others) {
    if (item.kind !== 'action' || item.embedding || typeof item.decision_id !== 'number') continue;
    const decision = others.find(other => other.kind === 'outcome' && other.id === item.decision_id);
    const root = decision && placed.get(decision);
    if (root) members.get(root).push({ item, similarity: null });
  }

  const order = new Map(items.map((item, index) => [item.key, index]));
  return [...members.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([root, list]) => [{ ...root, similarity: null }, ...list.map(({ item, similarity }) => ({ ...item, similarity }))]
      .sort((a, b) => order.get(a.key) - order.get(b.key)));
}

/** The thread's label: its question, else its risk, shortened */
function labelFor(group) {
  const anchor = group.find(item => item.type === 'open_question') || group.find(item => item.type === 'risk');
  const text = String(anchor.text || '').trim();
  return text.length > MAX_TOPIC ? `${text.slice(0, MAX_TOPIC - 1).trimEnd()}…` : text;
}

/**
 * Items without a thread from recent captures, by capture
 * @param {import('mongodb').Db} db
 * @param {number} days
 * @returns {Promise<Map<string, Object[]>>} `${workspace_id}|${space_id}|${meeting}` → items
 */
async function loadCaptures(db, days) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const noThread = { $in: [null, ''] };
  const [outcomes, actions] = await Promise.all([
    db.collection('decisions').find(
      { type: { $in: OUTCOME_TYPES }, topic_id: noThread, 'source_details.external_id': { $type: 'string' }, created_at: { $gte: since } },
      { projection: { _id: 0, workspace_id: 1, space_id: 1, id: 1, type: 1, text: 1, embedding: 1, 'source_details.external_id': 1 } }
    ).toArray(),
    db.collection('action_items').find(
      { topic_id: noThread, 'source.external_id': { $type: 'string' }, created_at: { $gte: since } },
      { projection: { _id: 0, workspace_id: 1, space_id: 1, item_id: 1, text: 1, embedding: 1, decision_id: 1, 'source.external_id': 1 } }
    ).toArray()
  ]);
  const captures = new Map();
  const add = (key, item) => {
    if (!captures.has(key)) captures.set(key, []);
    captures.get(key).push(item);
  };
  for (const o of outcomes) {
    add(`${o.workspace_id}|${o.space_id}|${o.source_details.external_id}`, { key: `#${o.id}`, kind: 'outcome', type: o.type, id: o.id, workspace_id: o.workspace_id, text: o.text, embedding: o.embedding });
  }
  for (const a of actions) {
    add(`${a.workspace_id}|${a.space_id}|${a.source.external_id}`, { key: a.item_id, kind: 'action', type: 'action_item', item_id: a.item_id, decision_id: a.decision_id, workspace_id: a.workspace_id, text: a.text, embedding: a.embedding });
  }
  return captures;
}

/**
 * Embeddings for action items that have none (only items a colleague's meeting assigned got
 * one, see core/actions/colleague-assignments). Same model as the rest; with --apply they're
 * stored on the item, as colleague-assignments does. Costs a fraction of a cent per hundred.
 * @param {Map<string, Object[]>} captures
 * @param {((text: string) => Promise<number[]>)|null} embed
 * @param {{ db?: import('mongodb').Db|null }} [options] - stores them when given
 * @returns {Promise<number>} how many were computed
 */
async function fillMissingEmbeddings(captures, embed, { db = null } = {}) {
  if (!embed) return 0;
  const missing = [...captures.values()].flat().filter(item => item.kind === 'action' && !(Array.isArray(item.embedding) && item.embedding.length));
  let computed = 0;
  for (let i = 0; i < missing.length; i += 10) {
    await Promise.all(missing.slice(i, i + 10).map(async item => {
      try {
        const embedding = await embed(item.text);
        if (!Array.isArray(embedding) || !embedding.length) return;
        item.embedding = embedding;
        computed++;
        if (db) await db.collection('action_items').updateOne({ item_id: item.item_id }, { $set: { embedding } });
      } catch (error) {
        console.warn(`⚠️  Embedding failed for ${item.item_id}: ${error.message}`);
      }
    }));
  }
  return computed;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const showText = process.argv.includes('--show-text');
  const arg = name => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : undefined; };
  const threshold = Math.min(0.99, Math.max(0.3, parseFloat(arg('--threshold')) || DEFAULT_THRESHOLD));
  const days = Math.max(1, parseInt(arg('--days'), 10) || 90);

  await connectToMongoDB();
  const db = getDatabase();
  const captures = await loadCaptures(db, days);
  const embeddings = require('../../src/services/embeddings');
  embeddings.initializeEmbeddings();
  const embed = embeddings.isEmbeddingsEnabled() ? text => embeddings.generateQueryEmbedding(text) : null;
  const computed = await fillMissingEmbeddings(captures, embed, { db: apply ? db : null });
  console.log(embed
    ? `   ${computed} action item(s) had no embedding: computed${apply ? ' and stored' : ' (stored only with --apply)'}`
    : '   ⚠️  Embeddings are off (no OpenAI key): action items without one only follow their decision');
  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ${captures.size} capture(s) from the last ${days} days, threshold ${threshold}`);

  let threads = 0;
  let items = 0;
  for (const [, captureItems] of captures) {
    for (const group of groupCapture(captureItems, threshold)) {
      threads++;
      items += group.length;
      const topicId = newTopicId();
      const topic = labelFor(group);
      console.log(`   ${topicId}: ${group.map(item => `${item.key} (${item.type}${typeof item.similarity === 'number' ? `, ${item.similarity.toFixed(2)}` : ''})${showText ? ` "${String(item.text).split(/\s+/).slice(0, 8).join(' ')}…"` : ''}`).join(', ')}`);
      if (!apply) continue;
      const workspaceId = group[0].workspace_id;
      const outcomeIds = group.filter(item => item.kind === 'outcome').map(item => item.id);
      const itemIds = group.filter(item => item.kind === 'action').map(item => item.item_id);
      if (outcomeIds.length) await db.collection('decisions').updateMany({ workspace_id: workspaceId, id: { $in: outcomeIds }, topic_id: { $in: [null, ''] } }, { $set: { topic_id: topicId, topic } });
      if (itemIds.length) await db.collection('action_items').updateMany({ workspace_id: workspaceId, item_id: { $in: itemIds }, topic_id: { $in: [null, ''] } }, { $set: { topic_id: topicId, topic } });
    }
  }
  console.log(`   ${threads} thread(s), ${items} item(s)${apply ? ' updated' : ''}`);
  if (!apply) console.log('\nRun again with --apply to write changes.');
  await closeMongoDB();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { groupCapture, labelFor, loadCaptures, fillMissingEmbeddings };
