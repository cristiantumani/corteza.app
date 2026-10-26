# My action items in Google Calendar (Google Tasks sync)

**Status:** approved and built (Oct 26, 2026). Linear COR-59. Decisions at the end.

## Why

Action items only work when the owner sees them at the right moment. Today they live in Corteza,
the morning summary and (since COR-58) the person's AI assistant. People live in Google Calendar.
Google Tasks with a due date show up on Google Calendar, on the web and on the phone, next to the
day's meetings. Putting each person's Corteza action items there makes them hard to miss. That's
"Corteza makes sure decisions stick" where people already look, with no new app.

## What Google allows (checked Oct 26)

- The Tasks API creates and changes tasks **only in the task lists of the account that granted
  access**. It can't assign a task to another person. Google's own "assigned tasks" come from Docs
  and Chat, and the API can only read them (`assignmentInfo`).
- A task with a due date appears on that person's Google Calendar. The API keeps the **date only**:
  any time is dropped.
- Scope `https://www.googleapis.com/auth/tasks` is **sensitive, not restricted**. It adds a line to
  Google's verification (a justification and the demo video), not a security assessment.

So each person syncs **their own** action items with **their own** Google connection. When Bruno's
meeting gives Ana an item, it reaches Ana's calendar through Ana's connection, if she turned this on.

## The experience

**Settings → Google Meet** (the Google connection card), a new switch below Calendar:

> **My action items in Google Calendar**: Corteza adds your open action items that have a due date
> to a "Corteza" list in Google Tasks, so they show on your Google Calendar. Mark one done or move
> its date in Google and Corteza follows. *(off)*

- Turning it on, when the connection doesn't have the Tasks permission yet: Corteza explains it
  first (the connect page, as for every Google permission), then sends the person to Google's
  consent screen for that one scope (incremental authorization, `include_granted_scopes`). Back in
  Settings, the switch is on and the first sync runs right away.
- While on, Settings shows "Synced N action items · last sync 10:42" and a link to open Google
  Tasks.
- Turning it off stops the sync both ways: nothing new is added, and what the person completes or
  moves in Google no longer reaches Corteza. The tasks already in Google stay there.
- Without a Google connection (or a lost one), the switch explains it needs Google connected first.

**In Google:** a task list named **Corteza**. Each task:
- title: the action item's text;
- details: the why (if any), "From: <meeting> · <date>", and "Open in Corteza: <link>";
- due date: the action item's due date (none if it has none).

## Sync rules

Runs for each person who turned it on: right after turning it on, then in the poller's 5-minute cycle
(`src/jobs/meet-poller.js`) both ways. A short lease per connection keeps the first sync and the
poller from running at once. Which Google changes are new is read with Google's own clock (the
newest `updated` of our tasks), never ours.

**Corteza → Google**

| In Corteza | In Google Tasks |
|---|---|
| An open action item the person owns (in `owner_ids`) **with a due date**, sensitive ones included | A task in the Corteza list (created once, then updated) |
| Its text, why or due date changes | The task is updated |
| Marked done | The task is completed |
| Cancelled, deleted, reassigned to someone else, or its date removed | The task is deleted |
| Reopened | The task is back to "needs action" |

**Google → Corteza** (only for tasks Corteza created, in the Corteza list)

| In Google Tasks | In Corteza |
|---|---|
| Completed | The action item is marked done (the person owns it, so the app's rule allows it), with `changed_via: { kind: 'google_tasks' }`, and shows "via Google Tasks" |
| Un-completed | Reopened |
| Due date changed | The due date is updated |
| Due date removed | The item's date is cleared, so the task leaves the list on the same sync |
| Deleted | Nothing changes in Corteza. The task isn't created again unless the item changes |
| Title edited | Ignored: Corteza's text wins on its next change (titles are the meeting's record) |

Conflicts: the last change wins, comparing the task's `updated` time with the item's `updated_at`.

## Data

- On `google_connections` (not in `settings`, which the capture settings form replaces): `tasks_sync:
  boolean` (default off), `tasks_list_id`, `tasks_pulled_at`, `tasks_synced_at`, `tasks_count`,
  `tasks_last_error`, `tasks_lease_until`. A deleted Corteza list is created again (and every task
  with it).
- New collection **`google_task_links`**: `{ workspace_id, user_id, item_id, task_id, list_id,
  synced_at, item_version, task_updated, status }`, one per person and action item. It holds no content
  (ids and dates), so it isn't encrypted. Indexes: `{ workspace_id, user_id, item_id }` unique,
  `{ workspace_id, user_id, task_id }`.
- What leaves Corteza: the text, why, meeting title and link of the person's own action items, to
  **the person's own Google account**. Privacy policy (EN/ES), `/security`, the connect page and the
  questionnaire are updated in the same PR. Google verification doc: the `tasks` justification.
- Logs and PostHog: counts only (`google_tasks_sync_enabled`, `google_tasks_synced` with created,
  updated, completed and pulled counts).

## Code

- `src/integrations/google/tasks-client.js`: the Tasks API (lists, insert, patch, delete, list
  changed since), through the person's refreshed token.
- `src/core/actions/google-tasks-sync.js`: `syncPerson(workspaceId, userId)`: push, then pull, with
  the rules above; reuses `listActionItems` and `updateActionItem`.
- `src/integrations/google/connections.js`: `TASKS_SCOPE`, `hasTasks(connection)`, and
  `buildConnectUrl({ extraScopes })` for the incremental consent.
- Routes: `PUT /api/integrations/google/tasks-sync { enabled }` (off, or on when the scope is there;
  else `{ needs_consent: true, url }`); `/integrations/google/connect?tasks=1` explains the Tasks
  permission and asks for it on top of the others, and its callback turns the sync on when granted.
- `src/jobs/meet-poller.js`: calls `syncPerson` for connections with `tasks_sync` on, with failures
  reported (`reportError`) and isolated per person.
- UI: the switch and status in `public/scripts/settings-integrations.js`, i18n EN/ES; "via Google
  Tasks" where "via Claude" shows.

## Not in this version

- Assigning to colleagues who haven't turned it on (Google doesn't allow it).
- Calendar *events* (time blocks) for action items: they'd clutter other people's calendars and need
  the calendar write scope.
- Syncing questions and risks (they aren't tasks).
- Google Tasks created by hand becoming Corteza action items.

## Tests

- Unit (with a stubbed Tasks client): push creates, updates, completes and deletes per the table;
  pull completes, reopens and moves dates; sensitive items never sync; a deleted task isn't
  recreated; conflict by last update.
- Integration: turning it on without the scope returns the consent URL, and with it runs the first
  sync. The poller calls the sync only for people who turned it on. Another person's items never
  sync to your list.

## Decisions (Oct 26, Cristian)

1. **In Settings, off by default.**
2. **Which items:** only open action items **with a due date**.
3. **Sensitive items:** synced too, with their real text. It's the person's own Google account.
4. **Turning it off:** the tasks stay in Google. Nothing new is added, and closing or moving them in
   Google no longer reaches Corteza.
