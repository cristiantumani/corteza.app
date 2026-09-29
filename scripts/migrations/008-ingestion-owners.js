/**
 * Migration 008: record whose meeting each Google Meet ingestion is.
 *
 * "Latest meetings" (Home, Settings → Google Meet) now lists only the signed-in person's
 * meetings, by `ingestions.user_id`. Older rows have no `user_id`, so they'd stay hidden
 * from everyone. This fills it in:
 *   1. a meeting that produced outcomes → the person those outcomes are attributed to;
 *   2. otherwise, in a workspace with a single Google Meet connection → that person.
 * Rows it can't attribute stay hidden (no one sees a colleague's meeting titles).
 * Idempotent: only rows without `user_id` are touched.
 *
 * Usage:
 *   node scripts/migrations/008-ingestion-owners.js           # dry run
 *   node scripts/migrations/008-ingestion-owners.js --apply   # write changes
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

/**
 * @param {import('mongodb').Db} db
 * @param {{ apply: boolean }} options
 * @returns {Promise<{ fromOutcomes: number, fromSingleConnection: number, unattributed: number }>}
 */
async function migrate(db, { apply }) {
  const ingestions = db.collection('ingestions');
  const rows = await ingestions.find({ user_id: { $exists: false } }).toArray();
  const summary = { fromOutcomes: 0, fromSingleConnection: 0, unattributed: 0 };
  const connectionsByWorkspace = new Map();

  for (const row of rows) {
    const outcome = await db.collection('decisions').findOne(
      { workspace_id: row.workspace_id, 'source_details.external_id': row.external_id, user_id: { $ne: null } },
      { projection: { user_id: 1 } }
    );
    let userId = outcome ? outcome.user_id : null;
    if (userId) {
      summary.fromOutcomes++;
    } else {
      if (!connectionsByWorkspace.has(row.workspace_id)) {
        connectionsByWorkspace.set(row.workspace_id, await db.collection('google_connections').distinct('user_id', { workspace_id: row.workspace_id }));
      }
      const users = connectionsByWorkspace.get(row.workspace_id);
      if (users.length === 1) {
        userId = users[0];
        summary.fromSingleConnection++;
      } else {
        summary.unattributed++;
        continue;
      }
    }
    if (apply) await ingestions.updateOne({ _id: row._id, user_id: { $exists: false } }, { $set: { user_id: userId } });
  }
  return summary;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'decision-logger');
  const summary = await migrate(db, { apply });
  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ingestions without an owner`);
  console.log(`   From the outcomes they produced: ${summary.fromOutcomes}`);
  console.log(`   Only one Google Meet connection in the workspace: ${summary.fromSingleConnection}`);
  console.log(`   Left hidden (can't tell whose): ${summary.unattributed}`);
  if (!apply) console.log('\nRun again with --apply to write changes.');
  await client.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { migrate };
