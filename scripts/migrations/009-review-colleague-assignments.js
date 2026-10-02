/**
 * Migration 009: run the colleague-assignment check on action items saved before it existed.
 *
 * Items a colleague's capture assigned to someone else (owner ≠ the person who captured the
 * meeting) get the same treatment new ones do (core/actions/colleague-assignments):
 * a copy of an item the owner already had is hidden from them, and marked done when they had
 * finished it; the rest are flagged as new for the owner (banner and sidebar count until they
 * open Action items). Only items created in the last --days days (default 45) that were never
 * checked (no `owner_duplicates`) are touched, so it's safe to run twice.
 *
 * Usage:
 *   node scripts/migrations/009-review-colleague-assignments.js             # dry run: counts only
 *   node scripts/migrations/009-review-colleague-assignments.js --apply     # write changes
 *   node scripts/migrations/009-review-colleague-assignments.js --apply --days 30
 */
require('dotenv').config();
const { connectToMongoDB, closeMongoDB, getDatabase } = require('../../src/config/database');

/**
 * Items to check: from a colleague's capture, recent, never checked
 * @param {import('mongodb').Db} db
 * @param {number} days
 * @returns {Promise<Object[]>}
 */
async function itemsToReview(db, days) {
  const items = await db.collection('action_items').find({
    created_at: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    owner_duplicates: { $exists: false },
    'created_by.user_id': { $ne: null },
    'owner_ids.0': { $exists: true }
  }, { projection: { _id: 0 } }).sort({ created_at: 1 }).toArray();
  return items.filter(item => item.owner_ids.some(id => id && id !== item.created_by.user_id));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg > -1 ? Math.max(1, parseInt(process.argv[daysArg + 1], 10) || 45) : 45;

  await connectToMongoDB();
  require('../../src/services/embeddings').initializeEmbeddings();
  const items = await itemsToReview(getDatabase(), days);
  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ${items.length} action item(s) from colleagues' meetings in the last ${days} days, never checked`);

  if (apply && items.length) {
    const { reviewColleagueAssignments } = require('../../src/core/actions/colleague-assignments');
    // Oldest first, one at a time: a later copy is checked against the earlier ones
    const totals = { duplicates: 0, completedEarlier: 0, newForOwners: 0 };
    for (const item of items) {
      const result = await reviewColleagueAssignments([item]);
      for (const key of Object.keys(totals)) totals[key] += result[key];
    }
    console.log(`   Already had it (hidden from the owner): ${totals.duplicates}`);
    console.log(`   ...of which the owner had finished (marked done): ${totals.completedEarlier}`);
    console.log(`   New for the owner (flagged): ${totals.newForOwners}`);
  } else if (!apply) {
    console.log('\nRun again with --apply to write changes.');
  }
  await closeMongoDB();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { itemsToReview };
