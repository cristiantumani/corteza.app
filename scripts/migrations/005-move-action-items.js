/**
 * Migration 005: move AI-captured action items out of `decisions`.
 *
 * Extraction v2 briefly saved action items as decisions (type: 'action_item').
 * They now live in `action_items` (core/actions), with owners matched to
 * workspace members, so they can be filtered and followed up. This copies each
 * one there (status open, same space, source, due date, owner) and deletes the
 * decision. Idempotent: an item is only copied once (`migrated_from_decision`).
 *
 * Usage:
 *   node scripts/migrations/005-move-action-items.js           # dry run
 *   node scripts/migrations/005-move-action-items.js --apply   # write changes
 */
require('dotenv').config();
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { matchMember } = require('../../src/core/actions/owners');

const APPLY = process.argv.includes('--apply');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'decision-logger');
  const decisions = db.collection('decisions');
  const actionItems = db.collection('action_items');

  const legacy = await decisions.find({ type: 'action_item' }).toArray();
  console.log(`${APPLY ? '✍️  APPLY' : '🔎 DRY RUN'} — ${legacy.length} action item(s) stored as decisions\n`);

  const membersByWorkspace = new Map();
  for (const decision of legacy) {
    if (!membersByWorkspace.has(decision.workspace_id)) {
      membersByWorkspace.set(decision.workspace_id, await db.collection('workspace_members')
        .find({ workspace_id: decision.workspace_id, removed_at: null })
        .project({ user_id: 1, user_name: 1, email: 1 }).toArray());
    }
    const member = decision.owner_name ? matchMember(decision.owner_name, membersByWorkspace.get(decision.workspace_id)) : null;
    const owners = decision.owner_name
      ? [member ? { name: member.user_name, user_id: member.user_id, email: member.email || null } : { name: decision.owner_name, user_id: null, email: null }]
      : [];

    console.log(`➡️  ${decision.workspace_id} #${decision.id}: "${decision.text.slice(0, 80)}" (owner: ${owners[0]?.name || 'none'})`);
    if (!APPLY) continue;

    if (!await actionItems.findOne({ workspace_id: decision.workspace_id, migrated_from_decision: decision.id })) {
      const now = new Date();
      await actionItems.insertOne({
        item_id: `act_${crypto.randomBytes(10).toString('hex')}`,
        workspace_id: decision.workspace_id,
        space_id: decision.space_id,
        space_name: decision.space_name || null,
        text: decision.text,
        owners,
        owner_ids: owners.map(owner => owner.user_id).filter(Boolean),
        due_date: decision.due_date || null,
        status: 'open',
        decision_id: null,
        source: decision.source_details || null,
        rationale: decision.rationale || null,
        evidence_quote: decision.evidence_quote || null,
        capture: decision.capture || 'ai',
        confidence: decision.confidence ?? null,
        created_by: { user_id: decision.user_id || null, name: decision.creator || null },
        due_date_requested_at: now, // don't email owners about items from before this migration
        completed_at: null,
        migrated_from_decision: decision.id,
        created_at: decision.created_at || now,
        updated_at: now
      });
    }
    await decisions.deleteOne({ _id: decision._id });
  }

  if (!APPLY) console.log('\nNothing was written. Re-run with --apply to make the changes.');
  await client.close();
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
