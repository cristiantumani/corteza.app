/**
 * Exports one person's own Google Meet meetings as eval fixtures, into a folder
 * OUTSIDE the repository (they are real conversations: never commit them).
 *
 * Uses that person's Google Meet connection in Corteza, reads each meeting's
 * transcript and Gemini notes the same way the poller does, and writes one JSON per
 * meeting with empty labels ("labeled": false). Next steps:
 *   1. node scripts/eval/draft-labels.js --dir <folder>   (proposes labels with Claude)
 *   2. review each file: fix "expected" / "not_expected", then set "labeled": true
 *   3. node scripts/eval-extraction.js --dir <folder>
 * Files that already exist are never overwritten (your reviewed labels are safe).
 *
 * Usage:
 *   railway run node scripts/eval/export-meetings.js --email you@company.com
 *   railway run node scripts/eval/export-meetings.js --email you@company.com --from 2026-08-01 --to 2026-09-30 --out ~/corteza-eval --limit 20
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DAY_MS = 24 * 60 * 60 * 1000;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

/** Expands ~ and resolves; refuses folders inside the repository */
function outputDir(value) {
  const dir = path.resolve(String(value || '~/corteza-eval').replace(/^~(?=$|\/)/, os.homedir()));
  if (dir === REPO_ROOT || dir.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`Use a folder outside the repository (got ${dir}): these are real meetings and must not be committed.`);
  }
  return dir;
}

/** "2026-09-29-revision-de-indicadores.json" */
function fileNameFor(meeting) {
  const date = meeting.occurredAt ? meeting.occurredAt.toISOString().slice(0, 10) : 'undated';
  const slug = String(meeting.title || 'meeting').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'meeting';
  return `${date}-${slug}.json`;
}

/**
 * The fixture for one meeting, with empty labels
 * @param {Object} meeting - from loadMeeting
 * @returns {Object}
 */
function toFixture(meeting) {
  return {
    name: meeting.title || 'Meeting',
    title: meeting.title || 'Meeting',
    date: meeting.occurredAt ? meeting.occurredAt.toISOString().slice(0, 10) : null,
    participants: meeting.participants || [],
    source: { external_id: meeting.externalId, url: meeting.url || null },
    transcript: meeting.text,
    labeled: false,
    expected: [],
    not_expected: []
  };
}

async function main() {
  const email = String(argValue('--email') || '').trim().toLowerCase();
  if (!email) throw new Error('Pass --email with the Google account whose meetings to export.');
  const out = outputDir(argValue('--out'));
  const to = argValue('--to') ? new Date(`${argValue('--to')}T23:59:59Z`) : new Date();
  const from = argValue('--from') ? new Date(`${argValue('--from')}T00:00:00Z`) : new Date(to - 30 * DAY_MS);
  const limit = parseInt(argValue('--limit') || '20', 10);

  const database = require('../../src/config/database');
  await database.connectToMongoDB();
  try {
    const connections = require('../../src/integrations/google/connections');
    const meetClient = require('../../src/integrations/google/meet-client');
    const { loadMeeting } = require('../../src/ingestion/sources/google-meet');

    const connection = await database.getDatabase().collection('google_connections').findOne({ google_email: email, status: 'active' });
    if (!connection) throw new Error(`No active Google Meet connection for ${email}. Connect it in Settings → Google Meet first.`);

    const client = connections.getAuthorizedClient(connection);
    const records = (await meetClient.listConferenceRecordsBetween(client, { from, to }))
      .filter(record => record.endTime)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    console.log(`📅 ${records.length} meeting(s) of ${email} between ${from.toISOString().slice(0, 10)} and ${to.toISOString().slice(0, 10)}`);

    fs.mkdirSync(out, { recursive: true });
    let written = 0;
    for (const record of records) {
      if (written >= limit) break;
      const meeting = await loadMeeting(client, record);
      if (meeting.state !== 'ready') {
        console.log(`   ⏭️  ${meeting.title || record.name}: no transcript or notes`);
        continue;
      }
      const file = path.join(out, fileNameFor(meeting));
      if (fs.existsSync(file)) {
        console.log(`   ⏭️  ${path.basename(file)} already exported (kept as is)`);
        continue;
      }
      fs.writeFileSync(file, JSON.stringify(toFixture(meeting), null, 2));
      written++;
      console.log(`   ✅ ${path.basename(file)}`);
    }
    console.log(`\n${written} meeting(s) written to ${out}`);
    console.log('Next: node scripts/eval/draft-labels.js --dir ' + out);
  } finally {
    await database.closeMongoDB();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Export failed:', error.message);
    process.exit(1);
  });
}

module.exports = { outputDir, fileNameFor, toFixture };
