/**
 * Moves everything a person can see into their personal space and archives the other spaces,
 * so they're left with one space (and no space controls in the app).
 *
 * For each other active space of their workspace (never a colleague's personal space):
 * its outcomes and action items move to the person's personal space, the space is
 * archived, and Google Meet connections that saved to it save to the personal space again.
 * The spaces touched are the ones their space picker shows: those they can access, or
 * every shared space of the workspace when they're its admin.
 *
 * Usage:
 *   node scripts/merge-into-personal.js you@company.com            # dry run: spaces and counts
 *   node scripts/merge-into-personal.js you@company.com --apply
 *   node scripts/merge-into-personal.js you@company.com --workspace ws_1   # when you're in several workspaces
 */
require('dotenv').config();
const database = require('../src/config/database');
const { ensurePersonalSpace } = require('../src/services/spaces');
const { getUserAccessibleSpaces, isAdmin } = require('../src/services/permissions');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

/**
 * Plans (and with apply, makes) the merge
 * @param {Object} options
 * @param {string} options.email
 * @param {string} [options.workspaceId]
 * @param {boolean} options.apply
 * @returns {Promise<Object>} { workspaceId, target, spaces: [{ name, space_id, outcomes, actionItems }] } or { error }
 */
async function mergeIntoPersonal({ email, workspaceId = null, apply }) {
  const db = database.getDatabase();
  const address = email.trim().toLowerCase();
  const memberships = await db.collection('workspace_members')
    .find({ email: address, removed_at: null, ...(workspaceId ? { workspace_id: workspaceId } : {}) }).toArray();
  const workspaceIds = [...new Set(memberships.map(m => m.workspace_id))];
  if (workspaceIds.length === 0) return { error: `${address} is not an active member of ${workspaceId || 'any workspace'}` };
  if (workspaceIds.length > 1) return { error: `${address} is in several workspaces (${workspaceIds.join(', ')}). Pass --workspace <id>.` };

  const wid = workspaceIds[0];
  const member = memberships[0];
  const admin = await isAdmin(null, wid, member.user_id);
  const accessible = admin ? null : await getUserAccessibleSpaces(null, wid, member.user_id);
  const others = await db.collection('workspace_spaces').find({
    workspace_id: wid,
    archived: false,
    ...(accessible ? { space_id: { $in: accessible } } : {}),
    $or: [{ personal_for: { $exists: false } }, { personal_for: null }]
  }).toArray();

  const report = { workspaceId: wid, target: null, spaces: [] };
  for (const space of others) {
    report.spaces.push({
      name: space.name,
      space_id: space.space_id,
      outcomes: await db.collection('decisions').countDocuments({ workspace_id: wid, space_id: space.space_id }),
      actionItems: await db.collection('action_items').countDocuments({ workspace_id: wid, space_id: space.space_id })
    });
  }
  if (!apply) return report;

  const target = await ensurePersonalSpace(wid, member.user_id, member.user_name || address);
  report.target = target.name;
  const set = { space_id: target.space_id, space_name: target.name };
  const now = new Date().toISOString();
  for (const space of others) {
    const inSpace = { workspace_id: wid, space_id: space.space_id };
    await db.collection('decisions').updateMany(inSpace, { $set: set });
    await db.collection('action_items').updateMany(inSpace, { $set: set });
    await db.collection('google_connections').updateMany({ workspace_id: wid, 'settings.space_id': space.space_id }, { $set: { 'settings.space_id': null } });
    await db.collection('workspace_spaces').updateOne({ _id: space._id }, { $set: { archived: true, archived_at: now, updated_at: now } });
  }
  return report;
}

async function main() {
  const email = process.argv[2];
  if (!email || email.startsWith('--')) {
    console.error('Usage: node scripts/merge-into-personal.js <email> [--workspace <id>] [--apply]');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  process.env.NODE_ENV = process.env.NODE_ENV || 'script'; // skip the outbound-IP log
  await database.connectToMongoDB();

  const report = await mergeIntoPersonal({ email, workspaceId: argument('workspace'), apply });
  if (report.error) {
    console.error(`❌ ${report.error}`);
  } else {
    console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: workspace ${report.workspaceId}, into ${email}'s personal space\n`);
    if (report.spaces.length === 0) console.log('Nothing to merge: the personal space is the only one.');
    report.spaces.forEach(s => console.log(`   • ${s.name}: ${s.outcomes} outcome(s), ${s.actionItems} action item(s) → moved, then the space is archived`));
    if (!apply && report.spaces.length) console.log('\nRun again with --apply to make these changes.');
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

module.exports = { mergeIntoPersonal };
