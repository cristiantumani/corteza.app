/**
 * Migration 001: give every workspace a default space and move decisions
 * that have no space into it.
 *
 * Why: until Phase 0, Slack /decision, Slack AI approvals and the Obsidian import
 * saved decisions without a space_id, and new workspaces had no spaces at all.
 * The dashboard filters by space, so those decisions were invisible.
 *
 * Idempotent: safe to run more than once.
 *
 * Usage:
 *   node scripts/migrations/001-backfill-default-spaces.js           # dry run
 *   node scripts/migrations/001-backfill-default-spaces.js --apply   # write changes
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const APPLY = process.argv.includes('--apply');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'decision-logger');
  const decisions = db.collection('decisions');
  const spaces = db.collection('workspace_spaces');
  const members = db.collection('workspace_members');

  const workspaceIds = new Set([
    ...await decisions.distinct('workspace_id'),
    ...await members.distinct('workspace_id', { removed_at: null })
  ]);

  console.log(`${APPLY ? '✍️  APPLY' : '🔎 DRY RUN'} — ${workspaceIds.size} workspace(s)\n`);

  let spacesCreated = 0;
  let decisionsMoved = 0;

  for (const workspaceId of workspaceIds) {
    if (!workspaceId) continue;

    let space = await spaces.findOne({ workspace_id: workspaceId, is_default: true });
    if (!space) {
      const now = new Date().toISOString();
      space = {
        space_id: `sp_${crypto.randomBytes(12).toString('hex')}`,
        workspace_id: workspaceId,
        name: 'General',
        description: 'Default space for all team decisions',
        visibility: 'public',
        created_by: 'system',
        created_by_name: 'System',
        created_at: now,
        updated_at: now,
        is_default: true,
        archived: false,
        archived_at: null,
        settings: { color: '#667eea', icon: '🏠' }
      };
      if (APPLY) await spaces.insertOne(space);
      spacesCreated++;
      console.log(`🏠 ${workspaceId}: default space ${APPLY ? 'created' : 'would be created'}`);
    }

    const missingSpace = { workspace_id: workspaceId, $or: [{ space_id: null }, { space_id: { $exists: false } }] };
    const count = await decisions.countDocuments(missingSpace);
    if (count > 0) {
      if (APPLY) {
        await decisions.updateMany(missingSpace, { $set: { space_id: space.space_id, space_name: space.name } });
      }
      decisionsMoved += count;
      console.log(`📝 ${workspaceId}: ${count} decision(s) ${APPLY ? 'moved' : 'would be moved'} to "${space.name}"`);
    }
  }

  console.log(`\nDone. Default spaces: ${spacesCreated}. Decisions moved: ${decisionsMoved}.`);
  if (!APPLY) console.log('Nothing was written. Re-run with --apply to make the changes.');
  await client.close();
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
