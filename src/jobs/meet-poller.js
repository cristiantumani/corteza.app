const { getWorkspaceSpacesCollection } = require('../config/database');
const config = require('../config/environment');
const connections = require('../integrations/google/connections');
const meetClient = require('../integrations/google/meet-client');
const googleMeetSource = require('../ingestion/sources/google-meet');
const pipeline = require('../ingestion/pipeline');
const { ensurePersonalSpace } = require('../services/spaces');
const { countByType } = require('../core/decisions/types');

/**
 * Google Meet poller: finds meetings that ended for each connected user and
 * sends their transcript/notes through the ingestion pipeline.
 *
 * Every MEET_POLL_INTERVAL_MINUTES (default 5). Each run re-checks the last
 * LOOKBACK_MS (6h) because Meet creates transcripts a few minutes after a meeting
 * ends; the `ingestions` collection keeps anything from being processed twice.
 * Disable with MEET_CAPTURE_ENABLED=false.
 */

const GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000; // no transcript 6h after the end → there won't be one
const LOOKBACK_MS = GIVE_UP_AFTER_MS; // keep re-checking meetings until we process them or give up

/**
 * Space a connection's decisions go to: its chosen space if it still exists, else the person's personal space
 */
async function resolveSpace(connection) {
  const spaceId = connection.settings?.space_id;
  if (spaceId) {
    const space = await getWorkspaceSpacesCollection().findOne({
      workspace_id: connection.workspace_id, space_id: spaceId, archived: false
    });
    if (space) return space;
  }
  return ensurePersonalSpace(connection.workspace_id, connection.user_id, connection.user_name);
}

/**
 * Why a meeting should be skipped, or null to process it
 */
function skipReason(meeting, settings = {}) {
  if (settings.skip_one_on_one !== false && meeting.participantCount > 0 && meeting.participantCount <= 2) {
    return 'one_on_one';
  }
  const title = (meeting.title || '').toLowerCase();
  const keyword = (settings.exclude_keywords || []).find(k => k && title.includes(k.toLowerCase()));
  return keyword ? 'excluded_title' : null;
}

/**
 * Polls one connection (the caller holds its lease)
 * @param {Object} connection
 * @param {Object} [deps] - injectable for tests
 * @returns {Promise<{ meetingsProcessed: number, decisionsCaptured: number, outcomesByType: Object, results: Object[] }>}
 */
async function pollConnection(connection, deps = {}) {
  const {
    now = new Date(),
    getClient = connections.getAuthorizedClient,
    listConferenceRecords = meetClient.listConferenceRecords,
    loadMeeting = googleMeetSource.loadMeeting,
    ingest = pipeline.ingestTranscript,
    notify = notifyCaptured
  } = deps;

  const client = getClient(connection);
  const since = new Date(Math.min(new Date(connection.poll_cursor || now).getTime(), now.getTime() - LOOKBACK_MS));
  const records = (await listConferenceRecords(client, { endedAfter: since })).filter(r => r.endTime);

  const results = [];
  let space = null;

  for (const record of records) {
    const source = 'google_meet';
    if (await pipeline.isHandled(connection.workspace_id, source, record.name)) continue;

    let meeting;
    try {
      meeting = await loadMeeting(client, record);
    } catch (error) {
      if (meetClient.isRevokedError(error)) throw error;
      // One meeting Google won't let us read must not block the others; it's retried on later polls
      console.error(`❌ Could not load ${record.name} for ${connection.google_email}: ${meetClient.describeGoogleError(error)}`);
      results.push({ title: null, status: 'failed', reason: 'no_access' });
      continue;
    }
    const author = { user_id: connection.user_id, name: connection.user_name };
    const base = { workspaceId: connection.workspace_id, source, externalId: record.name, title: meeting.title, author };

    const reason = skipReason(meeting, connection.settings);
    if (reason) {
      await pipeline.recordSkipped(base, reason);
      results.push({ title: meeting.title, status: 'skipped', reason });
      continue;
    }

    if (meeting.state !== 'ready') {
      // 'none': transcription and Gemini notes were off. 'pending': Meet is still generating them.
      const gaveUp = meeting.state === 'pending' && meeting.endedAt && now - meeting.endedAt > GIVE_UP_AFTER_MS;
      if (meeting.state === 'none' || gaveUp) {
        await pipeline.recordSkipped(base, 'no_transcript');
        results.push({ title: meeting.title, status: 'skipped', reason: 'no_transcript' });
      } else {
        results.push({ title: meeting.title, status: 'waiting' });
      }
      continue;
    }

    space = space || await resolveSpace(connection);
    const outcome = await ingest({
      ...base,
      text: meeting.text,
      participants: meeting.participants,
      occurredAt: meeting.occurredAt,
      url: meeting.url,
      spaceId: space.space_id,
      spaceName: space.name,
      language: (connection.settings && connection.settings.language) || null
    });
    results.push({ title: meeting.title, url: meeting.url, status: outcome.status, decisions: outcome.decisions, actionItems: outcome.actionItems || [] });
  }

  const captured = results.filter(r => r.status === 'completed');
  const decisionsCaptured = captured.reduce((sum, r) => sum + r.decisions.length, 0);
  const outcomesByType = countByType(captured.flatMap(r => r.decisions));

  for (const result of captured.filter(r => r.decisions.length > 0 || r.actionItems.length > 0)) {
    notify(connection, result).catch(error => console.error('❌ Meet summary email failed:', error.message));
  }

  return { meetingsProcessed: captured.length, decisionsCaptured, outcomesByType, results };
}

/**
 * Emails the connected user a summary of the outcomes captured from a meeting
 */
async function notifyCaptured(connection, result) {
  if (!process.env.RESEND_API_KEY || !connection.google_email) return;
  const { sendMeetingCaptureEmail } = require('../utils/n8n-client');
  await sendMeetingCaptureEmail({
    email: connection.google_email,
    meeting_title: result.title,
    meeting_url: result.url,
    decisions: result.decisions.map(d => ({ id: d.id, text: d.text, type: d.type })),
    action_items: result.actionItems.map(item => ({
      text: item.text, owners: item.owners.map(owner => owner.name), due_date: item.due_date
    }))
  });
}

/**
 * Polls one connection end to end: lease, poll, record the outcome
 * @returns {Promise<Object|null>} poll summary, or null if another poller holds the lease
 */
async function runForConnection(connection, deps = {}) {
  const leased = await connections.acquireLease(connection._id);
  if (!leased) return null;

  const startedAt = deps.now || new Date();
  try {
    const summary = await pollConnection(leased, deps);
    await connections.finishPoll(leased._id, {
      cursor: startedAt,
      meetingsProcessed: summary.meetingsProcessed,
      decisionsCaptured: summary.decisionsCaptured,
      outcomesByType: summary.outcomesByType
    });
    return summary;
  } catch (error) {
    const revoked = meetClient.isRevokedError(error);
    console.error(`❌ Meet poll failed for ${leased.google_email}:`, error.message);
    await connections.finishPoll(leased._id, { error: Object.assign(error, { revoked }) });
    return { error: revoked ? 'revoked' : error.message, meetingsProcessed: 0, decisionsCaptured: 0, results: [] };
  }
}

async function runMeetPoller() {
  try {
    const active = await connections.listActiveConnections();
    for (const connection of active) {
      await runForConnection(connection);
    }
    // Finish "Import past meetings" jobs interrupted by a restart
    await require('../ingestion/meet-import').resumeStaleImports();
  } catch (error) {
    console.error('❌ Meet poller run failed:', error.message);
  }
}

function startMeetPollerJob() {
  if (process.env.MEET_CAPTURE_ENABLED === 'false') {
    console.log('⏸️  Google Meet capture disabled (MEET_CAPTURE_ENABLED=false)');
    return;
  }
  if (!config.google.isConfigured) {
    console.warn('⚠️  Google Meet capture not started: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set');
    return;
  }

  const minutes = Math.max(1, parseInt(process.env.MEET_POLL_INTERVAL_MINUTES || '5', 10));
  setTimeout(() => {
    runMeetPoller();
    setInterval(runMeetPoller, minutes * 60 * 1000);
  }, 60 * 1000);

  console.log(`⏰ Google Meet capture scheduled (every ${minutes} min)`);
}

module.exports = {
  startMeetPollerJob,
  runMeetPoller,
  runForConnection,
  pollConnection,
  skipReason,
  LOOKBACK_MS
};
