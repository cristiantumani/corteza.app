const { getDatabase, getDecisionsCollection, getWorkspaceMembersCollection } = require('../config/database');
const { getUserAccessibleSpaces } = require('../services/permissions');
const { PENDING_REVIEW } = require('../core/decisions/review-service');
const { getUnsubscribeUrl } = require('./weekly-digest');

/**
 * Daily digest: one end-of-day email per person with what happened, instead of one
 * email per meeting.
 *
 * Mon–Fri at DAILY_DIGEST_HOUR_UTC (default 22:00 UTC, early evening in Latin America),
 * each member gets their own numbers:
 * - meetings Corteza captured for them and the outcomes in them (imports of past meetings
 *   don't count),
 * - action items newly assigned to them,
 * - reminders: outcomes waiting for review in their spaces, and their overdue and undated
 *   open action items.
 *
 * Counts only, no meeting content, with links into Corteza. Sent only on days with
 * something new (a meeting or a new action item), so reminders never arrive alone.
 * The window runs from the person's previous digest check (at most 72 hours back), so
 * Monday's email covers the weekend. Each person/day is claimed with a unique insert into
 * `daily_digests`, so it's sent once even with several app instances.
 *
 * On by default when RESEND_API_KEY is set; DAILY_DIGEST_ENABLED=false turns it off.
 * People opt out with the link in the email (`daily_digest_opt_out` on the membership).
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MAX_WINDOW_MS = 72 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

function digestHour() {
  const hour = parseInt(process.env.DAILY_DIGEST_HOUR_UTC || '22', 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 22;
}

/**
 * The day to send for, or null when it isn't time (weekend, or before the send hour)
 * @param {Date} now
 * @returns {string|null} 'YYYY-MM-DD' (UTC)
 */
function digestDay(now) {
  const weekday = now.getUTCDay();
  if (weekday === 0 || weekday === 6) return null;
  if (now.getUTCHours() < digestHour()) return null;
  return now.toISOString().slice(0, 10);
}

/**
 * One person's numbers since `since`
 * @param {string} workspaceId
 * @param {string} userId
 * @param {Date} since
 * @param {Date} now
 * @returns {Promise<{ meetings: number, outcomes: Object, newActionItems: number, toReview: number, overdue: number, noDueDate: number }>}
 */
async function buildDailySummary(workspaceId, userId, since, now) {
  const db = getDatabase();
  const today = now.toISOString().slice(0, 10);
  const spaceIds = await getUserAccessibleSpaces(null, workspaceId, userId);

  const [ingestions, newActionItems, overdue, noDueDate, toReview] = await Promise.all([
    db.collection('ingestions').find(
      { workspace_id: workspaceId, user_id: userId, status: 'completed', manual: { $ne: true }, completed_at: { $gte: since, $lte: now } },
      { projection: { outcomes_by_type: 1 } }
    ).toArray(),
    db.collection('action_items').countDocuments({ workspace_id: workspaceId, owner_ids: userId, created_at: { $gte: since, $lte: now } }),
    db.collection('action_items').countDocuments({ workspace_id: workspaceId, owner_ids: userId, status: 'open', due_date: { $ne: null, $lt: today } }),
    db.collection('action_items').countDocuments({ workspace_id: workspaceId, owner_ids: userId, status: 'open', due_date: null }),
    spaceIds.length
      ? getDecisionsCollection().countDocuments({ workspace_id: workspaceId, space_id: { $in: spaceIds }, ...PENDING_REVIEW })
      : 0
  ]);

  const outcomes = {};
  for (const ingestion of ingestions) {
    for (const [type, count] of Object.entries(ingestion.outcomes_by_type || {})) {
      outcomes[type] = (outcomes[type] || 0) + count;
    }
  }
  return { meetings: ingestions.length, outcomes, newActionItems, toReview, overdue, noDueDate };
}

/** Something new happened: reminders alone never trigger an email */
function hasNews(summary) {
  return summary.meetings > 0 || summary.newActionItems > 0;
}

/**
 * Claims one person's digest for a day; null if another run already did
 * @returns {Promise<Date|null>} start of the window (the previous check, at most 72 h back)
 */
async function claimDay(workspaceId, userId, day, now) {
  const digests = getDatabase().collection('daily_digests');
  const [previous] = await digests.find({ workspace_id: workspaceId, user_id: userId })
    .sort({ checked_at: -1 }).limit(1).toArray();
  try {
    // Only the run that creates the row sends (the unique index also guards concurrent runs)
    const result = await digests.updateOne(
      { workspace_id: workspaceId, user_id: userId, day },
      { $setOnInsert: { checked_at: now, sent: false } },
      { upsert: true }
    );
    if (!result.upsertedCount) return null;
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
  const floor = new Date(now.getTime() - MAX_WINDOW_MS);
  const since = previous ? new Date(previous.checked_at) : new Date(now.getTime() - DEFAULT_WINDOW_MS);
  return since < floor ? floor : since;
}

/**
 * Sends today's digests that haven't been sent yet
 * @param {Date} [now]
 * @param {Object} [deps] - { send } injectable for tests
 * @returns {Promise<{ checked: number, sent: number }>}
 */
async function runDailyDigest(now = new Date(), { send = defaultSend } = {}) {
  const day = digestDay(now);
  if (!day) return { checked: 0, sent: 0 };

  const members = await getWorkspaceMembersCollection().find(
    { removed_at: null, email: { $nin: [null, ''] }, daily_digest_opt_out: { $ne: true } },
    { projection: { workspace_id: 1, user_id: 1, email: 1, workspace_name: 1 } }
  ).toArray();

  let checked = 0;
  let sent = 0;
  const dayLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  for (const member of members) {
    try {
      const since = await claimDay(member.workspace_id, member.user_id, day, now);
      if (!since) continue;
      checked++;
      const summary = await buildDailySummary(member.workspace_id, member.user_id, since, now);
      if (!hasNews(summary)) continue;

      await send({
        email: member.email,
        workspace_name: member.workspace_name || member.workspace_id,
        summary: { ...summary, dayLabel },
        unsubscribe_url: getUnsubscribeUrl(member.workspace_id, member.user_id, 'daily')
      });
      await getDatabase().collection('daily_digests').updateOne(
        { workspace_id: member.workspace_id, user_id: member.user_id, day },
        { $set: { sent: true, sent_at: new Date(), summary } }
      );
      sent++;
    } catch (error) {
      console.error(`❌ Daily digest failed for ${member.user_id} in ${member.workspace_id}:`, error.message);
    }
  }
  if (sent > 0) console.log(`📬 Daily digest (${day}): ${sent} email(s) sent, ${checked} people checked`);
  return { checked, sent };
}

async function defaultSend(params) {
  const { sendDailyDigestEmail } = require('../utils/n8n-client');
  await sendDailyDigestEmail(params);
}

function startDailyDigestJob() {
  if (process.env.DAILY_DIGEST_ENABLED === 'false') {
    console.log('⏸️  Daily digest disabled (DAILY_DIGEST_ENABLED=false)');
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  Daily digest needs RESEND_API_KEY — skipping');
    return;
  }
  const run = () => runDailyDigest().catch(error => console.error('❌ Daily digest job failed:', error.message));
  setTimeout(() => {
    run();
    setInterval(run, CHECK_INTERVAL_MS);
  }, 2 * 60 * 1000);
  console.log(`⏰ Daily digest scheduled (Mon–Fri from ${digestHour()}:00 UTC)`);
}

module.exports = {
  startDailyDigestJob,
  runDailyDigest,
  buildDailySummary,
  digestDay,
  hasNews
};
