const crypto = require('crypto');
const { getDatabase, getWorkspaceSpacesCollection } = require('../config/database');
const connections = require('../integrations/google/connections');
const meetClient = require('../integrations/google/meet-client');
const googleMeetSource = require('./sources/google-meet');
const pipeline = require('./pipeline');
const { ensurePersonalSpace } = require('../services/spaces');
const { countByType } = require('../core/decisions/types');

/**
 * Importing past Google Meet meetings ("Settings → Google Meet → Import past meetings").
 *
 * 1. findMeetings: lists the user's meetings in a date range with whether a
 *    transcript/Gemini notes exist and whether Corteza already processed them.
 * 2. startImport: the user picks meetings; a job is stored in `meet_imports`
 *    and processed in the background (runImport), one meeting at a time.
 *    The UI polls getImport for progress.
 *
 * Imports are manual choices, so automatic skip rules (1:1s, title keywords)
 * don't apply, and meetings skipped earlier can be imported. Completed meetings
 * are never processed twice (pipeline `ingestions`). A job interrupted by a
 * restart is picked up again by the Meet poller (resumeStaleImports).
 */

const MAX_RANGE_DAYS = 92;
const MAX_MEETINGS_LISTED = 200;
const MAX_MEETINGS_PER_IMPORT = 50;
const DESCRIBE_CONCURRENCY = 5;
const LEASE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MEETING_ID_PATTERN = /^conferenceRecords\/[A-Za-z0-9_-]+$/;

function imports() {
  return getDatabase().collection('meet_imports');
}

/**
 * Validates a date range from the UI ('YYYY-MM-DD', both days inclusive)
 * @returns {{ from: Date, to: Date } | { error: string }} to is exclusive (the day after `to`)
 */
function parseRange(fromText, toText, now = new Date()) {
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!valid(fromText) || !valid(toText)) return { error: 'Choose a start and end date.' };

  const from = new Date(`${fromText}T00:00:00Z`);
  const to = new Date(new Date(`${toText}T00:00:00Z`).getTime() + DAY_MS);
  if (to <= from) return { error: 'The end date must be on or after the start date.' };
  if (from > now) return { error: 'The period is in the future.' };
  if ((to - from) / DAY_MS > MAX_RANGE_DAYS) return { error: `Choose a period of at most ${MAX_RANGE_DAYS} days.` };
  return { from, to };
}

/** Runs `fn` over items with at most `limit` in flight */
async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Meetings of the connected user in a period, newest first
 * @param {Object} connection - google_connections document
 * @param {{ from: Date, to: Date }} range
 * @param {Object} [deps] - injectable for tests
 * @returns {Promise<{ meetings: Object[], truncated: boolean }>}
 */
async function findMeetings(connection, { from, to }, deps = {}) {
  const {
    getClient = connections.getAuthorizedClient,
    listRecords = meetClient.listConferenceRecordsBetween,
    describeMeeting = googleMeetSource.describeMeeting
  } = deps;

  const client = getClient(connection);
  const records = (await listRecords(client, { from, to }))
    .filter(record => record.endTime) // still running
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  const truncated = records.length > MAX_MEETINGS_LISTED;
  const listed = records.slice(0, MAX_MEETINGS_LISTED);

  const described = await mapWithLimit(listed, DESCRIBE_CONCURRENCY, record => describeMeeting(client, record));
  const statuses = await pipeline.getStatuses(connection.workspace_id, 'google_meet', listed.map(r => r.name));

  const meetings = described.map(meeting => {
    const ingestion = statuses.get(meeting.externalId);
    return {
      id: meeting.externalId,
      title: meeting.title,
      url: meeting.url,
      started_at: meeting.occurredAt,
      ended_at: meeting.endedAt,
      participant_count: meeting.participantCount,
      has_transcript: meeting.hasTranscript,
      has_notes: meeting.hasNotes,
      availability: meeting.state, // 'ready' | 'pending' | 'none'
      status: ingestion ? ingestion.status : 'new', // new | completed | skipped | failed | processing
      skip_reason: ingestion?.skip_reason || null,
      decisions_created: ingestion?.decisions_created || 0,
      outcomes_by_type: ingestion?.outcomes_by_type || null
    };
  });

  return { meetings, truncated };
}

/**
 * Where imported decisions go: the chosen space if it still exists, else the person's personal space
 */
async function resolveTargetSpace(workspaceId, spaceId, connection) {
  if (spaceId) {
    const space = await getWorkspaceSpacesCollection().findOne({ workspace_id: workspaceId, space_id: spaceId, archived: false });
    if (space) return space;
  }
  return ensurePersonalSpace(workspaceId, connection.user_id, connection.user_name);
}

/**
 * Creates an import job and starts it in the background
 * @param {Object} connection
 * @param {string[]} meetingIds - conference record names chosen by the user
 * @param {string|null} spaceId - already checked by the caller (canCreateInSpace)
 * @returns {Promise<Object|{ error: string }>} the job
 */
async function startImport(connection, meetingIds, spaceId, deps = {}) {
  const ids = [...new Set(Array.isArray(meetingIds) ? meetingIds : [])];
  if (ids.length === 0) return { error: 'Choose at least one meeting.' };
  if (ids.length > MAX_MEETINGS_PER_IMPORT) return { error: `Import at most ${MAX_MEETINGS_PER_IMPORT} meetings at a time.` };
  if (!ids.every(id => typeof id === 'string' && MEETING_ID_PATTERN.test(id))) return { error: 'Invalid meeting selection.' };

  const now = new Date();
  const job = {
    import_id: `imp_${crypto.randomBytes(8).toString('hex')}`,
    workspace_id: connection.workspace_id,
    user_id: connection.user_id,
    connection_id: connection._id,
    space_id: spaceId || null,
    status: 'running',
    items: ids.map(id => ({ meeting_id: id, status: 'queued', title: null, decisions_created: 0 })),
    total: ids.length,
    done: 0,
    decisions_created: 0,
    lease_until: null,
    created_at: now,
    updated_at: now
  };
  await imports().insertOne(job);
  console.log(`📥 Meet import ${job.import_id} started: ${ids.length} meeting(s) for ${connection.google_email}`);

  // Background: the caller polls getImport for progress
  runImport(job.import_id, deps).catch(error => console.error(`❌ Meet import ${job.import_id} failed:`, error.message));
  return job;
}

/**
 * What the user sees when a meeting can't be imported. Plain language only:
 * Google's technical reason is logged, not shown.
 */
function importErrorMessage(error, step, { needsReconsent = false } = {}) {
  const status = error.response?.status;
  if (status === 401 || status === 403 || status === 404) {
    if (error.meetSource === 'notes') {
      return needsReconsent
        ? 'To import Gemini notes, reconnect Google Meet above and allow Drive access, then import again.'
        : 'Google doesn’t let Corteza read this meeting’s Gemini notes.';
    }
    if (error.meetSource === 'transcript') return 'Google doesn’t let Corteza read this meeting’s transcript.';
    return step === 'meeting' ? 'You don’t have access to this meeting.' : 'Google doesn’t let Corteza read this meeting’s transcript or notes.';
  }
  return 'Something went wrong reading this meeting. Try importing it again later.';
}

/**
 * Processes the queued meetings of an import job (safe to call again: leased and resumable)
 */
async function runImport(importId, deps = {}) {
  const {
    getClient = connections.getAuthorizedClient,
    getRecord = meetClient.getConferenceRecord,
    loadMeeting = googleMeetSource.loadMeeting,
    ingest = pipeline.ingestTranscript
  } = deps;

  const now = () => new Date();
  const job = await imports().findOneAndUpdate(
    { import_id: importId, status: 'running', $or: [{ lease_until: null }, { lease_until: { $lt: now() } }] },
    { $set: { lease_until: new Date(Date.now() + LEASE_MS), updated_at: now() } },
    { returnDocument: 'after' }
  );
  if (!job) return null;

  const connection = await getDatabase().collection('google_connections').findOne({ _id: job.connection_id });
  if (!connection || connection.status !== 'active') {
    await imports().updateOne({ import_id: importId }, {
      $set: { status: 'failed', error: 'Google Meet is no longer connected.', lease_until: null, updated_at: now() }
    });
    return null;
  }

  const client = getClient(connection);
  const space = await resolveTargetSpace(job.workspace_id, job.space_id, connection);

  for (let index = 0; index < job.items.length; index++) {
    const item = job.items[index];
    if (item.status !== 'queued') continue;

    let result;
    let step = 'meeting';
    try {
      const record = await getRecord(client, item.meeting_id);
      step = 'content';
      const meeting = await loadMeeting(client, record);
      if (meeting.state !== 'ready') {
        result = { status: meeting.state === 'pending' ? 'not_ready' : 'no_transcript', title: meeting.title, decisions_created: 0 };
      } else {
        const outcome = await ingest({
          workspaceId: job.workspace_id,
          source: 'google_meet',
          externalId: item.meeting_id,
          title: meeting.title,
          text: meeting.text,
          participants: meeting.participants,
          occurredAt: meeting.occurredAt,
          url: meeting.url,
          spaceId: space.space_id,
          spaceName: space.name,
          author: { user_id: connection.user_id, name: connection.user_name },
          language: (connection.settings && connection.settings.language) || null
        }, { manual: true });
        result = {
          status: outcome.status === 'duplicate' ? 'already_imported' : outcome.status,
          title: meeting.title,
          decisions_created: outcome.decisions.length,
          outcomes_by_type: countByType(outcome.decisions),
          action_items_created: (outcome.actionItems || []).length,
          error: outcome.status === 'failed' ? 'Corteza couldn’t extract outcomes right now. Try importing it again later.' : null
        };
        if (outcome.error) console.error(`❌ Meet import ${importId}: extraction failed for ${item.meeting_id}: ${outcome.error}`);
      }
    } catch (error) {
      const detail = meetClient.describeGoogleError(error);
      console.error(`❌ Meet import ${importId}: ${item.meeting_id} failed reading the ${error.meetSource || step}: ${detail}`);
      result = { status: 'failed', title: item.title, decisions_created: 0, error: importErrorMessage(error, step, { needsReconsent: connections.needsReconsent(connection) }) };
    }

    await imports().updateOne({ import_id: importId }, {
      $set: {
        [`items.${index}.status`]: result.status,
        [`items.${index}.title`]: result.title,
        [`items.${index}.decisions_created`]: result.decisions_created,
        [`items.${index}.outcomes_by_type`]: result.outcomes_by_type || {},
        [`items.${index}.action_items_created`]: result.action_items_created || 0,
        [`items.${index}.error`]: result.error || null,
        lease_until: new Date(Date.now() + LEASE_MS),
        updated_at: now()
      },
      $inc: {
        done: 1,
        decisions_created: result.decisions_created,
        action_items_created: result.action_items_created || 0,
        ...Object.fromEntries(Object.entries(result.outcomes_by_type || {}).map(([type, count]) => [`outcomes_by_type.${type}`, count]))
      }
    });
  }

  await imports().updateOne({ import_id: importId }, {
    $set: { status: 'completed', lease_until: null, completed_at: now(), updated_at: now() }
  });
  const finished = await imports().findOne({ import_id: importId });
  console.log(`📥 Meet import ${importId} finished: ${finished.decisions_created} outcome(s) from ${finished.total} meeting(s)`);
  return finished;
}

/** An import job of this user, or null */
async function getImport(workspaceId, userId, importId) {
  return imports().findOne(
    { import_id: importId, workspace_id: workspaceId, user_id: userId },
    { projection: { _id: 0, connection_id: 0, lease_until: 0 } }
  );
}

/** Continues imports interrupted by a restart (called by the Meet poller) */
async function resumeStaleImports(deps = {}) {
  const now = new Date();
  const stale = await imports().find({
    status: 'running',
    $or: [{ lease_until: { $lt: now } }, { lease_until: null, updated_at: { $lt: new Date(now - LEASE_MS) } }]
  }).project({ import_id: 1 }).toArray();
  for (const job of stale) {
    await runImport(job.import_id, deps);
  }
}

module.exports = {
  parseRange,
  findMeetings,
  startImport,
  runImport,
  getImport,
  importErrorMessage,
  resumeStaleImports,
  MAX_RANGE_DAYS,
  MAX_MEETINGS_PER_IMPORT
};
