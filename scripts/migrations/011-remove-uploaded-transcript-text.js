/**
 * Migration 011: delete the text of uploaded transcripts.
 *
 * Transcripts uploaded by hand (web "Log manually" upload, Slack file uploads) used to be saved
 * whole in `meeting_transcripts` (`content` and `content_preview`), although nothing read them:
 * only the file name, word count and `content_hash` (duplicate detection) are used. New uploads no
 * longer store the text; this removes it from the ones already saved. The hash, file name and
 * counts stay, so duplicate detection keeps working. Safe to run twice.
 *
 * Usage:
 *   node scripts/migrations/011-remove-uploaded-transcript-text.js          # dry run: counts only
 *   node scripts/migrations/011-remove-uploaded-transcript-text.js --apply  # delete the text
 */
require('dotenv').config();
const { connectToMongoDB, closeMongoDB, getDatabase } = require('../../src/config/database');

const WITH_TEXT = { $or: [{ content: { $exists: true } }, { content_preview: { $exists: true } }] };

/**
 * @param {import('mongodb').Db} db
 * @param {{ apply: boolean }} options
 * @returns {Promise<{ found: number, cleaned: number }>}
 */
async function removeTranscriptText(db, { apply }) {
  const collection = db.collection('meeting_transcripts');
  const found = await collection.countDocuments(WITH_TEXT);
  if (!apply || found === 0) return { found, cleaned: 0 };
  const result = await collection.updateMany(WITH_TEXT, { $unset: { content: '', content_preview: '' } });
  return { found, cleaned: result.modifiedCount };
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectToMongoDB();
  const { found, cleaned } = await removeTranscriptText(getDatabase(), { apply });
  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ${found} uploaded transcript(s) still hold their text`);
  if (apply) console.log(`   Text removed from ${cleaned} transcript(s)`);
  else if (found) console.log('\nRun again with --apply to delete it.');
  await closeMongoDB();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { removeTranscriptText };
