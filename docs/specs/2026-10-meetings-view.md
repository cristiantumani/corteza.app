# Meetings: what came out of each one

**Status:** approved and built (Oct 13, 2026). Linear COR-42 (UX · B). Builds on confirm/dismiss
(`core/decisions/review-service.js`), imports (`ingestion/meet-import.js`) and topic threads.

## Why

The first thing a new person looks for after a meeting is "what did Corteza get from **that**
meeting?". Today they can't see it in one place:

- Outcomes land in a flat list (Home → All outcomes), mixed with every other meeting, so "what came out
  of Planificación comercial Q4" means scanning and filtering.
- Meetings show up in two separate lists, the "latest meetings" folded inside Home's capture panel and
  "Latest meetings" in Settings → Google Meet. Neither opens the meeting's outcomes.
- A meeting Corteza skipped (a 1:1, an excluded title, too short) or failed to read can't be captured
  from there. You have to go to Import past meetings and find it again.

## What changes

### 1. A Meetings tab on Home

Home's tabs become **Overview · Meetings · All outcomes**. Meetings lists the person's own meetings,
newest first, 20 at a time with **Show more**, going back 90 days.

Each meeting is one row:

> **Planificación comercial Q4** · Yesterday, 16:20 · 1 decision · 1 open question · 1 risk · 2 action items · **3 to review**

- Counts use the existing outcome labels (`describeOutcomes`). "N to review" appears only when some of
  its AI-captured outcomes are still waiting, and it's the one orange element on the row.
- Skipped meetings stay in the list, greyed, with the reason ("1:1, skipped", "Title excluded",
  "Too short", "No transcript or notes") and **Capture anyway**, except "No transcript or notes", which
  has nothing to read.
- Failed meetings: "Couldn't be read" and **Try again**.
- Meetings still being processed: "Reading…".

### 2. A row opens in place with its outcomes

Clicking a row expands it, below the row, with everything that came out of that meeting, grouped by
type in this order: decisions, action items, open questions, risks.

- Each outcome: its text, its owner or due date when it has one, and the same per-item actions as the
  review card: **Confirm** and **Dismiss** (with the existing reasons) while it's waiting for review,
  and its status (answered, mitigated, done) once closed. The text opens the detail modal.
- **Confirm all (N)** at the top of an open meeting with outcomes to review, which reuses the review
  card's "Confirm all from this meeting".
- "In this thread" chips link to the thread view (`/questions?topic=`), the same as on Questions & risks.
- A link to the meeting itself (Meet recording/notes URL) when we have one.
- Rows open one at a time. The open row is in the URL (`/dashboard?tab=meetings&meeting=<id>`), so a
  link opens it, for example from the capture email or a later "what came out of…" link.

### 3. Logged by hand

Outcomes with no meeting behind them (Log manually, the Chrome extension, Slack, decide-and-close) go
in one row, **Logged by hand**, pinned under the meetings of the same day as the most recent one. It
opens the same way, newest first.

### 4. One list of meetings, not three

- Home's capture panel keeps its one status line ("Capturing from ana@… · checked 3 min ago") and
  drops its folded list of latest meetings. In its place, **See your meetings** opens the Meetings tab.
- Settings → Google Meet drops "Latest meetings" and links to the Meetings tab ("Your meetings are on
  Home → Meetings"). Import past meetings stays in Settings.

### Privacy

Only the person's own meetings (their `ingestions`, which are already per person) and only outcomes in
spaces they can see, plus action items they own. A colleague who attended the same meeting has their
own row in their own list. Sensitive outcomes behave as everywhere else: only `private_to` sees them.

## API

- `GET /api/meetings?before=<iso>&limit=20` → `{ meetings: [MeetingRow], next_before }`.
  `MeetingRow`: `{ id, title, occurred_at, status: 'completed'|'skipped'|'failed'|'processing',
  skip_reason, url, counts: { decision, action_item, open_question, risk }, to_review }`, plus one
  `{ id: 'manual', … }` row per day that has hand-logged outcomes. `id` is the ingestion's
  `external_id` (URL-safe encoded). The counts come from one aggregate over the outcomes visible to
  the person, grouped by `source_details.external_id`, and one over their action items, never a query
  per row.
- `GET /api/meetings/:id/outcomes` → `{ outcomes: [...], action_items: [...] }`, the same visibility
  rules and the same fields Home's review card uses. 404 when the person has no ingestion with that id.
- **Capture anyway / Try again:** `POST /api/integrations/google/imports` with `{ meeting_ids: [id] }`,
  as Import past meetings does. A manual import already re-processes skipped and failed meetings.
- Confirm / dismiss: the existing `POST /api/decisions/:id/review`.

No new collections and no migration. Titles stay encrypted (they're read through `getDatabase()`).
Queries filter only on ids, user, status and dates.

## UI and copy

English and Spanish (glossary): "Meetings" / "Reuniones", "Logged by hand" / "Registrado a mano",
"Capture anyway" / "Capturar igual", "Try again" / "Reintentar", "Reading…" / "Leyendo…",
"N to review" / "N por revisar", "Confirm all (N)" / "Confirmar todo (N)", "See your meetings" /
"Ver tus reuniones". Desktop and mobile; on mobile a row's counts wrap under the title.

## Not now

- Meetings of colleagues the person can see in shared spaces (only their own, for now).
- Search or filters inside the Meetings tab (Search already covers "what did we decide in…").
- Renaming a meeting, merging two captures of the same meeting, or moving outcomes between meetings.
- Removing the All outcomes tab (it stays for filtering by type, tag or space).

## Tests

- Unit: grouping and counts (one meeting, several, hand-logged by day), "to review" count, skip reasons
  mapped to actions.
- Integration: only the person's meetings and visible outcomes (a colleague's private outcomes from the
  same meeting don't count or show), pagination with `before`, `/outcomes` 404 for someone else's
  meeting, Capture anyway on a skipped 1:1 goes through the import and fills the row.
- Preview: Home → Meetings with a closed row, an open row with outcomes to review, a skipped and a failed
  meeting, and Logged by hand (desktop and mobile, EN and ES).
