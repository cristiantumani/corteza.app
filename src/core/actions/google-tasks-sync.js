const { getDatabase } = require('../../config/database');
const actions = require('./action-service');
const connections = require('../../integrations/google/connections');
const tasksClient = require('../../integrations/google/tasks-client');
const { getEmailLanguage } = require('../users/language');
const { translate } = require('../i18n/i18n');

/**
 * "My action items in Google Calendar" (docs/specs/2026-10-google-tasks-sync.md): each person who
 * turned it on gets their open action items with a due date as tasks in a "Corteza" list of their own
 * Google Tasks, so they show on their Google Calendar. Both ways, while it's on:
 *
 *   Corteza → Google  open + due date + owned: the task exists with the item's text, why, meeting and
 *                     link; done: completed; cancelled, date removed, reassigned or deleted: task deleted
 *   Google → Corteza  completed: done (via Google Tasks); un-completed: reopened; due date moved:
 *                     moved; date removed: date cleared (and the task leaves the list); deleted: the
 *                     task isn't created again until the item changes; title edits are ignored
 *
 * Runs in the Meet poller's cycle (jobs/meet-poller.js) and right after the person turns it on.
 * Off: nothing more is added and changes in Google aren't read; the tasks already there stay.
 *
 * Collection `google_task_links` (ids and dates only, no content):
 *   { workspace_id, user_id, item_id, list_id, task_id, item_version, task_updated, status: 'open'|'completed'|'dismissed', synced_at }
 */

const MAX_TITLE = 1024;
const MAX_NOTES = 8192;
const VIA = { kind: 'google_tasks', client_name: 'Google Tasks' };

const links = () => getDatabase().collection('google_task_links');
const items = () => getDatabase().collection('action_items');

/** @returns {string} */
function appUrl() {
  return (process.env.BASE_URL || 'https://app.corteza.app').replace(/\/+$/, '');
}

/** When an item last changed, as a number (detects changes made in Corteza since the last push) */
function versionOf(item) {
  return item.updated_at ? new Date(item.updated_at).getTime() : 0;
}

/** 'YYYY-MM-DD' of a task's due (Google keeps midnight UTC of the date) */
function dueDateOf(task) {
  return task.due ? String(task.due).slice(0, 10) : null;
}

/**
 * The task for an action item, in the person's language
 * @param {Object} item
 * @param {(key: string, vars?: Object) => string} t
 * @returns {{ title: string, notes: string, due: string, status: 'needsAction' }}
 */
function taskFor(item, t) {
  const source = item.source || {};
  const lines = [];
  if (item.rationale) lines.push(item.rationale);
  if (source.title) {
    const date = source.occurred_at ? new Date(source.occurred_at).toISOString().slice(0, 10) : null;
    lines.push(t('tasks.from', { meeting: source.title }) + (date ? ` · ${date}` : ''));
  }
  lines.push(t('tasks.open', { link: `${appUrl()}/actions?item=${encodeURIComponent(item.item_id)}` }));
  return {
    title: String(item.text || '').slice(0, MAX_TITLE),
    notes: lines.join('\n\n').slice(0, MAX_NOTES),
    due: `${item.due_date}T00:00:00.000Z`,
    status: 'needsAction'
  };
}

/** The person's open action items with a due date (the ones that belong in Google) */
async function wantedItems(workspaceId, userId) {
  return items().find(
    { workspace_id: workspaceId, owner_ids: userId, status: 'open', due_date: { $type: 'string' } },
    { projection: { _id: 0, embedding: 0, owner_duplicates: 0, unseen_by: 0 } }
  ).toArray();
}

/**
 * Google → Corteza: what the person changed in their Corteza list since the last sync
 * @returns {Promise<{ pulled: number, latest: Date|null }>}
 */
async function pull(client, connection, listId, linkByTask) {
  const since = connection.tasks_pulled_at ? new Date(connection.tasks_pulled_at) : null;
  if (!since) return { pulled: 0, latest: null }; // first sync: nothing of ours to read back yet
  const changed = await tasksClient.listChanged(client, listId, since);
  let pulled = 0;
  let latest = null;
  for (const task of changed) {
    const updated = new Date(task.updated);
    if (!latest || updated > latest) latest = updated;
    const link = linkByTask.get(task.id);
    if (!link || task.updated === link.task_updated) continue; // not ours, or our own push
    if (task.deleted) {
      await links().updateOne({ _id: link._id }, { $set: { status: 'dismissed', task_updated: task.updated, synced_at: new Date() } });
      continue;
    }
    const item = await items().findOne({ workspace_id: connection.workspace_id, item_id: link.item_id }, { projection: { _id: 0, item_id: 1, status: 1, due_date: 1, owner_ids: 1 } });
    if (!item || !(item.owner_ids || []).includes(connection.user_id)) continue;

    /** @type {{ status?: string, due_date?: string|null }} */
    const change = {};
    if (task.status === 'completed' && item.status === 'open') change.status = 'done';
    if (task.status === 'needsAction' && item.status === 'done') change.status = 'open';
    const due = dueDateOf(task);
    if (due !== (item.due_date || null) && (item.status === 'open' || change.status === 'open')) change.due_date = due;
    if (!Object.keys(change).length) {
      await links().updateOne({ _id: link._id }, { $set: { task_updated: task.updated } });
      continue;
    }
    const after = await actions.updateActionItem(connection.workspace_id, item.item_id, change);
    if (!after || after.error) continue;
    await items().updateOne({ workspace_id: connection.workspace_id, item_id: item.item_id }, { $set: { changed_via: { ...VIA, at: new Date() } } });
    const stored = await items().findOne({ workspace_id: connection.workspace_id, item_id: item.item_id }, { projection: { _id: 0, updated_at: 1 } });
    // Already in step with Google: the push below leaves it alone
    await links().updateOne({ _id: link._id }, {
      $set: { task_updated: task.updated, item_version: versionOf(stored || after), status: task.status === 'completed' ? 'completed' : 'open', synced_at: new Date() }
    });
    pulled += 1;
  }
  return { pulled, latest };
}

/**
 * Corteza → Google: the person's open dated items become tasks; the rest leave or complete
 * @returns {Promise<{ created: number, updated: number, completed: number, removed: number, count: number }>}
 */
async function push(client, connection, listId, linkByItem, t) {
  const counts = { created: 0, updated: 0, completed: 0, removed: 0, count: 0 };
  const wanted = await wantedItems(connection.workspace_id, connection.user_id);
  const wantedIds = new Set(wanted.map(item => item.item_id));
  const save = (link, fields) => links().updateOne(
    { workspace_id: connection.workspace_id, user_id: connection.user_id, item_id: link.item_id },
    { $set: { ...fields, list_id: listId, synced_at: new Date() } },
    { upsert: true }
  );

  for (const item of wanted) {
    const link = linkByItem.get(item.item_id);
    const version = versionOf(item);
    counts.count += 1;
    if (link && link.list_id === listId && link.item_version === version && link.status !== 'completed') continue; // unchanged
    if (link && link.status === 'dismissed' && link.item_version === version) continue; // deleted in Google, unchanged since
    const body = taskFor(item, t);
    if (link && link.list_id === listId && link.status !== 'dismissed') {
      try {
        const task = await tasksClient.patchTask(client, listId, link.task_id, { ...body, completed: null });
        await save(item, { task_id: task.id, task_updated: task.updated, item_version: version, status: 'open' });
        counts.updated += 1;
        continue;
      } catch (error) {
        if (!tasksClient.isNotFound(error)) throw error; // deleted in Google meanwhile: create it again below
      }
    }
    const task = await tasksClient.insertTask(client, listId, body);
    await save(item, { task_id: task.id, task_updated: task.updated, item_version: version, status: 'open' });
    counts.created += 1;
  }

  // Linked items that no longer belong: done → completed; anything else → removed
  for (const link of linkByItem.values()) {
    if (wantedIds.has(link.item_id) || link.status !== 'open' || link.list_id !== listId) continue;
    const item = await items().findOne({ workspace_id: connection.workspace_id, item_id: link.item_id }, { projection: { _id: 0, item_id: 1, status: 1, owner_ids: 1, updated_at: 1 } });
    const stillMine = item && (item.owner_ids || []).includes(connection.user_id);
    if (stillMine && item.status === 'done') {
      try {
        const task = await tasksClient.patchTask(client, listId, link.task_id, { status: 'completed' });
        await save(link, { task_updated: task.updated, item_version: versionOf(item), status: 'completed' });
        counts.completed += 1;
        continue;
      } catch (error) {
        if (!tasksClient.isNotFound(error)) throw error;
      }
    } else {
      await tasksClient.deleteTask(client, listId, link.task_id);
    }
    await links().deleteOne({ _id: link._id });
    counts.removed += 1;
  }
  return counts;
}

/**
 * Syncs one person's action items with their Google Tasks (both ways)
 * @param {Object} connection - their google_connections row (active, with tasks_sync on and the tasks scope)
 * @param {{ getClient?: (connection: Object) => any }} [deps]
 * @returns {Promise<{ skipped?: string, pulled?: number, created?: number, updated?: number, completed?: number, removed?: number, count?: number }>}
 */
async function syncPerson(connection, deps = {}) {
  if (!connection || connection.status !== 'active' || !connection.tasks_sync) return { skipped: 'off' };
  if (!connections.hasTasks(connection)) return { skipped: 'no_scope' };
  const leased = await connections.acquireTasksLease(connection._id);
  if (!leased) return { skipped: 'busy' };
  try {
    return await syncLeased(leased, deps);
  } catch (error) {
    await connections.finishTasksSync(connection._id, { error: String(error.message || error).slice(0, 200) });
    throw error;
  }
}

/** One sync, holding the lease (released by finishTasksSync) */
async function syncLeased(connection, deps) {
  if (!connection.tasks_sync) {
    await connections.finishTasksSync(connection._id, {});
    return { skipped: 'off' };
  }
  const client = (deps.getClient || connections.getAuthorizedClient)(connection);
  const listId = await tasksClient.ensureList(client, connection.tasks_list_id || null);
  if (listId !== connection.tasks_list_id) {
    // A new list (first time, or the person deleted ours): every task is created again in it
    await links().deleteMany({ workspace_id: connection.workspace_id, user_id: connection.user_id });
  }
  const current = await links().find({ workspace_id: connection.workspace_id, user_id: connection.user_id }).toArray();
  const linkByTask = new Map(current.map(link => [link.task_id, link]));
  const lang = await getEmailLanguage(connection.workspace_id, connection.user_id);
  const t = (key, vars) => translate(lang, key, vars);

  const { pulled } = listId === connection.tasks_list_id
    ? await pull(client, connection, listId, linkByTask)
    : { pulled: 0 };
  const fresh = await links().find({ workspace_id: connection.workspace_id, user_id: connection.user_id }).toArray();
  const counts = await push(client, connection, listId, new Map(fresh.map(link => [link.item_id, link])), t);
  // Next time, read what changed in Google after the newest task time we know, in Google's own clock
  // (never ours: clocks differ). Our own pushes come back with that time and are skipped by task_updated.
  const known = await links().find({ workspace_id: connection.workspace_id, user_id: connection.user_id }, { projection: { _id: 0, task_updated: 1 } }).toArray();
  const newest = known.map(link => Date.parse(link.task_updated)).filter(Number.isFinite).reduce((max, time) => Math.max(max, time), 0);
  const previous = connection.tasks_pulled_at ? new Date(connection.tasks_pulled_at).getTime() : 0;
  const pulledAt = Math.max(newest, previous) ? new Date(Math.max(newest, previous)) : undefined;
  await connections.finishTasksSync(connection._id, { listId, pulledAt, count: counts.count });
  return { pulled, ...counts };
}

module.exports = { syncPerson, taskFor, versionOf, dueDateOf };
