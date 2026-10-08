# Sensitive topics

**Status:** approved (Oct 8, 2026).

## Why

Some meeting outcomes are confidential people matters: a dismissal, someone leaving, an individual's
low performance, a restructuring that names who stays. They come up in 1:1s with the people who will
help carry them out, so the AI assigns those people action items, and an action item reaches every
owner (Action items, the morning summary, "new from a colleague"), even from the capturer's personal
space. These topics must stay with the person whose meeting it was, whoever else is named.

## The rule

A **sensitive** outcome or action item is visible only to one person (`private_to`):

- it lives in that person's personal space (outcomes are only reachable through spaces);
- an action item's other owners keep their name on it but get no access: `owner_ids` holds only
  `private_to`, and only when they own it. Every list (Action items, morning summary, search, meeting
  prep, close-the-loop, "new from a colleague") grants access through spaces or `owner_ids`, so none of
  them reaches a colleague. The person it's private to does the follow-up.

## How items become sensitive

1. **Automatically.** The extraction marks `sensitive: true` for: dismissals or layoffs; someone leaving
   or being asked to leave; an individual's low performance or a performance plan; pay or compensation
   of named people; health; legal or disciplinary matters about a person; a restructuring that names who
   stays or goes. When in doubt, sensitive.
2. **The whole thread.** One sensitive item makes its thread sensitive: in the capture
   (`ingestion/pipeline.js`), and when an item of another meeting joins the thread later
   (`spreadSensitivity`, called by cross-meeting links).
3. **By hand.** "Mark as sensitive" in the outcome detail modal and in the action item editor marks the
   item, its thread and the items tied to it (`decision_id`), private to the person marking it, and moves
   them to their personal space. Only that person can take the mark off; then owners get access back.

Captures with no person behind them (Slack) can't be private to anyone and stay as they are. The upload
review screen saves what the person approved; those can be marked by hand.

## Data

`decisions` and `action_items`: `sensitive` (boolean) and `private_to` (user_id or null).

## API

`PUT /api/sensitive` `{ kind: 'decision'|'action_item', id, sensitive }` → `{ decisions, action_items }`
(how many changed). 404 when the person can't reach the item; 403 when someone else's mark is taken off.

## UI

- A dark "🔒 Sensitive" chip on Action items and Questions & risks.
- Detail modal: "🔒 Mark as sensitive · Only you will see it, with its whole thread", or, when marked,
  "Only you see it · Remove the mark".
- Action item editor: a "Mark as sensitive" checkbox.

## Not now

- Reviewing what was already captured (a one-off AI pass with a dry run). The person can mark by hand.
- Copies in colleagues' own captures of the same meeting are theirs: the same detection marks them
  private to them.

## Before deploying

The extraction prompt changed: run `node scripts/eval-extraction.js` before and after (calls Claude).

## Tests

- Unit: `ownerIdsFor`, the extraction flag.
- Integration (`test/integration/sensitive-topics.test.js`): the pipeline marks the thread and the
  colleague loses access to their task; marking and unmarking through the API (thread, decision ↔ action
  items, 404 for the colleague, invalid input); spreading to items that join later; owner edits keep it
  private.
