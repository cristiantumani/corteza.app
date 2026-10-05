const crypto = require('crypto');
const { getDatabase, getWorkspaceSpacesCollection } = require('../config/database');
const connections = require('../integrations/google/connections');
const meetClient = require('../integrations/google/meet-client');
const googleMeetSource = require('./sources/google-meet');
const pipeline = require('./pipeline');
const { ensurePersonalSpace } = require('../services/spaces');
const { countByType } = require('../core/decisions/types');
const batchExtraction = require('./batch-extraction');
// Loaded when an import runs (the Claude client needs the API config)
/** @type {typeof import('../services/claude').prepareExtraction} */
const prepareExtraction = (text, workspaceId, options) => require('../services/claude').prepareExtraction(text, workspaceId, options);
/** @type {typeof import('../services/claude').finishExtraction} */
const finishExtraction = (response, meta) => require('../services/claude').finishExtraction(response, meta);

/**
 * Importing past Google Meet meetings ("Settings → Google Meet → Import past meetings").
 *
 * 1. findMeetings: lists the user's meetings in a date range with whether a
 *    transcript/Gemini notes exist and whether Corteza already processed them.
 * 2. startImport: the user picks meetings; a job is stored in `meet_imports`
 *    and processed in the background (runImport). The UI polls getImport for progress.
 * 3. runImport extracts the importable meetings in one Message Batches request
 *    (ingestion/batch-extraction.js, half price): items wait as `extracting` while
 *    the batch runs, and the Meet poller collects the results every 5 minutes
 *    (resumeStaleImports). The meeting is read from Google again then: transcripts
 *    are never stored. Without batching (AI_BATCH_IMPORTS=false), or for what the
 *    batch couldn't take, meetings go through the pipeline one at a time, live.
 *
 * Imports are manual choices, so automatic skip rules (1:1s, title keywords)
 * don't apply, and meetings skipped earlier can be imported. Completed meetings
 * are never processed twice (pipeline `ingestions`). A job interrupted by a
 * restart is picked up again by the Meet poller (resumeStaleImports).
 *
 * It runs on the server, so people can leave the page: Home and Settings show the
 * running import (getActiveImport, in GET /api/integrations/google), and an email
 * with the summary goes out when it finishes (once).
 */

const MAX_RANGE_DAYS = 92;
const DEFAULT_MAX_DAYS_BACK = 7; // private beta: every imported meeting is an AI extraction we pay for
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
 * How many days back "Import past meetings" can reach (MEET_IMPORT_MAX_DAYS, default 7)
 * @returns {number}
 */
function maxDaysBack() {
  const days = parseInt(process.env.MEET_IMPORT_MAX_DAYS || '', 10);
  return days > 0 ? Math.min(days, MAX_RANGE_DAYS) : DEFAULT_MAX_DAYS_BACK;
}

/**
 * Earliest moment an imported meeting can start: midnight UTC, maxDaysBack() days before `now`
 * @param {Date} [now]
 * @returns {Date}
 */
function importCutoff(now = new Date()) {
  const day = new Date(now.getTime() - maxDaysBack() * DAY_MS);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
}

/** What people see when they ask for older meetings */
function tooOldMessage() {
  return `You can import meetings from the last ${maxDaysBack()} days.`;
}

/**
 * Validates a date range from the UI ('YYYY-MM-DD', both days inclusive)
 * @param {unknown} fromText
 * @param {unknown} toText
 * @param {Date} [now]
 * @returns {{ from?: Date, to?: Date, error?: string }} to is exclusive (the day after `to`); error when invalid
 */
function parseRange(fromText, toText, now = new Date()) {
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!valid(fromText) || !valid(toText)) return { error: 'Choose a start and end date.' };

  const from = new Date(`${fromText}T00:00:00Z`);
  const to = new Date(new Date(`${toText}T00:00:00Z`).getTime() + DAY_MS);
  if (to <= from) return { error: 'The end date must be on or after the start date.' };
  if (from > now) return { error: 'The period is in the future.' };
  if (from < importCutoff(now)) return { error: tooOldMessage() };
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) return { error: `Choose a period of at most ${MAX_RANGE_DAYS} days.` };
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
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const truncated = records.length > MAX_MEETINGS_LISTED;
  const listed = records.slice(0, MAX_MEETINGS_LISTED);

  const described = await mapWithLimit(listed, DESCRIBE_CONCURRENCY, record => describeMeeting(client, record));
  const statuses = await pipeline.getStatuses(connection.workspace_id, connection.user_id, 'google_meet', listed.map(r => r.name));

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

/** Lets the Meet poller pick the job up again on its next tick (resumeStaleImports) */
async function releaseLease(importId) {
  await imports().updateOne({ import_id: importId, status: 'running' }, { $set: { lease_until: new Date(Date.now() - 1), updated_at: new Date() } });
  return imports().findOne({ import_id: importId });
}

/**
 * Prepares the importable meetings of a job and submits them as one extraction batch.
 * Items that can't be imported get their result now; ones that need no AI call (too short,
 * already imported, over the AI budget) stay queued for the live path, which skips them
 * without calling Claude. If the batch can't be created, everything stays queued (live).
 */
async function submitBatch(job, { readMeeting, toTranscript, recordResult, connection, deps }) {
  const { checkAiBudget } = require('../core/usage/ai-usage');
  const budget = await checkAiBudget(job.workspace_id);
  const statuses = await pipeline.getStatuses(job.workspace_id, connection.user_id, 'google_meet', job.items.map(item => item.meeting_id));

  const prompts = [];
  const prepared = [];
  for (let index = 0; index < job.items.length; index++) {
    const item = job.items[index];
    if (item.status !== 'queued') continue;
    const read = await readMeeting(item);
    if (read.result) { await recordResult(index, read.result); continue; }

    const transcript = toTranscript(read.meeting, item);
    const words = (transcript.text || '').split(/\s+/).filter(Boolean).length;
    if (!budget.ok || words < pipeline.MIN_WORDS || statuses.get(item.meeting_id)?.status === 'completed') continue;

    const extraction = await prepareExtraction(pipeline.buildExtractionText(transcript), job.workspace_id, {
      language: transcript.language, userId: connection.user_id, personName: connection.user_name
    });
    const customId = `m${index}`;
    prompts.push({ customId, prompt: extraction.prompt });
    prepared.push({ index, customId, language: extraction.language, usedExamples: extraction.usedExamples, title: read.meeting.title });
  }
  if (prompts.length === 0) return;

  let batchId;
  try {
    batchId = await batchExtraction.submitExtractionBatch(prompts, { client: deps.batchClient });
  } catch (error) {
    console.warn(`⚠️  Meet import ${job.import_id}: batch not created (${error.status || error.message}), extracting live`);
    return;
  }
  const set = { batch: { id: batchId, submitted_at: new Date(), requests: prompts.length, collected_at: null }, updated_at: new Date() };
  for (const p of prepared) {
    set[`items.${p.index}.status`] = 'extracting';
    set[`items.${p.index}.title`] = p.title;
    set[`items.${p.index}.batch_id`] = p.customId;
    set[`items.${p.index}.batch_language`] = p.language || null;
    set[`items.${p.index}.batch_used_examples`] = !!p.usedExamples;
  }
  await imports().updateOne({ import_id: job.import_id }, { $set: set });
}

/** The job's batch results once it ended (null while running; an empty Map if it can't be read: all go live) */
async function collectBatch(job, deps) {
  try {
    return await batchExtraction.fetchExtractionResults(job.batch.id, { client: deps.batchClient });
  } catch (error) {
    const ageMs = Date.now() - new Date(job.batch.submitted_at).getTime();
    console.warn(`⚠️  Meet import ${job.import_id}: reading batch ${job.batch.id} failed (${error.status || error.message})`);
    // Batches end within 24 hours: after that, stop waiting and extract live
    return ageMs > 25 * 60 * 60 * 1000 ? new Map() : null;
  }
}

/**
 * Processes the queued meetings of an import job (safe to call again: leased and resumable)
 */
async function runImport(importId, deps = {}) {
  const {
    getClient = connections.getAuthorizedClient,
    getRecord = meetClient.getConferenceRecord,
    loadMeeting = googleMeetSource.loadMeeting,
    ingest = pipeline.ingestTranscript,
    notify = notifyImportDone,
    useBatch = batchExtraction.batchImportsEnabled()
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
  // Meetings are checked against the day the import was started (a resumed job keeps its window)
  const cutoff = importCutoff(new Date(job.created_at || Date.now()));
  const author = { user_id: connection.user_id, name: connection.user_name };
  const language = (connection.settings && connection.settings.language) || null;

  /** The meeting as a pipeline Transcript */
  const toTranscript = (meeting, item) => ({
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
    author,
    language
  });

  /** Reads one meeting: { meeting } when it can be imported, else { result } saying why not */
  const readMeeting = async item => {
    let step = 'meeting';
    try {
      const record = await getRecord(client, item.meeting_id);
      step = 'content';
      // The list only offers recent meetings; this stops a hand-made request from importing older ones
      if (record.startTime && new Date(record.startTime) < cutoff) {
        return { result: { status: 'too_old', title: item.title, decisions_created: 0, error: tooOldMessage() } };
      }
      const meeting = await loadMeeting(client, record);
      if (meeting.state !== 'ready') {
        return { result: { status: meeting.state === 'pending' ? 'not_ready' : 'no_transcript', title: meeting.title, decisions_created: 0 } };
      }
      return { meeting };
    } catch (error) {
      const detail = meetClient.describeGoogleError(error);
      console.error(`❌ Meet import ${importId}: ${item.meeting_id} failed reading the ${error.meetSource || step}: ${detail}`);
      return { result: { status: 'failed', title: item.title, decisions_created: 0, error: importErrorMessage(error, step, { needsReconsent: connections.needsReconsent(connection) }) } };
    }
  };

  /** Runs a readable meeting through the pipeline (live extraction unless `extract` is given) */
  const ingestMeeting = async (meeting, item, extract) => {
    const outcome = await ingest(toTranscript(meeting, item), extract ? { manual: true, extract } : { manual: true });
    if (outcome.error) console.error(`❌ Meet import ${importId}: extraction failed for ${item.meeting_id}: ${outcome.error}`);
    return {
      status: outcome.status === 'duplicate' ? 'already_imported' : outcome.status,
      title: meeting.title,
      decisions_created: outcome.decisions.length,
      outcomes_by_type: countByType(outcome.decisions),
      action_items_created: (outcome.actionItems || []).length,
      error: outcome.status === 'failed' ? 'Corteza couldn’t extract outcomes right now. Try importing it again later.' : null
    };
  };

  const recordResult = (index, result) => imports().updateOne({ import_id: importId }, {
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

  // 1. Batch: extract every importable meeting in one Message Batches request (half price)
  if (!job.batch && useBatch && job.items.some(item => item.status === 'queued')) {
    await submitBatch(job, { readMeeting, toTranscript, recordResult, connection, deps });
    return releaseLease(importId);
  }

  // 2. Batch results: once the batch has ended, save each meeting's outcomes
  if (job.batch && !job.batch.collected_at) {
    const results = await collectBatch(job, deps);
    if (!results) return releaseLease(importId); // still running: the Meet poller checks again
    for (let index = 0; index < job.items.length; index++) {
      const item = job.items[index];
      if (item.status !== 'extracting') continue;
      const read = await readMeeting(item);
      if (read.result) { await recordResult(index, read.result); continue; }
      const answer = results.get(item.batch_id);
      const extract = answer && answer.message
        ? async () => finishExtraction(answer.message, { workspaceId: job.workspace_id, userId: connection.user_id, language: item.batch_language || null, usedExamples: !!item.batch_used_examples, batch: true })
        : null; // errored or expired in the batch: extract it live
      if (!extract) console.warn(`⚠️  Meet import ${importId}: batch result for ${item.meeting_id} was ${answer ? answer.error : 'missing'}, extracting live`);
      try {
        await recordResult(index, await ingestMeeting(read.meeting, item, extract));
      } catch (error) {
        console.error(`❌ Meet import ${importId}: saving ${item.meeting_id} failed:`, error.message);
        await recordResult(index, { status: 'failed', title: read.meeting.title, decisions_created: 0, error: 'Corteza couldn’t extract outcomes right now. Try importing it again later.' });
      }
    }
    await imports().updateOne({ import_id: importId }, { $set: { 'batch.collected_at': now() } });
  }

  // 3. One at a time, live: without batching, or what the batch didn't take
  for (let index = 0; index < job.items.length; index++) {
    const item = job.items[index];
    if (item.status !== 'queued') continue;
    const read = await readMeeting(item);
    await recordResult(index, read.result || await ingestMeeting(read.meeting, item));
  }

  // Only the run that marks it completed sends the summary email
  const completed = await imports().updateOne({ import_id: importId, status: 'running' }, {
    $set: { status: 'completed', lease_until: null, completed_at: now(), updated_at: now() }
  });
  const finished = await imports().findOne({ import_id: importId });
  console.log(`📥 Meet import ${importId} finished: ${finished.decisions_created} outcome(s) from ${finished.total} meeting(s)`);
  if (completed.modifiedCount === 1) {
    await notify(connection, finished).catch(error => console.error(`❌ Import summary email for ${importId} failed:`, error.message));
  }
  return finished;
}

/** Emails the person who started the import what it captured (skipped without Resend) */
async function notifyImportDone(connection, job) {
  if (!process.env.RESEND_API_KEY || !connection.google_email) return;
  const { sendImportSummaryEmail } = require('../utils/n8n-client');
  const lang = await require('../core/users/language').getEmailLanguage(connection.workspace_id, connection.user_id);
  await sendImportSummaryEmail({ email: connection.google_email, job, lang });
}

/**
 * The user's import that is still running, if any (latest first), for Home and Settings
 * @param {string} workspaceId
 * @param {string} userId
 * @returns {Promise<Object|null>} { import_id, total, done, decisions_created, action_items_created, outcomes_by_type, created_at }
 */
async function getActiveImport(workspaceId, userId) {
  return imports().findOne(
    { workspace_id: workspaceId, user_id: userId, status: 'running' },
    {
      sort: { created_at: -1 },
      projection: { _id: 0, import_id: 1, total: 1, done: 1, decisions_created: 1, action_items_created: 1, outcomes_by_type: 1, created_at: 1 }
    }
  );
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
    $or: [{ lease_until: { $lt: now } }, { lease_until: null, updated_at: { $lt: new Date(now.getTime() - LEASE_MS) } }]
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
  getActiveImport,
  importErrorMessage,
  resumeStaleImports,
  maxDaysBack,
  importCutoff,
  MAX_RANGE_DAYS,
  MAX_MEETINGS_PER_IMPORT
};
