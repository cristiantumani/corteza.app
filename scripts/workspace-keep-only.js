/**
 * Leaves one person as the only member of a workspace and removes everyone else.
 *
 * For each other member it deletes: their membership, admin role, space memberships,
 * Google Meet connection (so their meetings stop being captured), open sessions (so
 * they're signed out now) and their `users` row if they belong to no other workspace.
 * It also revokes the workspace's open invite links, and makes the kept person an admin.
 *
 * Outcomes they captured are kept by default (they stay where they are; run
 * migrations/007-personal-spaces.js afterwards to move General into your personal
 * space). With --delete-their-outcomes, outcomes whose author is one of them are
 * deleted too, with their action items and their personal spaces.
 *
 * Note: colleagues with the workspace's Google domain can still sign in later. They
 * join as members with their own empty personal space and can't see yours.
 *
 * Usage:
 *   node scripts/workspace-keep-only.js you@company.com                    # dry run
 *   node scripts/workspace-keep-only.js you@company.com --apply
 *   node scripts/workspace-keep-only.js you@company.com --workspace ws_1   # when you're in several workspaces
 *   node scripts/workspace-keep-only.js you@company.com --delete-their-outcomes --apply
 */
require('dotenv').config();
const database = require('../src/config/database');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Plans (and with apply, makes) the cleanup
 * @param {Object} options
 * @param {string} options.email - the person to keep
 * @param {string} [options.workspaceId] - required when they're in several workspaces
 * @param {boolean} options.apply
 * @param {boolean} [options.deleteTheirOutcomes]
 * @returns {Promise<Object>} report, or { error }
 */
async function keepOnlyMember({ email, workspaceId = null, apply, deleteTheirOutcomes = false }) {
  const db = database.getDatabase();
  const members = db.collection('workspace_members');
  const keepEmail = email.trim().toLowerCase();

  const memberships = await members.find({ email: keepEmail, removed_at: null, ...(workspaceId ? { workspace_id: workspaceId } : {}) }).toArray();
  const workspaceIds = [...new Set(memberships.map(m => m.workspace_id))];
  if (workspaceIds.length === 0) return { error: `${keepEmail} is not an active member of ${workspaceId || 'any workspace'}` };
  if (workspaceIds.length > 1) return { error: `${keepEmail} is in several workspaces (${workspaceIds.join(', ')}). Pass --workspace <id>.` };

  const wid = workspaceIds[0];
  const keep = memberships[0];
  const others = await members.find({ workspace_id: wid, user_id: { $ne: keep.user_id } }).toArray();
  const otherIds = [...new Set(others.map(m => m.user_id))];
  const otherEmails = [...new Set(others.map(m => m.email).filter(Boolean).map(e => e.toLowerCase()))].filter(e => e !== keepEmail);

  const theirOutcomes = otherIds.length ? await db.collection('decisions').find({ workspace_id: wid, user_id: { $in: otherIds } }).project({ id: 1 }).toArray() : [];
  const report = {
    workspaceId: wid,
    keep: { email: keepEmail, user_id: keep.user_id },
    remove: others.map(m => ({ email: m.email || null, name: m.user_name || null, user_id: m.user_id, removed_already: !!m.removed_at })),
    connections: otherIds.length ? await db.collection('google_connections').countDocuments({ workspace_id: wid, user_id: { $in: otherIds } }) : 0,
    theirOutcomes: theirOutcomes.length,
    outcomesDeleted: deleteTheirOutcomes ? theirOutcomes.length : 0,
    invitesRevoked: await db.collection('workspace_invites').countDocuments({ workspace_id: wid, status: 'active' })
  };
  if (!apply) return report;

  if (otherIds.length) {
    const inWorkspace = { workspace_id: wid, user_id: { $in: otherIds } };
    if (deleteTheirOutcomes) {
      const ids = theirOutcomes.map(d => d.id);
      await db.collection('action_items').deleteMany({ workspace_id: wid, decision_id: { $in: ids } });
      await db.collection('decisions').deleteMany({ workspace_id: wid, id: { $in: ids } });
      const theirSpaces = await db.collection('workspace_spaces').find({ workspace_id: wid, personal_for: { $in: otherIds } }).project({ space_id: 1 }).toArray();
      const spaceIds = theirSpaces.map(s => s.space_id);
      await db.collection('action_items').deleteMany({ workspace_id: wid, space_id: { $in: spaceIds } });
      await db.collection('decisions').deleteMany({ workspace_id: wid, space_id: { $in: spaceIds } });
      await db.collection('workspace_spaces').deleteMany({ workspace_id: wid, space_id: { $in: spaceIds } });
    } else {
      // Their personal spaces have no members left: archive them
      await db.collection('workspace_spaces').updateMany(
        { workspace_id: wid, personal_for: { $in: otherIds } },
        { $set: { archived: true, archived_at: new Date().toISOString() } }
      );
    }
    await db.collection('google_connections').deleteMany(inWorkspace);
    await db.collection('space_members').deleteMany(inWorkspace);
    await db.collection('workspace_admins').deleteMany(inWorkspace);
    await members.deleteMany(inWorkspace);
    for (const userId of otherIds) {
      await db.collection('sessions').deleteMany({ session: { $regex: `"user_id":"${escapeRegex(userId)}"` } });
    }
    // Their Google account rows, unless they still belong to another workspace
    for (const otherEmail of otherEmails) {
      if (!await members.findOne({ email: otherEmail, removed_at: null })) {
        await db.collection('users').deleteOne({ email: otherEmail });
      }
    }
  }
  await db.collection('workspace_invites').updateMany({ workspace_id: wid, status: 'active' }, { $set: { status: 'revoked', revoked_at: new Date().toISOString() } });
  // The person kept is the workspace admin (same row sign-in writes for a workspace creator)
  await db.collection('workspace_admins').updateOne(
    { workspace_id: wid, user_id: keep.user_id },
    {
      $set: { role: 'admin', deactivated_at: null },
      $setOnInsert: { user_name: keep.user_name || keepEmail, email: keepEmail, created_at: new Date() }
    },
    { upsert: true }
  );
  await members.updateMany({ workspace_id: wid, user_id: keep.user_id, removed_at: null }, { $set: { role: 'admin' } });
  return report;
}

async function main() {
  const email = process.argv[2];
  if (!email || email.startsWith('--')) {
    console.error('Usage: node scripts/workspace-keep-only.js <email> [--workspace <id>] [--delete-their-outcomes] [--apply]');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const deleteTheirOutcomes = process.argv.includes('--delete-their-outcomes');
  process.env.NODE_ENV = process.env.NODE_ENV || 'script'; // skip the outbound-IP log
  await database.connectToMongoDB();

  const report = await keepOnlyMember({ email, workspaceId: argument('workspace'), apply, deleteTheirOutcomes });
  if (report.error) {
    console.error(`❌ ${report.error}`);
  } else {
    console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: workspace ${report.workspaceId}, keeping ${report.keep.email}\n`);
    console.log(`Members to remove (${report.remove.length}):`);
    report.remove.forEach(m => console.log(`   • ${m.email || '(no email)'}  ${m.name || ''}  [${m.user_id}]${m.removed_already ? '  (already marked removed)' : ''}`));
    console.log(`\nGoogle Meet connections to delete: ${report.connections}`);
    console.log(`Open invite links to revoke: ${report.invitesRevoked}`);
    console.log(`Outcomes captured by them: ${report.theirOutcomes} (${deleteTheirOutcomes ? 'will be DELETED' : 'kept; add --delete-their-outcomes to delete them'})`);
    if (!apply) console.log('\nRun again with --apply to make these changes.');
  }
  await database.closeMongoDB();
  if (report.error) process.exit(1);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
}

module.exports = { keepOnlyMember };
