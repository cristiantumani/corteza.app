/**
 * Shows how much space each collection uses, to see what fills the Atlas storage limit
 * (512 MB on the free M0 tier). Read-only: it changes nothing.
 *
 * For `decisions` it also shows how much of it is embeddings (the vectors Search uses).
 *
 * Usage:
 *   node scripts/db-size.js
 *   railway run node scripts/db-size.js     # against production
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const ATLAS_FREE_LIMIT = 512 * 1024 * 1024;

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Size of one collection: documents, data (uncompressed), on disk, indexes
 * @param {import('mongodb').Db} db
 * @param {string} name
 * @returns {Promise<{name: string, count: number, size: number, storageSize: number, indexSize: number}>}
 */
async function collectionSize(db, name) {
  try {
    const [stats] = await db.collection(name).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
    const s = stats.storageStats;
    return { name, count: s.count, size: s.size, storageSize: s.storageSize, indexSize: s.totalIndexSize };
  } catch {
    // Some Atlas tiers don't allow $collStats: fall back to counting documents only
    const count = await db.collection(name).estimatedDocumentCount();
    return { name, count, size: null, storageSize: null, indexSize: null };
  }
}

/**
 * How many bytes of `decisions` are embeddings
 * @param {import('mongodb').Db} db
 * @returns {Promise<{withEmbedding: number, bytes: number}>}
 */
async function embeddingSize(db) {
  const [row] = await db.collection('decisions').aggregate([
    { $match: { embedding: { $exists: true, $ne: null } } },
    { $group: { _id: null, withEmbedding: { $sum: 1 }, bytes: { $sum: { $bsonSize: { e: '$embedding' } } } } }
  ]).toArray();
  return row || { withEmbedding: 0, bytes: 0 };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not set');
    process.exit(1);
  }
  const dbName = process.env.DB_NAME || 'decision-logger';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(c => c.name)
    .filter(name => !name.startsWith('system.'));
  const rows = await Promise.all(names.map(name => collectionSize(db, name)));
  rows.sort((a, b) => ((b.size || 0) + (b.indexSize || 0)) - ((a.size || 0) + (a.indexSize || 0)) || b.count - a.count);

  const dbStats = await db.stats();
  const used = dbStats.dataSize + dbStats.indexSize;

  console.log(`📊 Database "${dbName}"\n`);
  console.log(`   ${'Collection'.padEnd(26)}${'Docs'.padStart(8)}${'Data'.padStart(12)}${'Indexes'.padStart(12)}${'Avg/doc'.padStart(11)}${'Share'.padStart(8)}`);
  for (const row of rows) {
    const total = (row.size || 0) + (row.indexSize || 0);
    const share = row.size === null ? '?' : `${((total / used) * 100).toFixed(1)}%`;
    const avg = row.size && row.count ? formatBytes(Math.round(row.size / row.count)) : '-';
    console.log(`   ${row.name.padEnd(26)}${String(row.count).padStart(8)}${(row.size === null ? '?' : formatBytes(row.size)).padStart(12)}${(row.indexSize === null ? '?' : formatBytes(row.indexSize)).padStart(12)}${avg.padStart(11)}${share.padStart(8)}`);
  }

  console.log(`\n   Data ${formatBytes(dbStats.dataSize)} + indexes ${formatBytes(dbStats.indexSize)} = ${formatBytes(used)}`);
  console.log(`   On disk (compressed): ${formatBytes(dbStats.storageSize + dbStats.indexSize)}`);
  console.log(`   Atlas free tier (M0) limit: ${formatBytes(ATLAS_FREE_LIMIT)} → ${((used / ATLAS_FREE_LIMIT) * 100).toFixed(1)}% used`);

  if (names.includes('decisions')) {
    const { withEmbedding, bytes } = await embeddingSize(db);
    const decisions = rows.find(row => row.name === 'decisions');
    if (withEmbedding > 0) {
      const share = decisions && decisions.size ? ` (${((bytes / decisions.size) * 100).toFixed(0)}% of decisions)` : '';
      console.log(`\n🧠 Embeddings: ${withEmbedding} outcome(s), ${formatBytes(bytes)}${share}, about ${formatBytes(Math.round(bytes / withEmbedding))} each`);
    }
  }
  console.log('\nSessions expire on their own after 7 days (TTL index), so `sessions` stays small.');

  await client.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
}

module.exports = { formatBytes, collectionSize, embeddingSize };
