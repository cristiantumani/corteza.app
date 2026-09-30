const { getDatabase, getDecisionsCollection, getWorkspaceMembersCollection } = require('../config/database');
const { getUserAccessibleSpaces } = require('../services/permissions');
const { PENDING_REVIEW } = require('../core/decisions/review-service');
const { isValidTimeZone, localTime } = require('../core/users/timezone');
const { getUnsubscribeUrl } = require('./weekly-digest');

/**
 * Daily digest: one morning email per person with what happened since their last one, to
 * plan the day, instead of one email per meeting.
 *
 * Mon–Fri at DAILY_DIGEST_HOUR (default 8:00) in each person's own time zone, each member
 * gets their own numbers:
 * - meetings Corteza captured for them and the outcomes in them (imports of past meetings
 *   don't count),
 * - action items newly assigned to them, and their open ones due today,
 * - reminders: outcomes waiting for review in their spaces, and their overdue and undated
 *   open action items.
 *
 * Counts, plus the text of the person's own action items due today or overdue (up to
 * PLAN_ITEMS, each linking to it in Corteza, like a task list). Nothing else from meetings:
 * no decisions, no colleagues' items, no transcript. The item text is not stored in
 * `daily_digests`. Sent only when there's something new or due today, so reminders never
 * arrive alone.
 *
 * Time zone: the membership's `timezone` (reported by the browser or set in Settings; see
 * core/users/timezone.js). Without one, the most common time zone among the workspace's
 * members, else DAILY_DIGEST_DEFAULT_TIMEZONE (default UTC). The email goes out within
 * SEND_WINDOW_HOURS after the hour (a restart or deploy doesn't skip a day, and nobody gets
 * a "morning" summary in the afternoon).
 *
 * The window runs from the person's previous digest check (at most 72 hours back), so
 * Monday's email covers the weekend. Each person/day (their local date) is claimed with a
 * unique insert into `daily_digests`, so it's sent once even with several app instances.
 *
 * On by default when RESEND_API_KEY is set; DAILY_DIGEST_ENABLED=false turns it off.
 * People opt out with the link in the email (`daily_digest_opt_out` on the membership).
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MAX_WINDOW_MS = 72 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEND_WINDOW_HOURS = 4;
const PLAN_ITEMS = 5;

function digestHour() {
  const hour = parseInt(process.env.DAILY_DIGEST_HOUR || '8', 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8;
}

function defaultTimeZone() {
  const zone = process.env.DAILY_DIGEST_DEFAULT_TIMEZONE;
  return isValidTimeZone(zone) ? zone : 'UTC';
}

/**
 * The local day to send for, or null when it isn't time there (weekend, before the send
 * hour, or past the send window)
 * @param {Date} now
 * @param {string} [timeZone] - IANA name; UTC when missing
 * @returns {string|null} 'YYYY-MM-DD' in that time zone
 */
function digestDay(now, timeZone = 'UTC') {
  const local = localTime(now, timeZone);
  if (local.weekday === 0 || local.weekday === 6) return null;
  const hour = digestHour();
  if (local.hour < hour || local.hour >= hour + SEND_WINDOW_HOURS) return null;
  return local.date;
}

/**
 * The time zone each member's digest uses: their own, else their workspace's most common
 * one, else the default
 * @param {Object[]} members - { workspace_id, timezone }
 * @returns {(member: Object) => string}
 */
function timeZoneResolver(members) {
  const counts = new Map();
  for (const member of members) {
    if (!isValidTimeZone(member.timezone)) continue;
    const byZone = counts.get(member.workspace_id) || new Map();
    byZone.set(member.timezone, (byZone.get(member.timezone) || 0) + 1);
    counts.set(member.workspace_id, byZone);
  }
  const workspaceZone = new Map();
  for (const [workspaceId, byZone] of counts) {
    workspaceZone.set(workspaceId, [...byZone.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  }
  const fallback = defaultTimeZone();
  return member => (isValidTimeZone(member.timezone) ? member.timezone : workspaceZone.get(member.workspace_id) || fallback);
}

/**
 * How the email names the start of its window: 'yesterday', or the weekday ('Friday')
 * @param {Date} since
 * @param {Date} now
 * @param {string} timeZone
 * @returns {string}
 */
function sinceLabel(since, now, timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const yesterday = new Date(`${localTime(now, zone).date}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (localTime(since, zone).date >= yesterday.toISOString().slice(0, 10)) return 'yesterday';
  return since.toLocaleDateString('en-US', { weekday: 'long', timeZone: zone });
}

/**
 * One person's numbers since `since`
 * @param {string} workspaceId
 * @param {string} userId
 * @param {Date} since
 * @param {Date} now
 * @param {string} [timeZone] - "today" (due today, overdue) is the person's local date
 * @returns {Promise<{ meetings: number, outcomes: Object, newActionItems: number, dueToday: number, toReview: number, overdue: number, noDueDate: number, planItems: Object[] }>}
 *   planItems: the person's open items due today, then the most recently overdue
 *   ({ item_id, text, due_date, meeting }), at most PLAN_ITEMS
 */
async function buildDailySummary(workspaceId, userId, since, now, timeZone = 'UTC') {
  const db = getDatabase();
  const today = localTime(now, timeZone).date;
  const spaceIds = await getUserAccessibleSpaces(null, workspaceId, userId);

  const [ingestions, newActionItems, dueToday, overdue, noDueDate, toReview, dueItems] = await Promise.all([
    db.collection('ingestions').find(
      { workspace_id: workspaceId, user_id: userId, status: 'completed', manual: { $ne: true }, completed_at: { $gte: since, $lte: now } },
      { projection: { outcomes_by_type: 1 } }
    ).toArray(),
    db.collection('action_items').countDocuments({ workspace_id: workspaceId, owner_ids: userId, created_at: { $gte: since, $lte: now } }),
    db.collection('action_items').countDocuments({ workspace_id: workspaceId, owner_ids: userId, status: 'open', due_date: today }),
    db.collection('action_items').countDocuments({ workspace_id: workspaceId, owner_ids: userId, status: 'open', due_date: { $ne: null, $lt: today } }),
    db.collection('action_items').countDocuments({ workspace_id: workspaceId, owner_ids: userId, status: 'open', due_date: null }),
    spaceIds.length
      ? getDecisionsCollection().countDocuments({ workspace_id: workspaceId, space_id: { $in: spaceIds }, ...PENDING_REVIEW })
      : 0,
    db.collection('action_items').find(
      { workspace_id: workspaceId, owner_ids: userId, status: 'open', due_date: { $ne: null, $lte: today } },
      { projection: { _id: 0, item_id: 1, text: 1, due_date: 1, 'source.title': 1 } }
    ).sort({ due_date: -1, created_at: -1 }).limit(PLAN_ITEMS * 3).toArray()
  ]);

  // Colleagues in the same meeting each capture the item: show it once
  const seen = new Set();
  const planItems = [];
  for (const item of dueItems) {
    const key = `${String(item.text || '').trim().toLowerCase()}|${item.due_date}`;
    if (!item.text || seen.has(key)) continue;
    seen.add(key);
    planItems.push({ item_id: item.item_id, text: item.text, due_date: item.due_date, meeting: (item.source && item.source.title) || null });
    if (planItems.length === PLAN_ITEMS) break;
  }

  const outcomes = {};
  for (const ingestion of ingestions) {
    for (const [type, count] of Object.entries(ingestion.outcomes_by_type || {})) {
      outcomes[type] = (outcomes[type] || 0) + count;
    }
  }
  return { meetings: ingestions.length, outcomes, newActionItems, dueToday, toReview, overdue, noDueDate, planItems };
}

/** Something new happened, or something is due today: reminders alone never trigger an email */
function hasNews(summary) {
  return summary.meetings > 0 || summary.newActionItems > 0 || summary.dueToday > 0;
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
 * Sends the digests that are due now (8:00 in each person's time zone) and not sent yet
 * @param {Date} [now]
 * @param {Object} [deps] - { send } injectable for tests
 * @returns {Promise<{ checked: number, sent: number }>}
 */
async function runDailyDigest(now = new Date(), { send = defaultSend } = {}) {
  const members = await getWorkspaceMembersCollection().find(
    { removed_at: null, email: { $nin: [null, ''] } },
    { projection: { workspace_id: 1, user_id: 1, email: 1, workspace_name: 1, timezone: 1, daily_digest_opt_out: 1 } }
  ).toArray();
  // Opted-out members still count for their workspace's usual time zone
  const timeZoneOf = timeZoneResolver(members);

  let checked = 0;
  let sent = 0;
  for (const member of members) {
    if (member.daily_digest_opt_out) continue;
    const timeZone = timeZoneOf(member);
    const day = digestDay(now, timeZone);
    if (!day) continue;
    try {
      const since = await claimDay(member.workspace_id, member.user_id, day, now);
      if (!since) continue;
      checked++;
      const summary = await buildDailySummary(member.workspace_id, member.user_id, since, now, timeZone);
      if (!hasNews(summary)) continue;

      await send({
        email: member.email,
        workspace_name: member.workspace_name || member.workspace_id,
        summary: {
          ...summary,
          today: localTime(now, timeZone).date,
          dayLabel: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone }),
          since: sinceLabel(since, now, timeZone)
        },
        unsubscribe_url: getUnsubscribeUrl(member.workspace_id, member.user_id, 'daily')
      });
      await getDatabase().collection('daily_digests').updateOne(
        { workspace_id: member.workspace_id, user_id: member.user_id, day },
        // Counts only: the items' text isn't kept
        { $set: { sent: true, sent_at: new Date(), summary: { ...summary, planItems: summary.planItems.length }, timezone: timeZone } }
      );
      sent++;
    } catch (error) {
      console.error(`❌ Daily digest failed for ${member.user_id} in ${member.workspace_id}:`, error.message);
    }
  }
  if (sent > 0) console.log(`📬 Daily digest: ${sent} email(s) sent, ${checked} people checked`);
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
  console.log(`⏰ Daily digest scheduled (Mon–Fri at ${digestHour()}:00 in each person's time zone)`);
}

module.exports = {
  startDailyDigestJob,
  runDailyDigest,
  buildDailySummary,
  digestDay,
  hasNews,
  sinceLabel,
  timeZoneResolver
};
