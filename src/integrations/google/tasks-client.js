/**
 * Thin client for the Google Tasks API (v1): the person's own "Corteza" task list, so their action
 * items with a due date show on their Google Calendar (core/actions/google-tasks-sync.js,
 * docs/specs/2026-10-google-tasks-sync.md). Needs the optional `tasks` scope (connections.hasTasks).
 * The API only reaches the lists of the account that granted access, and keeps the due date only
 * (no time).
 *
 * API: https://developers.google.com/tasks/reference/rest
 */

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const LIST_TITLE = 'Corteza';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/**
 * @typedef {Object} GoogleTask
 * @property {string} id
 * @property {string} [title]
 * @property {string} [notes]
 * @property {'needsAction'|'completed'} status
 * @property {string} [due] - RFC 3339, midnight UTC of the due date
 * @property {string} updated - RFC 3339
 * @property {boolean} [deleted]
 */

/** @param {any} error @returns {boolean} the list or task no longer exists */
function isNotFound(error) {
  const status = error && (error.status || error.code || (error.response && error.response.status));
  return Number(status) === 404;
}

/**
 * The person's Corteza list: the one we created (if it still exists), else a new one
 * @param {Object} client - authorized OAuth2Client (connections.getAuthorizedClient)
 * @param {string|null} listId
 * @returns {Promise<string>} the list id
 */
async function ensureList(client, listId) {
  if (listId) {
    try {
      await client.request({ url: `${TASKS_API}/users/@me/lists/${encodeURIComponent(listId)}` });
      return listId;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  const { data } = await client.request({ url: `${TASKS_API}/users/@me/lists`, method: 'POST', data: { title: LIST_TITLE } });
  return data.id;
}

/**
 * Tasks of the list changed since a time, deleted and completed ones included
 * @param {Object} client
 * @param {string} listId
 * @param {Date|null} since
 * @returns {Promise<GoogleTask[]>}
 */
async function listChanged(client, listId, since) {
  const tasks = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await client.request({
      url: `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`,
      params: {
        maxResults: PAGE_SIZE, showCompleted: true, showHidden: true, showDeleted: true,
        ...(since ? { updatedMin: since.toISOString() } : {}), ...(pageToken ? { pageToken } : {})
      }
    });
    tasks.push(...(data.items || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return tasks;
}

/**
 * @param {Object} client @param {string} listId @param {Object} task - { title, notes, due, status }
 * @returns {Promise<GoogleTask>}
 */
async function insertTask(client, listId, task) {
  const { data } = await client.request({ url: `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`, method: 'POST', data: task });
  return data;
}

/**
 * @param {Object} client @param {string} listId @param {string} taskId @param {Object} changes
 * @returns {Promise<GoogleTask>}
 */
async function patchTask(client, listId, taskId, changes) {
  const { data } = await client.request({ url: `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, method: 'PATCH', data: changes });
  return data;
}

/** @param {Object} client @param {string} listId @param {string} taskId */
async function deleteTask(client, listId, taskId) {
  try {
    await client.request({ url: `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, method: 'DELETE' });
  } catch (error) {
    if (!isNotFound(error)) throw error; // already gone
  }
}

module.exports = { ensureList, listChanged, insertTask, patchTask, deleteTask, isNotFound, LIST_TITLE };
