# Home overview: the three questions in one place

**Status:** built (Oct 4, 2026) · **Owner:** Cristian · **Linear:** COR-41 · **Source:** UX audit, proposal A

## Problem

Home was built around the capture pipeline. The Google Meet card took the best spot, the list showed only decisions by default, and "to review" and "overdue" weren't visible at the top. Answering "what was decided, what do I owe, what is still open" meant reading three panels and a list. Searching meant going to another page.

## Concept

Home is where the main actions happen: knowing what's pending (action items, risks, open questions) and searching across meetings, without leaving the page.

## Behavior

1. **Summary sentence** under the title: "In the last 24 hours: 3 new outcomes from 1 meeting. Needs you: 1 action item overdue · 2 to review."
   - Each count links to its view: new outcomes → All outcomes, overdue → `/actions?due=overdue`, to review → the queue.
   - With nothing new and nothing pending, it says "All caught up".
2. **Ask across meetings.** A search box on Home uses the same semantic search as Search (`POST /api/semantic-search`, same AI limits).
   - The answer shows on Home with up to three of the sources it used: type, text and meeting. "1 not reviewed yet" appears when a source is an unconfirmed AI capture.
   - "Open in Search" continues the conversation there.
3. **Google Meet status in one line:** capturing, last check, totals, "Check now", "Import past meetings", and the latest meetings folded away.
   - Reconnect warnings and import progress still show.
   - The not-connected card stays as it is (first-run work is COR-45).
4. **Review queue**, when there's something to review: one AI-captured outcome at a time, with its why, quote and meeting.
   - Buttons: Confirm, Dismiss (with undo), Skip, and "Confirm all N from this meeting".
   - It only lists outcomes the person may review: their own, or anyone's for an admin (the same rule as the review API).
5. **Three columns:**
   - **What I owe:** their open action items, most urgent first. A tick marks one done, with undo.
   - **Still open:** open questions and risks with when they were raised.
   - **Decided:** the latest decisions someone confirmed or logged by hand.

   Each column has a link to its full page and an empty state that says what will appear. "What I owe" comes first because what needs the person comes first (design skill §2.3).
6. **Tabs:** Overview (default) and All outcomes, which is the previous list with its filters, Log manually and Upload transcript. The "Filter…" box moved from the top bar into that tab. `#all` in the URL opens it.
7. **Privacy:** everything comes from the spaces the person can access, plus action items they own. Never a colleague's private data.

## Data and API

- `GET /api/home` (`src/http/home.js` → `src/core/home/overview.js`, `buildHomeOverview`) returns `since`, `summary` (counts), `owe`, `open`, `decided` and `review` (the queue, at most 20).
- Counting new outcomes reads only ids and the meeting id, never outcome text.
- No new collection or field.

## Tests

- `test/integration/home-overview.test.js` covers:
  - counts, including distinct meetings and a private space left out;
  - owe ordering;
  - open items without resolved ones;
  - decided limited to confirmed or manual;
  - the review queue limited to the person's own outcomes, and an admin seeing everyone's;
  - the API session check.
- Browser check with `preview.js` (default and empty states, desktop and mobile): ask, open a source, confirm, mark done with undo, and switch tabs.
