/**
 * Migration 013: tags saved as text become a list.
 *
 * The Chrome extension (`POST /api/memory`) saved tags as one comma-separated string
 * ("iso, security") instead of an array. Search reads every outcome's tags as a list, so one of
 * those made every search in its space fail ("Search failed"). New captures are saved as a list;
 * this fixes the ones already saved. Tags aren't encrypted, so the raw database is fine. Safe to run twice.
 *
 * Usage:
 *   node scripts/migrations/013-normalize-tags.js          # dry run: counts only
 *   node scripts/migrations/013-normalize-tags.js --apply  # rewrite them
 */
require('dotenv').config();
const { connectToMongoDB, closeMongoDB, getRawDatabase } = require('../../src/config/database');
const { normalizeTags } = require('../../src/core/decisions/tags');

// Also matches arrays that hold a string (MongoDB's $type looks inside arrays): kept only if the field itself is text
const TEXT_TAGS = { tags: { $type: 'string' } };

/**
 * @param {import('mongodb').Db} db
 * @param {{ apply: boolean }} options
 * @returns {Promise<{ found: number, fixed: number }>}
 */
async function normalizeStoredTags(db, { apply }) {
  const collection = db.collection('decisions');
  const docs = (await collection.find(TEXT_TAGS, { projection: { _id: 1, tags: 1 } }).toArray())
    .filter(doc => typeof doc.tags === 'string');
  if (!apply || docs.length === 0) return { found: docs.length, fixed: 0 };
  const result = await collection.bulkWrite(docs.map(doc => ({
    updateOne: { filter: { _id: doc._id, tags: doc.tags }, update: { $set: { tags: normalizeTags(doc.tags) } } }
  })));
  return { found: docs.length, fixed: result.modifiedCount };
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectToMongoDB();
  const { found, fixed } = await normalizeStoredTags(getRawDatabase(), { apply });
  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ${found} outcome(s) have their tags saved as text`);
  if (apply) console.log(`   ${fixed} fixed`);
  else if (found) console.log('\nRun again with --apply to fix them.');
  await closeMongoDB();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { normalizeStoredTags };
