/**
 * Migration 004: date AI-captured decisions by their meeting, not the import.
 *
 * Decisions captured from meetings used to get `timestamp` = when Corteza saved
 * them, so meetings imported later all showed the import date. This sets
 * `timestamp` to the meeting start (`source_details.occurred_at`). `created_at`
 * keeps the save time.
 *
 * Idempotent. Usage:
 *   node scripts/migrations/004-date-meeting-decisions.js           # dry run
 *   node scripts/migrations/004-date-meeting-decisions.js --apply   # write changes
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'decision-logger');
  const decisions = db.collection('decisions');

  const candidates = await decisions.find({
    capture: 'ai',
    'source_details.occurred_at': { $type: 'string' },
    $expr: { $ne: ['$timestamp', '$source_details.occurred_at'] }
  }).project({ workspace_id: 1, id: 1, timestamp: 1, 'source_details.occurred_at': 1, 'source_details.title': 1 }).toArray();

  console.log(`${APPLY ? '✍️  APPLY' : '🔎 DRY RUN'} — ${candidates.length} decision(s) to re-date\n`);

  for (const decision of candidates) {
    const occurredAt = decision.source_details.occurred_at;
    console.log(`📅 ${decision.workspace_id} #${decision.id} "${decision.source_details.title || ''}": ${decision.timestamp} → ${occurredAt}`);
    if (APPLY) {
      await decisions.updateOne({ _id: decision._id }, { $set: { timestamp: occurredAt } });
    }
  }

  if (!APPLY) console.log('\nNothing was written. Re-run with --apply to make the changes.');
  await client.close();
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
