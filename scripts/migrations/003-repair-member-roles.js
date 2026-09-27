/**
 * Migration 003: repair workspace_members.role overwritten by old onboarding.
 *
 * Before Phase 2, completing onboarding saved the job title from the form
 * (e.g. "product-manager") into workspace_members.role, which should be
 * 'admin' or 'member'. This moves the job title to `role_title` and restores
 * `role` from workspace_admins (admin if the user is an active admin there).
 *
 * Idempotent. Usage:
 *   node scripts/migrations/003-repair-member-roles.js           # dry run
 *   node scripts/migrations/003-repair-member-roles.js --apply   # write changes
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'decision-logger');
  const members = db.collection('workspace_members');
  const admins = db.collection('workspace_admins');

  const broken = await members.find({ role: { $nin: ['admin', 'member'] } }).toArray();
  console.log(`${APPLY ? '✍️  APPLY' : '🔎 DRY RUN'} — ${broken.length} membership(s) with an invalid role\n`);

  for (const member of broken) {
    const admin = await admins.findOne({
      workspace_id: member.workspace_id,
      user_id: member.user_id,
      role: 'admin',
      deactivated_at: null
    });
    const role = admin ? 'admin' : 'member';
    console.log(`👤 ${member.workspace_id} ${member.user_id} (${member.email || member.user_name || ''}): "${member.role}" → role "${role}", role_title "${member.role}"`);
    if (APPLY) {
      await members.updateOne(
        { _id: member._id },
        { $set: { role, role_title: member.role_title || member.role } }
      );
    }
  }

  if (!APPLY) console.log('\nNothing was written. Re-run with --apply to make the changes.');
  await client.close();
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
