/**
 * Migration 002: link an existing workspace to Google sign-in.
 *
 * Google sign-in finds your existing workspace by email. Older workspaces were
 * created through Slack (members without an email) or a magic link (maybe with
 * a personal email). This script:
 *   1. makes sure the workspace has a row in `workspaces`,
 *   2. claims a Google Workspace domain for it (colleagues on that domain auto-join),
 *   3. sets the email of one existing member (e.g. you, the admin) to your Google
 *      account email, so your first Google sign-in lands in this workspace with
 *      your decisions and admin role.
 *
 * Usage:
 *   node scripts/migrations/002-link-workspace-to-google.js --list
 *   node scripts/migrations/002-link-workspace-to-google.js \
 *     --workspace <workspace_id> --domain ninjaexcel.com \
 *     --member <user_id> --email you@ninjaexcel.com            # dry run
 *   ... same with --apply                                        # write changes
 *
 * --member is optional when the workspace has exactly one admin.
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : null;
}

const APPLY = process.argv.includes('--apply');

async function listWorkspaces(db) {
  const members = await db.collection('workspace_members').find({ removed_at: null }).toArray();
  const byWorkspace = new Map();
  for (const member of members) {
    if (!byWorkspace.has(member.workspace_id)) byWorkspace.set(member.workspace_id, []);
    byWorkspace.get(member.workspace_id).push(member);
  }
  for (const [workspaceId, list] of byWorkspace) {
    const record = await db.collection('workspaces').findOne({ workspace_id: workspaceId });
    const decisions = await db.collection('decisions').countDocuments({ workspace_id: workspaceId });
    console.log(`\n🏢 ${workspaceId} "${list[0].workspace_name || ''}" — ${decisions} decisions${record?.google_domain ? ` — domain ${record.google_domain}` : ''}`);
    for (const member of list) {
      console.log(`   ${member.role === 'admin' ? '👑' : '  '} ${member.user_id}  ${member.user_name || ''}  ${member.email || '(no email)'}`);
    }
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'decision-logger');

  if (process.argv.includes('--list')) {
    await listWorkspaces(db);
    await client.close();
    return;
  }

  const workspaceId = arg('workspace');
  const domain = arg('domain') ? arg('domain').toLowerCase() : null;
  const email = arg('email') ? arg('email').toLowerCase() : null;
  let memberUserId = arg('member');

  if (!workspaceId || (!domain && !email)) {
    console.error('Usage: --workspace <id> [--domain <google domain>] [--email <google email> [--member <user_id>]] [--apply]  (or --list)');
    process.exit(1);
  }

  const members = db.collection('workspace_members');
  const workspaceMembers = await members.find({ workspace_id: workspaceId, removed_at: null }).toArray();
  if (workspaceMembers.length === 0) {
    console.error(`❌ No active members found for workspace ${workspaceId}. Run with --list to see workspaces.`);
    process.exit(1);
  }

  console.log(`${APPLY ? '✍️  APPLY' : '🔎 DRY RUN'} — workspace ${workspaceId}\n`);

  // 1. Workspace record
  const workspaces = db.collection('workspaces');
  let record = await workspaces.findOne({ workspace_id: workspaceId });
  if (!record) {
    record = {
      workspace_id: workspaceId,
      name: workspaceMembers[0].workspace_name || workspaceId,
      google_domain: null,
      slack_team_id: /^T[A-Z0-9]+$/.test(workspaceId) ? workspaceId : null,
      created_at: new Date()
    };
    if (APPLY) await workspaces.insertOne(record);
    console.log(`🏢 Workspace record ${APPLY ? 'created' : 'would be created'}: "${record.name}"`);
  }

  // 2. Domain
  if (domain) {
    const owner = await workspaces.findOne({ google_domain: domain });
    if (owner && owner.workspace_id !== workspaceId) {
      console.error(`❌ Domain ${domain} already belongs to workspace ${owner.workspace_id}.`);
      process.exit(1);
    }
    if (record.google_domain && record.google_domain !== domain) {
      console.error(`❌ Workspace already linked to ${record.google_domain}.`);
      process.exit(1);
    }
    if (APPLY) {
      await workspaces.updateOne(
        { workspace_id: workspaceId },
        { $set: { google_domain: domain, google_domain_claimed_at: new Date() } }
      );
    }
    console.log(`🔗 Google domain ${domain} ${APPLY ? 'linked' : 'would be linked'}`);
  }

  // 3. Member email
  if (email) {
    if (!memberUserId) {
      const admins = workspaceMembers.filter(m => m.role === 'admin');
      if (admins.length !== 1) {
        console.error(`❌ Found ${admins.length} admins; pass --member <user_id>. Members:`);
        workspaceMembers.forEach(m => console.error(`   ${m.user_id}  ${m.user_name || ''}  ${m.email || '(no email)'}  ${m.role}`));
        process.exit(1);
      }
      memberUserId = admins[0].user_id;
    }
    const member = workspaceMembers.find(m => m.user_id === memberUserId);
    if (!member) {
      console.error(`❌ Member ${memberUserId} not found in workspace ${workspaceId}.`);
      process.exit(1);
    }
    if (APPLY) {
      await members.updateOne({ _id: member._id }, { $set: { email } });
      await db.collection('workspace_admins').updateMany(
        { workspace_id: workspaceId, user_id: member.user_id },
        { $set: { email } }
      );
    }
    console.log(`👤 Member ${member.user_id} (${member.user_name || ''}) email ${member.email || '(none)'} → ${email} ${APPLY ? '' : '(dry run)'}`);
  }

  if (!APPLY) console.log('\nNothing was written. Re-run with --apply to make the changes.');
  await client.close();
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
