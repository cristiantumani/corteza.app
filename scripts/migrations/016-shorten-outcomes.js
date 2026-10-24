/**
 * Migration 016: rewrite saved AI-captured outcomes as short headlines (COR-55,
 * docs/specs/2026-10-concise-outcomes.md).
 *
 * New captures follow the concise rules (a headline of at most 15 words, a "why" of at most 20 words
 * only when it adds something). This rewrites the outcomes and action items saved before, with
 * Claude, under the same rules and in the same language. Only AI-captured items nobody edited by hand
 * (`text_edited_at`), and only those that are long (headline over 15 words or why over 20). The old
 * text stays in `original_text` / `original_rationale` (encrypted like the text) and `shortened_at`
 * marks them, so a second run skips them and --undo puts the originals back. Queries filter on
 * `shortened_at` and `text_edited_at`, never on encrypted fields. Quotes stay as they are.
 *
 * The dry run calls Claude for a sample (--sample, default 10) and prints before → after pairs to
 * this terminal only, never to logs; it writes nothing. --apply rewrites everything that qualifies.
 * About one call per 20 items, metered in ai_usage as 'shorten_outcomes'.
 *
 * Usage:
 *   railway run node scripts/migrations/016-shorten-outcomes.js                       # dry run: 10 samples
 *   railway run node scripts/migrations/016-shorten-outcomes.js --workspace T123      # one workspace
 *   railway run node scripts/migrations/016-shorten-outcomes.js --apply               # rewrite them
 *   railway run node scripts/migrations/016-shorten-outcomes.js --undo                # put the originals back
 */
require('dotenv').config();
const { connectToMongoDB, closeMongoDB, getDatabase } = require('../../src/config/database');

const HEADLINE_MAX_WORDS = 15;
const WHY_MAX_WORDS = 20;
const BATCH_SIZE = 20;
const FEATURE = 'shorten_outcomes';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

/** @param {unknown} text @returns {number} */
function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Whether an item is AI-captured, untouched by hand, not rewritten yet, and long
 * @param {{ capture?: string, text?: string, rationale?: string|null, shortened_at?: Date, text_edited_at?: Date }} item
 * @returns {boolean}
 */
function needsShortening(item) {
  if (item.capture !== 'ai' || item.text_edited_at || item.shortened_at) return false;
  return wordCount(item.text) > HEADLINE_MAX_WORDS || wordCount(item.rationale) > WHY_MAX_WORDS;
}

const SYSTEM = `You rewrite items from a team's meeting log so each reads in one glance. For each item return:
- "text": a headline of at most ${HEADLINE_MAX_WORDS} words with the outcome itself. No lead-ins ("Se decide…", "Se acordó…", "The team agreed…") and no narration ("Se propuso…", "X propuso…"). Decisions: the choice. Action items: owner + verb + what, plus when if it was in the text ("Ana envía el deck de precios (viernes)"). Open questions: as a question. Risks: the threat.
- "rationale": the why in one short sentence of at most ${WHY_MAX_WORDS} words, only if the original why says something the headline doesn't; otherwise null. Never restate the headline.
Keep the item's language, names, numbers, dates, product and customer names. Don't add anything that isn't in the original. Respond with only a JSON array, one object per input item, in the same order: [{"i": 0, "text": "...", "rationale": "..."|null}].`;

/**
 * Rewrites one batch with Claude
 * @param {Object} anthropic - from createAnthropic
 * @param {Array<{ type: string, text: string, rationale: string|null }>} items
 * @returns {Promise<{ rewrites: Array<{ text: string, rationale: string|null }|null>, response: Object }>}
 */
async function rewriteBatch(anthropic, items) {
  const config = require('../../src/config/environment');
  const input = items.map((item, i) => ({ i, type: item.type, text: item.text, rationale: item.rationale || null }));
  const response = await anthropic.messages.create({
    model: config.claude.model,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(input) }]
  });
  const { parseLeadingJsonArray } = require('../../src/services/claude');
  const reply = (response.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  const parsed = parseLeadingJsonArray(reply) || [];
  const rewrites = items.map((_, i) => {
    const row = parsed.find(entry => entry && entry.i === i);
    if (!row || typeof row.text !== 'string' || !row.text.trim()) return null;
    const rationale = typeof row.rationale === 'string' && row.rationale.trim() ? row.rationale.trim().slice(0, 500) : null;
    return { text: row.text.trim().slice(0, 1000), rationale };
  });
  return { rewrites, response };
}

/**
 * Candidates: AI-captured decisions (all types) and action items that need shortening
 * @param {import('mongodb').Db} db - decrypting database (getDatabase)
 * @param {string|null} workspaceId
 * @returns {Promise<Array<{ collection: 'decisions'|'action_items', key: Object, workspace_id: string, type: string, text: string, rationale: string|null }>>}
 */
async function findCandidates(db, workspaceId) {
  const scope = workspaceId ? { workspace_id: workspaceId } : {};
  const query = { ...scope, capture: 'ai', shortened_at: { $exists: false }, text_edited_at: { $exists: false } };
  const [decisions, actionItems] = await Promise.all([
    db.collection('decisions').find(query, { projection: { _id: 0, workspace_id: 1, id: 1, type: 1, text: 1, rationale: 1, capture: 1 } }).toArray(),
    db.collection('action_items').find(query, { projection: { _id: 0, workspace_id: 1, item_id: 1, text: 1, rationale: 1, capture: 1 } }).toArray()
  ]);
  return [
    ...decisions.filter(needsShortening).map(row => ({ collection: /** @type {const} */ ('decisions'), key: { workspace_id: row.workspace_id, id: row.id }, workspace_id: row.workspace_id, type: row.type || 'decision', text: row.text, rationale: row.rationale || null })),
    ...actionItems.filter(needsShortening).map(row => ({ collection: /** @type {const} */ ('action_items'), key: { workspace_id: row.workspace_id, item_id: row.item_id }, workspace_id: row.workspace_id, type: 'action_item', text: row.text, rationale: row.rationale || null }))
  ];
}

/**
 * Rewrites the candidates (or a sample of them, without writing)
 * @param {import('mongodb').Db} db
 * @param {{ apply: boolean, workspaceId?: string|null, sample?: number, rewrite?: Function }} options -
 *   rewrite(items) => Promise<{ rewrites, response }> is injectable for tests
 * @returns {Promise<{ found: number, rewritten: number, pairs: Array<{ before: Object, after: Object }> }>}
 */
async function shortenOutcomes(db, { apply, workspaceId = null, sample = 10, rewrite } = /** @type {any} */ ({})) {
  const candidates = await findCandidates(db, workspaceId);
  const todo = apply ? candidates : candidates.slice(0, sample);
  let anthropic = null;
  const call = rewrite || (items => {
    anthropic = anthropic || require('../../src/integrations/anthropic/client').createAnthropic();
    return rewriteBatch(anthropic, items);
  });
  const { recordAiUsage } = require('../../src/core/usage/ai-usage');
  const pairs = [];
  let rewritten = 0;
  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const batch = todo.slice(start, start + BATCH_SIZE);
    const { rewrites, response } = await call(batch);
    if (response && response.usage) await recordAiUsage({ workspaceId: batch[0].workspace_id, feature: FEATURE, response }).catch(() => {});
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const after = rewrites[i];
      if (!after) continue;
      pairs.push({ before: { text: item.text, rationale: item.rationale }, after });
      if (!apply) continue;
      const result = await db.collection(item.collection).updateOne(
        { ...item.key, shortened_at: { $exists: false }, text_edited_at: { $exists: false } },
        { $set: { text: after.text, rationale: after.rationale, original_text: item.text, original_rationale: item.rationale, shortened_at: new Date() } }
      );
      rewritten += result.modifiedCount;
    }
  }
  return { found: candidates.length, rewritten, pairs };
}

/**
 * Puts the original text and why back on everything this migration rewrote
 * @param {import('mongodb').Db} db
 * @param {string|null} [workspaceId]
 * @returns {Promise<number>} items restored
 */
async function undoShorten(db, workspaceId = null) {
  let restored = 0;
  for (const name of ['decisions', 'action_items']) {
    const rows = await db.collection(name).find(
      { ...(workspaceId ? { workspace_id: workspaceId } : {}), shortened_at: { $exists: true } },
      { projection: { _id: 1, original_text: 1, original_rationale: 1 } }
    ).toArray();
    for (const row of rows) {
      const result = await db.collection(name).updateOne(
        { _id: row._id },
        { $set: { text: row.original_text, rationale: row.original_rationale ?? null }, $unset: { original_text: '', original_rationale: '', shortened_at: '' } }
      );
      restored += result.modifiedCount;
    }
  }
  return restored;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const undo = process.argv.includes('--undo');
  const workspaceId = argument('workspace');
  const sample = Math.max(1, parseInt(argument('sample') || '10', 10) || 10);
  await connectToMongoDB();
  const db = getDatabase();
  if (undo) {
    console.log(`↩️  UNDO: ${await undoShorten(db, workspaceId)} item(s) restored`);
  } else {
    const { found, rewritten, pairs } = await shortenOutcomes(db, { apply, workspaceId, sample });
    console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ${found} long AI-captured item(s) to shorten`);
    if (apply) {
      console.log(`   ${rewritten} rewritten`);
    } else {
      // Meeting content goes to this terminal only (it's the reader's own data), never to server logs
      pairs.forEach(({ before, after }, i) => {
        process.stdout.write(`\n${i + 1}. BEFORE: ${before.text}\n${before.rationale ? `   why: ${before.rationale}\n` : ''}   AFTER:  ${after.text}\n${after.rationale ? `   why: ${after.rationale}\n` : ''}`);
      });
      if (found) console.log('\nIf these read well, run again with --apply.');
    }
  }
  await closeMongoDB();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  });
}

module.exports = { shortenOutcomes, undoShorten, needsShortening, findCandidates, wordCount };
