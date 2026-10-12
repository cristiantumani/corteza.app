# First use: see value in a minute

**Status:** approved with changes (Oct 12, 2026): 10 pre-checked / 3 live, 1:1s like any other meeting,
static example, "How it works" stays. Linear COR-45 (Fase A). The 4-step tour (COR-12,
`partials/onboarding.html`) stops opening on first run and stays behind "How it works".
ROADMAP A4 ("Onboarding in under 5 minutes"; metric: time to first decision).

## Why

On their first visit, a new person doesn't see Corteza do anything:

- The 4-step tour opens over Home, which is still empty, and covers the page that would explain things.
  Only step 1 has an action.
- "Import past meetings" only shows up after Google Meet is connected, and it lives in Settings.
- After connecting, there's no "waiting for your first meeting" state. Home looks empty.
- Imports go through the Message Batches API: half the price, but results take minutes and sometimes
  hours. A first import can look like nothing is happening.

The goal: from sign-in to the first outcome on screen, with its quote and its meeting, in about a
minute, whenever the person has a recent meeting with a transcript or Gemini notes.

## What changes

### 1. "Get started" on Home (instead of the tour on first run)

While setup isn't done (below), Home shows one **Get started** panel at the top instead of the capture
panel, in the page and not as a modal. It has three numbered steps. The current step is open, done
steps collapse to one line with a check, and later steps are greyed out.

1. **Connect Google.** One line on what Corteza reads and what it never keeps ("Transcripts are never
   stored, only the outcomes"), then **Connect Google Meet** → `/integrations/google/connect` (the
   disclosure page, then Google). The callback returns to `/dashboard?google=connected` when the
   connection started from Get started, and to Settings otherwise (see API).
2. **Choose meetings.** The person's meetings from the last 7 days (`maxDaysBack()`), newest first,
   from `GET /api/integrations/google/meetings`. Each row shows the title, when it was, and whether it
   has a transcript or notes.
   - Meetings with a transcript or notes that Corteza hasn't processed yet are **pre-checked**, up to
     **10** (`FIRST_IMPORT_DEFAULT_MAX`). 1:1s are treated like any other meeting (section 7).
   - Meetings without a transcript or notes are greyed out, with "No transcript or notes".
   - **Import N meetings** starts the import (`POST /api/integrations/google/imports`, into the personal
     space). **Skip** goes to step 3 without importing.
   - If no meeting in the period has a transcript or notes, this step says so in one line, with how to
     turn them on (transcription or Gemini "Take notes for me"), and moves on to step 3.
3. **See what Corteza found.** Outcomes appear as they arrive, newest first: type, text, the quote
   that backs it, and the meeting it came from. Confirm and Dismiss work in place (the existing review
   card, `public/scripts/outcome-review.js`). Above them, one progress line: "3 of 8 meetings read ·
   12 outcomes so far". When the import finishes, the panel turns into the normal Home, and the
   outcomes stay in the review queue.

**Done** means the person has at least one outcome, or chose "I'll do this later" (a link in the
panel). After "later", Home shows the existing connect card or the waiting state (below). Get started
doesn't come back, but it is never needed to use the app.

### 2. The first outcomes arrive fast

An import started from Get started extracts its **first 3 meetings live** (the pipeline, full price),
so outcomes appear within a minute. The rest go through the batch at half price, as today. Imports
from Settings don't change.

### 3. Waiting for the first meeting

When Google Meet is connected and the person has no outcomes and no running import, Home's capture
panel shows:

> **Waiting for your first meeting.** Corteza checks for new meetings every 5 minutes. Turn on
> transcription or Gemini "Take notes for me" in your next Google Meet.
> [Check now] [Import past meetings]

"Check now" is the existing `POST /api/integrations/google/sync`. "Import past meetings" opens step 2
of Get started in place, not Settings.

### 4. An example when there's nothing to show

If step 2 finds no meeting with a transcript or notes, step 3 shows **one example meeting**, clearly
labeled ("Example · not your data"): a fictional "Weekly product sync" with one decision, two action
items and one open question, each with its quote. It's static (`src/data/sample-meeting.js`, EN and
ES), rendered in the panel, and never saved, searched or counted. It goes away when the first real
outcome arrives.

### 5. Hints, and "How it works" on demand

The 4-step overlay no longer opens by itself on first run, where it covered an empty Home. It stays
as it is behind the sidebar's **How it works**, for anyone who wants to see how Corteza works after
setup. What it explained also shows up once, in context, the first time each page has something to
show:

- **Search**, when the person has at least one outcome: one line under the box, "Ask in your own
  words, or type a decision like 'We decided not to go for ISO 27001' to close what it settles", with
  the three example questions as chips.
- **Action items**, when the list has at least one item: "Mark items done as you go. Items with no due
  date get an email to their owner."
- **Settings → Context for the AI**, for admins, once the workspace has outcomes: "A short description
  and a glossary help Corteza spell names right and capture what matters."

Each hint has a close (×) and doesn't come back after that.

### 6. Sign-in page

The title ("Sign in to Corteza"), the subtitle and the Privacy and Terms links are already there.
Add one line under the button: "Transcripts are never stored, only the outcomes." in both languages.

### 7. 1:1s are meetings like any other

1:1s are often where the most important commitments are made, so Corteza stops treating them
differently:

- Automatic capture no longer skips meetings with 2 or fewer participants: the `one_on_one` rule in
  `skipReason` (`jobs/meet-poller.js`) and the `skip_one_on_one` setting are removed
  (`connections.js` defaults, `PUT /api/integrations/google/settings`, the Settings checkbox and its
  copy, including "1:1 meetings are skipped by default").
- Anyone who wants to leave some meetings out still can, by title ("Exclude meetings by title", e.g.
  "1:1, interview").
- What protects 1:1s is what protects every meeting: outcomes go to the personal space of the person
  who connected, and sensitive topics (performance, leaving, pay, health…) stay visible only to them.
- 1:1s skipped before this change stay skipped (no surprise processing or AI cost). They can be
  imported like any past meeting. The "1:1 meeting, skipped" label stays for those old records.
- The stored `skip_one_on_one` field is ignored and left in place (no migration).

## Data and API

- `workspace_members.setup_dismissed_at` (Date, optional): set by "I'll do this later".
  `workspace_members.hints_seen` (`{ search?, actions?, context? }`: Dates): set when a hint is
  closed. `onboarding_seen_at` stays but no longer decides anything: the tour only opens from
  "How it works" (`/dashboard?tour=1`).
- Get started shows when **no outcomes in the person's spaces** AND **no `setup_dismissed_at`**.
  Existing people who already have outcomes never see it, so no migration is needed.
- `GET /api/onboarding` → `{ setup: { show, connected, has_outcomes, active_import }, hints_seen, is_admin }`.
  Home's preload gets the same `setup` object, so the panel renders without a second request.
- `POST /api/onboarding/setup/dismiss`, and `POST /api/onboarding/hints/:name/seen` (name ∈ search, actions, context).
- Connect from Get started: `/integrations/google/connect?from=setup` stores `from` in the session's
  `googleConnect`, and the callback redirects to `/dashboard?google=connected` instead of Settings
  (errors go back to the dashboard too, with `google_error`).
- `startImport(connection, ids, spaceId, { liveFirst: 3 })`: the first `liveFirst` meetings go through
  the live pipeline, the rest through the batch. Only `POST /api/integrations/google/imports` with
  `{ from: 'setup' }` sets it. The server caps the request at 10 meetings in that case.
- Step 3 polls `GET /api/integrations/google/imports/:id` (progress) and `GET /api/home` (the review
  queue) every 5 s while the import runs, then stops.
- The sidebar's "How it works" (`/dashboard?tour=1`) keeps opening the tour; `onboarding.js` no
  longer opens it on its own.

**AI cost.** The default selection is at most 10 meetings, and only 3 run at full price. The AI budget
checks (`checkAiBudget`) apply as they do today. In the worst case, one new person costs about
3 live extractions plus 7 batch extractions.

**Analytics (PostHog, counts only):** `setup_step_viewed` { step }, `setup_import_started`
{ meetings, preselected }, `setup_dismissed` { step }, `first_outcome_shown` { seconds_since_signup },
`hint_closed` { name }. `first_outcome_shown` is the A4 metric.

## Not now

- Asking for Meet permissions at sign-in, which would make one Google screen instead of two. It
  changes the scopes Google verification reviews, so it can wait until after verification.
- A setup checklist for admins (invite colleagues, company context). The context hint covers the
  most important part.
- Importing more than 7 days back from Get started.
- A product video or a tour of the app on its own.

## Tests

- Unit: `shouldShowSetup` (no outcomes / outcomes / dismissed); pre-selection (only ready and new
  meetings, 1:1s included, at most 10, newest first); `skipReason` no longer skips 1:1s but still
  excludes by title; `startImport` with `liveFirst` sends the first 3 live
  and the rest to the batch, and without it sends all to the batch, as today.
- Route: `/integrations/google/callback` with `from=setup` redirects to the dashboard, including on
  errors; `POST /imports` with `from: 'setup'` refuses more than 10 meetings; the hints and dismiss
  endpoints validate the name.
- Integration: `meet-capture.test.js` now expects 1:1s to be captured (its "skips 1:1s" case changes).
- `i18n.test.js` covers the new keys in both languages; the `onboarding.*` keys stay for the tour.
- Preview fixtures (`scripts/preview.js`): Get started at step 1, step 2 with meetings, step 3 with
  outcomes arriving, step 3 with the example, the waiting state, and each hint. Desktop and mobile.

## Decided (Oct 12, 2026)

1. Defaults: 10 meetings pre-checked, the first 3 extracted live.
2. 1:1s are treated like any other meeting, in Get started and in automatic capture (section 7).
3. The example meeting is a static card in the panel.
4. "How it works" stays in the sidebar and opens the tour on demand.
