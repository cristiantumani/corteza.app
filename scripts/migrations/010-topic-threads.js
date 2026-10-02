/**
 * Migration 010: topic threads for outcomes saved before the extraction returned a topic
 * (docs/specs/2026-10-topic-threads.md).
 *
 * Within each capture of a meeting (same workspace, space and meeting), questions, risks,
 * decisions and action items whose embeddings are close (cosine ≥ --threshold, default 0.55)
 * are grouped; an action item without an embedding follows the decision it carries out
 * (`decision_id`). Only groups with an open question or a risk become threads: those are the
 * ones with a loop to close. A thread's label is its question (or risk), shortened.
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

/**
 * Groups one capture's items (pure)
 * @param {{ key: string, kind: 'outcome'|'action', type: string, id?: number, decision_id?: number|null, text: string, embedding?: number[] }[]} items
 * @param {number} threshold
 * @returns {Object[][]} groups of at least two items that include a question or a risk
 */
function groupCapture(items, threshold) {
  const parent = items.map((_, index) => index);
  const find = index => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].embedding && items[j].embedding && cosine(items[i].embedding, items[j].embedding) >= threshold) union(i, j);
    }
  }
  // An action item follows the decision it carries out
  items.forEach((item, index) => {
    if (item.kind !== 'action' || typeof item.decision_id !== 'number') return;
    const decision = items.findIndex(other => other.kind === 'outcome' && other.id === item.decision_id);
    if (decision > -1) union(index, decision);
  });

  const groups = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });
  return [...groups.values()].filter(group => group.length >= 2 && group.some(item => item.type === 'open_question' || item.type === 'risk'));
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

async function main() {
  const apply = process.argv.includes('--apply');
  const showText = process.argv.includes('--show-text');
  const arg = name => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : undefined; };
  const threshold = Math.min(0.99, Math.max(0.3, parseFloat(arg('--threshold')) || 0.55));
  const days = Math.max(1, parseInt(arg('--days'), 10) || 90);

  await connectToMongoDB();
  const db = getDatabase();
  const captures = await loadCaptures(db, days);
  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ${captures.size} capture(s) from the last ${days} days, threshold ${threshold}`);

  let threads = 0;
  let items = 0;
  for (const [, captureItems] of captures) {
    for (const group of groupCapture(captureItems, threshold)) {
      threads++;
      items += group.length;
      const topicId = newTopicId();
      const topic = labelFor(group);
      console.log(`   ${topicId}: ${group.map(item => `${item.key} (${item.type})${showText ? ` "${String(item.text).split(/\s+/).slice(0, 8).join(' ')}…"` : ''}`).join(', ')}`);
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

module.exports = { groupCapture, labelFor, loadCaptures };
