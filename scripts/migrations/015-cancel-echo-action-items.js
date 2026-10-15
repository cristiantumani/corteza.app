/**
 * Migration 015: cancel action items that only repeat a risk or open question (COR-34).
 *
 * Before the Oct 2 fix, a risk or open question with a date also produced an action item with the
 * same text ("Cómo rediseñar las páginas de precios…" as both a question and a task). This finds the
 * open action items whose text is the same as a risk's or open question's from the same meeting
 * (ignoring case, accents and punctuation) and cancels them. They're marked
 * `cancelled_by: 'migration_015'`, so they can be found again; nothing is deleted.
 *
 * Texts are encrypted, so they're compared in memory (getDatabase decrypts). Logs show counts and
 * ids only. Safe to run twice.
 *
 * Usage:
 *   node scripts/migrations/015-cancel-echo-action-items.js          # dry run: counts and ids
 *   node scripts/migrations/015-cancel-echo-action-items.js --apply  # cancel them
 */
require('dotenv').config();
const { connectToMongoDB, closeMongoDB, getDatabase } = require('../../src/config/database');

const ECHOED_TYPES = ['risk', 'open_question'];

/**
 * Text reduced to its words: lowercase, no accents, no punctuation, single spaces
 * @param {unknown} text
 * @returns {string}
 */
function normalizeText(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Open action items that repeat a risk or open question of the same meeting
 * @param {import('mongodb').Db} db - decrypting database (getDatabase)
 * @returns {Promise<Array<{ workspace_id: string, item_id: string, decision_id: number|null, type: string }>>}
 */
async function findEchoes(db) {
  const items = await db.collection('action_items').find(
    { status: 'open', 'source.external_id': { $type: 'string' } },
    { projection: { _id: 0, workspace_id: 1, item_id: 1, text: 1, source: 1 } }
  ).toArray();
  if (items.length === 0) return [];

  const meetingIds = [...new Set(items.map(item => item.source.external_id))];
  const outcomes = await db.collection('decisions').find(
    { type: { $in: ECHOED_TYPES }, 'source_details.external_id': { $in: meetingIds } },
    { projection: { _id: 0, workspace_id: 1, id: 1, type: 1, text: 1, source_details: 1 } }
  ).toArray();

  /** @type {Map<string, { id: number|null, type: string }>} */
  const byKey = new Map();
  for (const outcome of outcomes) {
    const text = normalizeText(outcome.text);
    if (text) byKey.set(`${outcome.workspace_id}|${outcome.source_details.external_id}|${text}`, { id: outcome.id ?? null, type: outcome.type });
  }

  const echoes = [];
  for (const item of items) {
    const match = byKey.get(`${item.workspace_id}|${item.source.external_id}|${normalizeText(item.text)}`);
    if (match) echoes.push({ workspace_id: item.workspace_id, item_id: item.item_id, decision_id: match.id, type: match.type });
  }
  return echoes;
}

/**
 * @param {import('mongodb').Db} db
 * @param {{ apply: boolean }} options
 * @returns {Promise<{ echoes: Array<{ workspace_id: string, item_id: string, decision_id: number|null, type: string }>, cancelled: number }>}
 */
async function cancelEchoes(db, { apply }) {
  const echoes = await findEchoes(db);
  if (!apply || echoes.length === 0) return { echoes, cancelled: 0 };
  const now = new Date();
  const result = await db.collection('action_items').bulkWrite(echoes.map(echo => ({
    updateOne: {
      filter: { workspace_id: echo.workspace_id, item_id: echo.item_id, status: 'open' },
      update: { $set: { status: 'cancelled', completed_at: null, cancelled_by: 'migration_015', updated_at: now } }
    }
  })));
  return { echoes, cancelled: result.modifiedCount };
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectToMongoDB();
  const { echoes, cancelled } = await cancelEchoes(getDatabase(), { apply });
  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ${echoes.length} open action item(s) repeat a risk or open question of the same meeting`);
  for (const echo of echoes) console.log(`   ${echo.item_id} (workspace ${echo.workspace_id}) repeats ${echo.type} #${echo.decision_id}`);
  if (apply) console.log(`   ${cancelled} cancelled`);
  else if (echoes.length) console.log('\nRun again with --apply to cancel them.');
  await closeMongoDB();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { cancelEchoes, findEchoes, normalizeText };
