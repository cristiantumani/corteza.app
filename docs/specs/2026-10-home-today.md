# Prepare your day (Home)

**Status:** approved (Oct 9, 2026). ROADMAP B5b. Builds on meeting prep (`docs/specs/2026-10-meeting-prep-series.md`).

## Why

The morning summary lists today's meetings with what is open from each one's own history, but an
email can't be worked: nothing can be opened, ticked off or revisited after the next meeting. Home is
where the day is worked, so the same prep lives there too.

## What it shows

A **"Prepare your day"** section on Home, right under the three boxes (what I owe, questions, risks)
and above "Ask across meetings":

- One row per meeting **still ahead today** (or happening now): time, title and a summary
  ("4 open · 1 overdue", "Suggested: 2 items you share", "Nothing connected yet").
  Meetings that already ended today disappear.
- The **next meeting is open** (with "in 40 min", or "Now" while it runs); the others are closed and
  open in place. Meetings with nothing connected are in grey and can't open.
- Opened, a meeting shows the same content as the morning summary (`core/briefs/meeting-prep.js`):
  its open action items (everyone's), its open questions and risks, what was closed since last time,
  or for a 1:1 without history the open items shared with that person, as a suggestion.
- **Mark as done** right there: a circle on each open action item the person owns ticks it off
  (`PATCH /api/action-items/:id`), with undo, and the existing close-the-loop prompt
  ("Does this also resolve…?", `public/scripts/close-loop.js`) under the section. Each item's text
  opens it on the Action items page.
- At most 4 meetings, then "Show N more".
- No calendar access: one line, "Connect your calendar to prepare your meetings" → Connect
  (`/integrations/google/connect`). No Google connection at all: the section is hidden (Home already
  offers to connect Google Meet).
- No meetings left today: one quiet line, "No more meetings today".

## API

`GET /api/home/today` → `{ status: 'ok'|'no_calendar'|'no_google', meetings: MeetingPrep[] }`,
in the person's time zone. Each meeting also has `end` (ISO) and `overdue` (how many of its open
items are overdue). Home loads it after the rest of the page (Calendar and Meet take 1–3 s).

**Cache:** the Google part (today's events and each meeting's Meet history) is kept in memory per
person for 10 minutes; Corteza's own data is read on every request, so an item ticked off doesn't come
back. Nothing from Google is stored in the database or logged. The morning summary doesn't use the
cache.

## Not now

- Days ahead ("Tomorrow").
- Marking colleagues' items done, or editing items from here.

## Tests

- Unit: `buildMeetingPrep` gives `end` and `overdue`; meetings that ended are left out.
- Integration-free route test: `/api/home/today` statuses (no Google, no calendar, ok) with injected
  dependencies; the Google part is cached and Corteza's data is not.
- Preview fixtures for Home with meetings, and with no calendar.
