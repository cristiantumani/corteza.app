/**
 * DANGER: empties the whole app database: every account, workspace, space, outcome,
 * action item, Google Meet connection, session and setting.
 *
 * Every collection of the app's database (DB_NAME, default 'decision-logger') is emptied
 * with deleteMany: the collections and their indexes stay (including an Atlas vector search
 * index on `decisions`), so the app keeps working and people start over by signing in.
 * Google Meet connections are deleted, so everyone reconnects from Settings → Google Meet.
 *
 * Usage:
 *   node scripts/cleanup-all-data.js            # dry run: what would be deleted
 *   node scripts/cleanup-all-data.js --apply    # delete everything
 *   node scripts/cleanup-all-data.js --apply --keep beta_access   # keep some collections
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

function keepList() {
  const index = process.argv.indexOf('--keep');
  return index === -1 ? [] : String(process.argv[index + 1] || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not set');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const keep = keepList();
  const dbName = process.env.DB_NAME || 'decision-logger';

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(c => c.name)
    .filter(name => !name.startsWith('system.'))
    .sort();

  console.log(`${apply ? '🗑️  DELETING' : '🔎 DRY RUN'}: database "${dbName}"\n`);
  let total = 0;
  for (const name of collections) {
    const count = await db.collection(name).countDocuments({});
    if (keep.includes(name)) {
      console.log(`   ⏭️  ${name}: ${count} kept`);
      continue;
    }
    total += count;
    if (apply && count > 0) await db.collection(name).deleteMany({});
    console.log(`   ${apply ? '✅' : '•'} ${name}: ${count}${apply ? ' deleted' : ''}`);
  }

  console.log(`\n${apply ? 'Deleted' : 'Would delete'} ${total} document(s) in ${collections.length - keep.length} collection(s).`);
  if (!apply) {
    console.log('Run again with --apply to delete them. This cannot be undone.');
  } else {
    console.log('\nNext: sign in at /auth/login with Google. With BETA_REQUIRED=true, request access on the');
    console.log('website and approve yourself from the email (or run scripts/beta-approve.js first).');
  }
  await client.close();
}

main().catch(error => {
  console.error('❌ Cleanup failed:', error);
  process.exit(1);
});
