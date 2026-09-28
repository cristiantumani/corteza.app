/**
 * Migration 006: rewrite a workspace's saved outcomes in one language.
 *
 * Captures made before outcomes followed the meeting's language were sometimes
 * saved in English although the meeting was in Spanish (Gemini notes come in the
 * account's language). This translates the text, why (rationale) and tags of
 * decisions, open questions, risks and action items that aren't already in the
 * target language. Names, numbers and product terms stay as they are; evidence
 * quotes stay verbatim. Each item remembers its original language
 * (`translated_from`), so running it again skips it.
 *
 * Calls Claude (about one call per 20 items). The dry run only lists what would change.
 *
 * Usage:
 *   node scripts/migrations/006-translate-outcomes.js --workspace T123 --to es           # dry run
 *   node scripts/migrations/006-translate-outcomes.js --workspace T123 --to es --apply   # write changes
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const Anthropic = require('@anthropic-ai/sdk');
const { LANGUAGE_CODES, detectLanguage, languageName } = require('../../src/core/language/detect');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 20;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

/** Items whose text isn't clearly in the target language (unclear ones are sent too; Claude leaves them as they are) */
function needsTranslation(item, target) {
  if (item.translated_from) return false;
  const language = detectLanguage([item.text, item.rationale].filter(Boolean).join('. '), { short: true });
  return language !== target;
}

/**
 * Translates a batch with Claude
 * @param {Anthropic} anthropic
 * @param {Array<{ key: string, text: string, rationale: string|null, tags: string[] }>} batch
 * @param {string} target - language code
 * @returns {Promise<Map<string, { text, rationale, tags, from }>>}
 */
async function translateBatch(anthropic, batch, target) {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
  const prompt = `Rewrite these meeting outcomes in ${languageName(target)}. They are entries in a team's decision log.
- Translate "text", "rationale" and "tags". Keep the meaning, tone and length; keep names of people, companies, products, numbers and dates as they are.
- Write decisions as outcomes ("Se decide …" in Spanish), not narrations.
- If an item is already in ${languageName(target)}, return it unchanged.
- "from": the language code the item was written in (es, en, pt, …).

Items:
${JSON.stringify(batch)}

Reply with JSON only: [{"key": "...", "text": "...", "rationale": "..." or null, "tags": ["..."], "from": "en"}]`;

  const response = await anthropic.messages.create({ model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] });
  const text = (response.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Claude did not return a JSON array');
  return new Map(JSON.parse(match[0]).map(item => [item.key, item]));
}

async function main() {
  const workspaceId = argument('workspace');
  const target = argument('to') || 'es';
  if (!workspaceId || !LANGUAGE_CODES.includes(target)) {
    console.error('Usage: node scripts/migrations/006-translate-outcomes.js --workspace <id> --to es|en|pt [--apply]');
    process.exit(1);
  }
  if (APPLY && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required to translate');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'decision-logger');
  const decisions = db.collection('decisions');
  const actionItems = db.collection('action_items');

  const [outcomes, items] = await Promise.all([
    decisions.find({ workspace_id: workspaceId }).project({ id: 1, text: 1, rationale: 1, tags: 1, translated_from: 1 }).toArray(),
    actionItems.find({ workspace_id: workspaceId }).project({ item_id: 1, text: 1, rationale: 1, translated_from: 1 }).toArray()
  ]);
  const pending = [
    ...outcomes.filter(o => needsTranslation(o, target)).map(o => ({ collection: decisions, filter: { workspace_id: workspaceId, id: o.id }, key: `d${o.id}`, text: o.text, rationale: o.rationale || null, tags: o.tags || [] })),
    ...items.filter(i => needsTranslation(i, target)).map(i => ({ collection: actionItems, filter: { workspace_id: workspaceId, item_id: i.item_id }, key: `a${i.item_id}`, text: i.text, rationale: i.rationale || null, tags: [] }))
  ];

  console.log(`${APPLY ? '✍️  APPLY' : '🔎 DRY RUN'}: workspace ${workspaceId}, target ${languageName(target)}`);
  console.log(`   ${outcomes.length} outcome(s) and ${items.length} action item(s); ${pending.length} not clearly in ${languageName(target)}\n`);
  pending.slice(0, 15).forEach(p => console.log(`   • ${p.key}: "${p.text.slice(0, 90)}"`));
  if (pending.length > 15) console.log(`   … and ${pending.length - 15} more`);

  if (!APPLY || pending.length === 0) {
    if (!APPLY) console.log('\nRun again with --apply to translate them (calls Claude).');
    await client.close();
    return;
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let changed = 0;
  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    const translated = await translateBatch(anthropic, batch.map(({ key, text, rationale, tags }) => ({ key, text, rationale, tags })), target);
    for (const entry of batch) {
      const result = translated.get(entry.key);
      if (!result || typeof result.text !== 'string' || !result.text.trim()) continue;
      const update = {
        text: result.text.trim(),
        rationale: typeof result.rationale === 'string' && result.rationale.trim() ? result.rationale.trim() : entry.rationale,
        translated_from: result.from || 'unknown',
        updated_at: new Date()
      };
      if (entry.collection === decisions && Array.isArray(result.tags)) {
        update.tags = result.tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 8);
      }
      // The old embedding describes the old text: re-create it with scripts/migrate-embeddings.js
      await entry.collection.updateOne(entry.filter, { $set: update, ...(entry.collection === decisions ? { $unset: { embedding: '' } } : {}) });
      changed++;
    }
    console.log(`   ✅ ${Math.min(start + BATCH_SIZE, pending.length)} of ${pending.length}`);
  }

  console.log(`\nDone: ${changed} item(s) rewritten in ${languageName(target)}.`);
  console.log('If semantic search is on, run node scripts/migrate-embeddings.js to embed the new text.');
  await client.close();
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
