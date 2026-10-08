# Meeting prep from the meeting's own history

**Status:** approved (Oct 8, 2026). Replaces the attendee-based matching of the first meeting prep (`core/briefs/meeting-prep.js`).

## The problem

The morning summary's "Prepare for today's meetings" listed, for each meeting, the open action items
of **the people in it**. An item from a 1:1 with Cristopher showed up in every meeting Cristopher was
invited to (a weekly with 8 people, a board meeting), and big meetings got "and 22 more". It copied
data instead of understanding which meeting an item belongs to.

## The rule

A meeting on today's calendar is connected to **its own history**, never to its attendees.

1. **Same Meet link → same meeting.** A recurring meeting keeps one Meet link (meeting code
   `abc-defg-hij`). The calendar event gives the code; the Meet API lists the past conference records
   of that code (`conferenceRecords.list`, filter `space.meeting_code`). Items and outcomes captured
   from any of those records (`source.external_id` / `source_details.external_id`) belong to this
   meeting. Works for everything already captured: no backfill.
2. **Same title, as a fallback,** for meetings without a Meet link, Meet errors, and captures that
   weren't from Meet (uploads). Titles are normalized (case, accents, punctuation).
3. **A shared personal link isn't the same meeting.** When a code matches but both titles are real
   and share no word, the item is left out (someone reusing their personal room for everything).
4. **Never by attendees alone.**

Only what the person can see counts: outcomes in their spaces, action items in their spaces or
owned by them. Copies of the same item (colleagues capturing the same meeting) show once.

## What each meeting shows

**A meeting with history** (a series):

- *Last time: Oct 1.* (the most recent earlier instance)
- **Open action items** from the series, **everyone's**, with the owner (or "You"), due date,
  overdue in red. Overdue first, then by due date. Up to 5, then "and N more".
- **Open questions and risks** from the series, up to 3.
- **Closed since last time:** action items done and questions/risks resolved since the last
  instance, up to 3, with a check mark. Progress you can report.
- Nothing open or closed: "Nothing open from this meeting."

**A meeting without history**: still listed, with "No action items connected to this meeting yet."

- **1:1 without history** (exactly one other person): *Suggested, since you're meeting:* the open
  action items you share with that person (yours they co-own, theirs you can see), up to 3.

Meetings with nobody else (focus time) stay out. Up to 8 meetings.

The summary is sent on a day with meetings only when at least one meeting has something to show
(items, questions, closed items or suggestions): a calendar alone isn't news.

## Privacy and cost

- Calendar events and Meet records are read when the summary is built, never stored or logged.
- One Meet API call per meeting that has a Meet link (at most 8 per person per day), no AI calls.
- Logs keep ids and counts only.

## Later (not in this PR)

- A one-line AI prep per meeting ("Arrive with Nicolás's benchmark: due today, the only one late").
- Topic matching for one-off meetings (event title and description against open items), shown as
  "May be related" only with high similarity.

## Tests

- Unit (pure `buildMeetingPrep`): series by record id, title fallback, personal-room guard, no
  attendee leakage (the 1:1 item doesn't show in the weekly), everyone's items with owners, closed
  since last time, questions and risks, meeting without history, 1:1 suggestion, copies once, caps.
- Unit: meeting code from the calendar event (`hangoutLink`, `conferenceData`).
- Integration: `getMeetingPrep` with stubbed calendar and Meet, real database (access rules), summary
  news rule, the email section.
