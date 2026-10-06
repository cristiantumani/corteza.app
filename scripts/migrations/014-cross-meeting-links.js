/**
 * Migration 014: cross-meeting links for outcomes already waiting for review
 * (docs/specs/2026-10-cross-meeting-links.md).
 *
 * New meetings are linked when they're captured. This runs the same linking for meetings whose
 * outcomes are still waiting for review, so today's review queue gets "This may close" too:
 * each such meeting's outcomes and action items are compared with open items from earlier
 * meetings (embeddings, then Claude), threads are joined and `resolves` is saved on the
 * decisions. Nothing is closed: people confirm on the review card.
 *
 * One workspace at a time, by its Google domain. Meetings already checked are skipped
 * (`links_checked_at`), so it's safe to run twice. It calls Claude (one call per meeting with
 * candidates) even as a dry run, because that's how links are found; the dry run writes nothing.
 * Output has ids and counts; --show-text adds the first words of each link (meeting content:
 * for your own terminal, don't paste it).
 *
 * Usage:
 *   node scripts/migrations/014-cross-meeting-links.js --domain ninjaexcel.com              # dry run
 *   node scripts/migrations/014-cross-meeting-links.js --domain ninjaexcel.com --show-text
 *   node scripts/migrations/014-cross-meeting-links.js --domain ninjaexcel.com --apply [--limit 20]
 */
require('dotenv').config();
const { connectToMongoDB, closeMongoDB, getDatabase } = require('../../src/config/database');
const { linkAcrossMeetings } = require('../../src/core/links/cross-meeting');
const { getUserAccessibleSpaces } = require('../../src/services/permissions');

/**
 * Meetings with outcomes waiting for review that weren't checked yet, oldest first
 * @param {import('mongodb').Db} db
 * @param {string} workspaceId
 * @returns {Promise<{ meetingId: string, ownerId: string|null, occurredAt: string|null, decisions: Object[] }[]>}
 */
async function pendingMeetings(db, workspaceId) {
  const pending = await db.collection('decisions').find(
    { workspace_id: workspaceId, capture: 'ai', review_status: null, links_checked_at: null, 'source_details.external_id': { $exists: true } },
    { projection: { _id: 0, embedding: 0 } }
  ).toArray();
  const meetings = new Map();
  for (const decision of pending) {
    const key = `${decision.user_id || ''}|${decision.source_details.external_id}`;
    if (!meetings.has(key)) {
      meetings.set(key, {
        meetingId: decision.source_details.external_id,
        ownerId: decision.user_id || null,
        occurredAt: decision.source_details.occurred_at || decision.timestamp || null,
        decisions: []
      });
    }
    meetings.get(key).decisions.push(decision);
  }
  return [...meetings.values()].sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
}

/**
 * Links each pending meeting to earlier ones
 * @param {import('mongodb').Db} db
 * @param {Object} options
 * @param {string} options.workspaceId
 * @param {boolean} options.apply
 * @param {number} [options.limit] - meetings at most
 * @param {Object} [deps] - passed to linkAcrossMeetings (tests: embed, judge)
 * @returns {Promise<{ meetings: number, linked: number, links: number, resolves: number, details: Object[] }>}
 */
async function linkPendingMeetings(db, { workspaceId, apply, limit = Infinity }, deps = {}) {
  const meetings = (await pendingMeetings(db, workspaceId)).slice(0, limit);
  const totals = { meetings: meetings.length, linked: 0, links: 0, resolves: 0, details: [] };
  for (const meeting of meetings) {
    const actionItems = await db.collection('action_items').find(
      { workspace_id: workspaceId, 'source.external_id': meeting.meetingId, ...(meeting.ownerId ? { 'created_by.user_id': meeting.ownerId } : {}) },
      { projection: { _id: 0, embedding: 0 } }
    ).toArray();
    const spaceIds = meeting.ownerId
      ? await getUserAccessibleSpaces(null, workspaceId, meeting.ownerId)
      : [...new Set(meeting.decisions.map(d => d.space_id))];
    const result = await linkAcrossMeetings({
      workspaceId, spaceIds, ownerId: meeting.ownerId, meetingId: meeting.meetingId,
      occurredAt: meeting.occurredAt, decisions: meeting.decisions, actionItems
    }, { ...deps, apply });
    if (apply) {
      await db.collection('decisions').updateMany(
        { workspace_id: workspaceId, id: { $in: meeting.decisions.map(d => d.id) } },
        { $set: { links_checked_at: new Date() } }
      );
    }
    if (result.links.length) totals.linked++;
    totals.links += result.links.length;
    totals.resolves += result.resolves;
    totals.details.push({ meetingId: meeting.meetingId, candidates: result.candidates, links: result.links });
  }
  return totals;
}

async function main() {
  const arg = name => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : undefined; };
  const apply = process.argv.includes('--apply');
  const showText = process.argv.includes('--show-text');
  const domain = (arg('--domain') || '').toLowerCase();
  const limit = Number(arg('--limit')) || Infinity;
  if (!domain) throw new Error('Pass --domain <google domain>, e.g. --domain ninjaexcel.com');

  await connectToMongoDB();
  const db = getDatabase();
  const workspace = await db.collection('workspaces').findOne({ google_domain: domain });
  if (!workspace) throw new Error(`No workspace with domain ${domain}`);

  const totals = await linkPendingMeetings(db, { workspaceId: workspace.workspace_id, apply, limit });
  console.log(`${apply ? '✍️  APPLY' : '🔎 DRY RUN'}: ${totals.meetings} meeting(s) with outcomes to review`);
  for (const meeting of totals.details) {
    if (!meeting.links.length) continue;
    console.log(`\n   meeting ${meeting.meetingId}: ${meeting.candidates} candidate(s), ${meeting.links.length} link(s)`);
    for (const link of meeting.links) {
      const words = text => String(text || '').split(/\s+/).slice(0, 8).join(' ');
      const label = `${link.newItem.kind} ${link.newItem.id} → ${link.earlier.kind} ${link.earlier.id} (${link.relation})`;
      console.log(`     ${label}${showText ? `  "${words(link.newItem.text)}…" → "${words(link.earlier.text)}…"` : ''}`);
    }
  }
  console.log(`\n   ${totals.linked} meeting(s) linked · ${totals.links} link(s) · ${totals.resolves} may close`);
  if (!apply && totals.links) console.log('\nRun again with --apply to save them.');
  await closeMongoDB();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  });
}

module.exports = { pendingMeetings, linkPendingMeetings };
