/**
 * Migration 012: encrypt existing meeting content with each workspace's key
 * (docs/specs/2026-10-workspace-encryption.md).
 *
 * Seals the fields listed in src/core/crypto/fields.js (outcome and action item text, rationale,
 * quotes, AI context, meeting titles…) that are still plain, document by document. Values already
 * encrypted are skipped, so it can be stopped and run again. Needs DATA_KEK; turn FIELD_ENCRYPTION=on
 * first so new writes are encrypted too.
 *
 * Usage:
 *   node scripts/migrations/012-encrypt-workspace-data.js            # dry run: counts per collection
 *   node scripts/migrations/012-encrypt-workspace-data.js --apply    # encrypt
 *   node scripts/migrations/012-encrypt-workspace-data.js --check    # plain values left (expect 0)
 */
require('dotenv').config();
const { connectToMongoDB, closeMongoDB, getRawDatabase } = require('../../src/config/database');
const aead = require('../../src/core/crypto/aead');
const keys = require('../../src/core/crypto/keys');
const fields = require('../../src/core/crypto/fields');

/**
 * Encrypts (or, without apply, counts) the plain content of one collection
 * @param {import('mongodb').Db} db - raw database (no encryption layer)
 * @param {string} name
 * @param {{ apply: boolean }} options
 * @returns {Promise<{ documents: number, plain: number, encrypted: number, skipped: number }>}
 *   plain: documents with at least one plain content value; skipped: no workspace_id
 */
async function encryptCollection(db, name, { apply }) {
  const stats = { documents: 0, plain: 0, encrypted: 0, skipped: 0 };
  const sealers = new Map();
  const cursor = db.collection(name).find({}).sort({ _id: 1 });
  for await (const doc of cursor) {
    stats.documents++;
    let found = false;
    // A dry seal tells whether any content field is still plain
    fields.sealDocument(name, doc, plain => { found = true; return plain; });
    if (!found) continue;
    stats.plain++;
    if (typeof doc.workspace_id !== 'string' || !doc.workspace_id) { stats.skipped++; continue; }
    if (!apply) continue;

    if (!sealers.has(doc.workspace_id)) {
      const { keyId, key } = await keys.getActiveKey(doc.workspace_id);
      sealers.set(doc.workspace_id, plain => aead.encryptValue(key, doc.workspace_id, keyId, plain));
    }
    const sealed = fields.sealDocument(name, doc, sealers.get(doc.workspace_id));
    /** @type {Record<string, any>} */
    const set = {};
    for (const key of Object.keys(sealed)) if (sealed[key] !== doc[key]) set[key] = sealed[key];
    await db.collection(name).updateOne({ _id: doc._id }, { $set: set });
    stats.encrypted++;
  }
  return stats;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const check = process.argv.includes('--check');
  await connectToMongoDB();
  if (apply) {
    keys.assertConfigured();
    if (!process.env.DATA_KEK) throw new Error('Set DATA_KEK before encrypting');
    if (!keys.encryptionEnabled()) console.warn('⚠️  FIELD_ENCRYPTION is not on: new writes will still be plain');
  }
  const db = getRawDatabase();
  console.log(`${apply ? '✍️  APPLY' : check ? '🔍 CHECK' : '🔎 DRY RUN'}: field encryption of existing data`);
  let plainLeft = 0;
  for (const name of Object.keys(fields.FIELD_PATHS)) {
    const stats = await encryptCollection(db, name, { apply });
    plainLeft += stats.plain - stats.encrypted;
    console.log(`   ${name}: ${stats.documents} document(s), ${stats.plain} with plain content${apply ? `, ${stats.encrypted} encrypted` : ''}${stats.skipped ? `, ${stats.skipped} without workspace_id (left as is)` : ''}`);
  }
  if (check) console.log(plainLeft === 0 ? '✅ No plain content left' : `⚠️  ${plainLeft} document(s) still hold plain content`);
  else if (!apply) console.log('\nRun again with --apply to encrypt.');
  await closeMongoDB();
  if (check && plainLeft > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  });
}

module.exports = { encryptCollection };
