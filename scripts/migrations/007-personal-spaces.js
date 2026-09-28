/**
 * Migration 007: every member gets a personal space, and "General" is split up.
 *
 * Outcomes used to land in "General", a public space every colleague could see.
 * Now each member has a private personal space (services/spaces.js ensurePersonalSpace).
 * For each workspace this:
 *   - creates the personal space of every active member;
 *   - one member: moves everything in General (outcomes and action items) to their
 *     personal space and archives General;
 *   - several members: moves each outcome in General to the personal space of the
 *     member who captured it (`user_id`), with its action items; the rest stays in General;
 *   - Google Meet connections that saved to General save to the personal space again.
 * Idempotent: running it twice finds nothing left to move.
 *
 * Usage:
 *   node scripts/migrations/007-personal-spaces.js                        # dry run, all workspaces
 *   node scripts/migrations/007-personal-spaces.js --workspace ws_123     # dry run, one workspace
 *   node scripts/migrations/007-personal-spaces.js --apply                # write changes
 */
require('dotenv').config();
const database = require('../../src/config/database');
const { ensurePersonalSpace, PERSONAL_SPACE_NAME } = require('../../src/services/spaces');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

/**
 * Plans (and with apply, makes) the changes for every workspace, or one
 * @param {Object} options
 * @param {boolean} options.apply
 * @param {string} [options.workspaceId]
 * @returns {Promise<Object[]>} one report per workspace
 */
async function migrate({ apply, workspaceId = null }) {
  const db = database.getDatabase();
  const members = db.collection('workspace_members');
  const spaces = db.collection('workspace_spaces');
  const decisions = db.collection('decisions');
  const actionItems = db.collection('action_items');

  const workspaceIds = workspaceId ? [workspaceId] : await members.distinct('workspace_id', { removed_at: null });
  const reports = [];

  for (const wid of workspaceIds) {
    const active = await members.find({ workspace_id: wid, removed_at: null }).project({ user_id: 1, user_name: 1, email: 1 }).toArray();
    const people = [...new Map(active.map(m => [m.user_id, m])).values()];
    if (people.length === 0) continue;

    const report = { workspaceId: wid, members: people.map(p => p.email || p.user_id), personalSpacesCreated: 0, moved: 0, actionItemsMoved: 0, generalArchived: false, connectionsReset: 0 };
    const missing = [];
    for (const person of people) {
      if (!await spaces.findOne({ workspace_id: wid, personal_for: person.user_id })) missing.push(person);
    }
    report.personalSpacesCreated = missing.length;

    const personal = new Map();
    if (apply) {
      for (const person of people) {
        personal.set(person.user_id, await ensurePersonalSpace(wid, person.user_id, person.user_name || person.email));
      }
    }

    const general = await spaces.findOne({ workspace_id: wid, is_default: true, archived: false, personal_for: { $in: [null] } });
    if (general) {
      const single = people.length === 1;
      const inGeneral = await decisions.find({ workspace_id: wid, space_id: general.space_id }).project({ id: 1, user_id: 1 }).toArray();
      // Decision number → whose personal space it goes to
      const destination = new Map();
      for (const decision of inGeneral) {
        const owner = single ? people[0].user_id : people.find(p => p.user_id === decision.user_id)?.user_id;
        if (owner) destination.set(decision.id, owner);
      }
      report.moved = destination.size;
      report.actionItemsMoved = await actionItems.countDocuments(single
        ? { workspace_id: wid, space_id: general.space_id }
        : { workspace_id: wid, space_id: general.space_id, decision_id: { $in: [...destination.keys()] } });
      report.generalArchived = single;

      if (apply) {
        for (const person of people) {
          const ids = [...destination].filter(([, owner]) => owner === person.user_id).map(([id]) => id);
          if (ids.length === 0 && !single) continue;
          const target = personal.get(person.user_id);
          const set = { space_id: target.space_id, space_name: target.name || PERSONAL_SPACE_NAME };
          await decisions.updateMany({ workspace_id: wid, space_id: general.space_id, id: { $in: ids } }, { $set: set });
          await actionItems.updateMany(
            single ? { workspace_id: wid, space_id: general.space_id } : { workspace_id: wid, space_id: general.space_id, decision_id: { $in: ids } },
            { $set: set }
          );
        }
        if (single) {
          await spaces.updateOne({ _id: general._id }, { $set: { archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
        }
      }

      const pointing = { workspace_id: wid, 'settings.space_id': general.space_id };
      report.connectionsReset = await db.collection('google_connections').countDocuments(pointing);
      if (apply && report.connectionsReset) {
        await db.collection('google_connections').updateMany(pointing, { $set: { 'settings.space_id': null } });
      }
    }
    reports.push(report);
  }
  return reports;
}

async function main() {
  const apply = process.argv.includes('--apply');
  process.env.NODE_ENV = process.env.NODE_ENV || 'script'; // skip the outbound-IP log
  await database.connectToMongoDB();

  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: personal spaces\n`);
  const reports = await migrate({ apply, workspaceId: argument('workspace') });
  for (const r of reports) {
    console.log(`• ${r.workspaceId} (${r.members.length} member${r.members.length === 1 ? '' : 's'}: ${r.members.join(', ')})`);
    console.log(`    personal spaces to create: ${r.personalSpacesCreated}`);
    console.log(`    outcomes moved out of General: ${r.moved}, action items: ${r.actionItemsMoved}${r.generalArchived ? ', then General is archived' : ''}`);
    if (r.connectionsReset) console.log(`    Google Meet connections switched from General to the personal space: ${r.connectionsReset}`);
  }
  if (!apply) console.log('\nRun again with --apply to make these changes.');
  await database.closeMongoDB();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { migrate };
