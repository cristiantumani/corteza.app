const crypto = require('crypto');
const {
  getDatabase,
  getDecisionsCollection,
  getWorkspaceMembersCollection,
  getWorkspaceSpacesCollection
} = require('../config/database');
const { getUserAccessibleSpaces } = require('../services/permissions');
const { sendWeeklyDigestEmail } = require('../utils/n8n-client');

/**
 * Weekly decision digest, replacing the n8n "Weekly Team Digest" workflow.
 *
 * Every Monday (DIGEST_HOUR_UTC, default 09:00 UTC) each workspace member with an
 * email gets a summary of last week's decisions (Monday–Sunday, UTC), limited to
 * the spaces they can access. Enable with WEEKLY_DIGEST_ENABLED=true.
 *
 * Each workspace/week is claimed with a unique insert into `digest_runs`, so the
 * digest goes out once even with several app instances or restarts.
 */

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Hourly
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the Monday 00:00 UTC that starts the week containing `date`
 */
function startOfWeekUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - daysSinceMonday * DAY_MS);
}

/**
 * Digest period for a run at `now`: the previous full week, plus the week before for comparison
 */
function getDigestPeriod(now = new Date()) {
  const end = startOfWeekUTC(now);
  const start = new Date(end.getTime() - 7 * DAY_MS);
  const previousStart = new Date(start.getTime() - 7 * DAY_MS);
  const format = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return {
    start,
    end,
    previousStart,
    weekKey: start.toISOString().slice(0, 10),
    label: `${format(start)} – ${format(new Date(end.getTime() - DAY_MS))}`
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    for (const key of [].concat(keyFn(item))) {
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/**
 * Builds the digest content from a member's decisions for the period
 * @param {Object[]} decisions - Decisions from the digest week, newest first
 * @param {number} previousCount - Number of decisions the week before
 * @param {Map<string,string>} spaceNames - space_id → name
 */
function buildDigestStats(decisions, previousCount, spaceNames, periodLabel) {
  return {
    periodLabel,
    thisWeek: decisions.length,
    previousWeek: previousCount,
    change: decisions.length - previousCount,
    byType: countBy(decisions, d => d.type || 'decision'),
    topContributors: countBy(decisions, d => d.creator || 'Unknown').slice(0, 5),
    topTags: countBy(decisions, d => d.tags || []).slice(0, 10),
    recent: decisions.slice(0, 5).map(d => ({
      text: d.text && d.text.length > 200 ? `${d.text.slice(0, 197)}...` : (d.text || ''),
      creator: d.creator || 'Unknown',
      space: spaceNames.get(d.space_id) || null
    }))
  };
}

function signUnsubscribe(workspaceId, userId) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(`digest-unsubscribe:${workspaceId}:${userId}`)
    .digest('hex');
}

function verifyUnsubscribe(workspaceId, userId, token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  const expected = Buffer.from(signUnsubscribe(workspaceId, userId), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(token, 'hex'));
}

function getUnsubscribeUrl(workspaceId, userId) {
  const baseUrl = process.env.BASE_URL || 'https://app.corteza.app';
  const params = new URLSearchParams({ w: workspaceId, u: userId, t: signUnsubscribe(workspaceId, userId) });
  return `${baseUrl}/digest/unsubscribe?${params}`;
}

/**
 * Sends the digest for one workspace to every subscribed member
 * @returns {Promise<number>} Number of emails sent
 */
async function sendWorkspaceDigest(workspaceId, period) {
  const decisionsCollection = getDecisionsCollection();

  const members = await getWorkspaceMembersCollection().find({
    workspace_id: workspaceId,
    removed_at: null,
    email: { $nin: [null, ''] },
    digest_opt_out: { $ne: true }
  }).toArray();

  if (members.length === 0) return 0;

  const spaces = await getWorkspaceSpacesCollection().find({ workspace_id: workspaceId }).toArray();
  const spaceNames = new Map(spaces.map(s => [s.space_id, s.name]));

  let sent = 0;
  for (const member of members) {
    try {
      // Only summarize spaces this member can see (private spaces stay private)
      const spaceIds = await getUserAccessibleSpaces(null, workspaceId, member.user_id);
      if (spaceIds.length === 0) continue;

      const baseQuery = { workspace_id: workspaceId, space_id: { $in: spaceIds } };
      const [decisions, previousCount] = await Promise.all([
        decisionsCollection
          .find({ ...baseQuery, timestamp: { $gte: period.start.toISOString(), $lt: period.end.toISOString() } })
          .sort({ timestamp: -1 })
          .toArray(),
        decisionsCollection.countDocuments({
          ...baseQuery,
          timestamp: { $gte: period.previousStart.toISOString(), $lt: period.start.toISOString() }
        })
      ]);

      // Don't send empty digests
      if (decisions.length === 0) continue;

      await sendWeeklyDigestEmail({
        email: member.email,
        workspace_name: member.workspace_name || workspaceId,
        stats: buildDigestStats(decisions, previousCount, spaceNames, period.label),
        unsubscribe_url: getUnsubscribeUrl(workspaceId, member.user_id)
      });
      sent++;
    } catch (error) {
      console.error(`❌ Weekly digest failed for ${member.email} in ${workspaceId}:`, error.message);
      // Continue with the next member
    }
  }

  return sent;
}

/**
 * Sends last week's digest to every workspace that hasn't had it yet.
 * Does nothing before DIGEST_HOUR_UTC on Monday; later in the week it catches up
 * on a missed run (e.g. the app was down on Monday morning).
 */
async function runWeeklyDigest(now = new Date()) {
  try {
    const period = getDigestPeriod(now);
    const digestHour = parseInt(process.env.DIGEST_HOUR_UTC || '9', 10);
    if (now.getTime() < period.end.getTime() + digestHour * 60 * 60 * 1000) {
      return;
    }

    const runsCollection = getDatabase().collection('digest_runs');

    // Workspaces with activity last week
    const workspaceIds = await getDecisionsCollection().distinct('workspace_id', {
      timestamp: { $gte: period.start.toISOString(), $lt: period.end.toISOString() }
    });

    for (const workspaceId of workspaceIds) {
      // Claim this workspace/week; a duplicate key means another run already took it
      try {
        await runsCollection.insertOne({
          workspace_id: workspaceId,
          week_start: period.weekKey,
          started_at: new Date()
        });
      } catch (error) {
        if (error.code === 11000) continue;
        throw error;
      }

      const sent = await sendWorkspaceDigest(workspaceId, period);
      await runsCollection.updateOne(
        { workspace_id: workspaceId, week_start: period.weekKey },
        { $set: { finished_at: new Date(), emails_sent: sent } }
      );
      console.log(`📊 Weekly digest for ${workspaceId} (${period.weekKey}): ${sent} email(s) sent`);
    }
  } catch (error) {
    console.error('❌ Weekly digest job failed:', error.message);
  }
}

function startWeeklyDigestJob() {
  if (process.env.WEEKLY_DIGEST_ENABLED !== 'true') {
    console.log('⏸️  Weekly digest disabled (set WEEKLY_DIGEST_ENABLED=true to enable)');
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  Weekly digest enabled but RESEND_API_KEY is not configured — skipping');
    return;
  }

  // Wait 5 minutes after server start before first check (let DB stabilize)
  setTimeout(() => {
    runWeeklyDigest();
    setInterval(runWeeklyDigest, CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);

  console.log('⏰ Weekly digest job scheduled (checks hourly, sends Mondays)');
}

module.exports = {
  startWeeklyDigestJob,
  runWeeklyDigest,
  sendWorkspaceDigest,
  buildDigestStats,
  getDigestPeriod,
  getUnsubscribeUrl,
  verifyUnsubscribe
};
