/**
 * Sends one person's morning summary now, to see it without waiting for 8:00. Doesn't mark the
 * day as sent, so tomorrow's summary comes as usual. Built like the real one (meeting prep from
 * their calendar included), from the last 24 hours, and sent even when there's nothing new.
 *
 * Usage:
 *   railway run node scripts/send-daily-digest.js --email ana@acme.com             # send it to them
 *   railway run node scripts/send-daily-digest.js --email ana@acme.com --dry-run   # write the HTML to a local file instead
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const database = require('../src/config/database');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const email = String(argument('email') || '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error('Usage: node scripts/send-daily-digest.js --email <member email> [--dry-run]');
    process.exit(1);
  }
  process.env.NODE_ENV = process.env.NODE_ENV || 'script'; // skip the outbound-IP log
  if (!await database.connectToMongoDB()) {
    console.error('❌ Could not connect to MongoDB (MONGODB_URI)');
    process.exit(1);
  }
  const digest = require('../src/jobs/daily-digest');
  const { dailyDigestHtml, sendDailyDigestEmail } = require('../src/utils/n8n-client');
  const db = database.getDatabase();

  const members = await database.getWorkspaceMembersCollection().find({ email, removed_at: null }).toArray();
  if (members.length === 0) {
    console.error('No active member with that email');
    process.exit(1);
  }
  for (const member of members) {
    const colleagues = await database.getWorkspaceMembersCollection().find({ workspace_id: member.workspace_id, removed_at: null }, { projection: { workspace_id: 1, timezone: 1 } }).toArray();
    const timeZone = digest.timeZoneResolver(colleagues)(member);
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3600 * 1000);
    const [workspace, connection] = await Promise.all([
      db.collection('workspaces').findOne({ workspace_id: member.workspace_id }, { projection: { _id: 0, digest_voices_enabled: 1 } }),
      db.collection('google_connections').findOne({ workspace_id: member.workspace_id, user_id: member.user_id }, { projection: { _id: 0, 'settings.language': 1 } })
    ]);
    const summary = await digest.buildDailySummary(member.workspace_id, member.user_id, since, now, timeZone);
    const { params } = await digest.composeDigest(member, {
      summary, since, now, timeZone, workspace, languageSetting: (connection && connection.settings && connection.settings.language) || null
    });
    const meetings = summary.meetingPrep.length;
    if (process.argv.includes('--dry-run')) {
      const file = path.resolve(`daily-digest-${member.workspace_id}.html`);
      fs.writeFileSync(file, dailyDigestHtml(params));
      console.log(`📝 ${member.workspace_id}: written to ${file} (${meetings} meeting(s) in the prep)`);
    } else {
      await sendDailyDigestEmail(params);
      console.log(`📬 ${member.workspace_id}: sent (${meetings} meeting(s) in the prep)`);
    }
  }
  process.exit(0);
}

main().catch(error => {
  console.error('❌', error.message);
  process.exit(1);
});
