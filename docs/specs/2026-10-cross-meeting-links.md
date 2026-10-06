# Cross-meeting links: a new outcome closes the old ones on the same subject

**Status:** draft (Oct 6, 2026) · **Owner:** Cristian · **Roadmap:** B4 (automatic progress detection) · **Builds on:** `docs/specs/2026-10-topic-threads.md`

## Problem

Topic threads only group outcomes **from the same meeting**. A subject that runs over several meetings stays scattered. Example: "hiring a Product Designer" comes up in three meetings:

1. An open question: "Do we hire a designer this quarter?"
2. An action item: "Cristian interviews the shortlisted candidates."
3. A decision: "We hired Florencia as Product Designer."

When the decision arrives, the question and the action item stay open. Someone has to remember them and close them by hand, and usually nobody does.

## Behavior (acceptance criteria)

1. **Linking on capture.** When a meeting is captured, Corteza looks for **open** outcomes from earlier meetings on the same subject. Those are open questions, open risks and open action items, plus earlier decisions for context.
   - Corteza finds candidates by embedding similarity: the last 120 days, up to 15 per new item.
   - Claude then judges each pair: same subject or not, and if so, whether the new item **resolves** the old one.
     - A decision or answer can answer a question.
     - A decision can mitigate a risk.
     - A decision or report can show an action item is done.
   - Each judgement comes with a one-line reason and the quote that supports it.
2. **One thread.** New items on the same subject join the earlier item's `topic_id`. The old thread grows; no new thread is started. Questions & risks, Action items ("Part of") and the morning summary then show the whole history across meetings.
3. **Suggested closures, never automatic.** A new outcome stores what it **may close**: `resolves: [{ kind: 'decision'|'action_item', id, relation: 'answers'|'mitigates'|'completes', reason }]`. Nothing is closed until a person confirms.
4. **Review card (Home) and detail modal.** An outcome with suggestions shows "This may close:" and a list of the earlier items, each with:
   - type, text and meeting/date;
   - owner and due date for action items;
   - a checkbox, checked by default.
5. **Confirm closes them too.** **Confirm** confirms the outcome and closes the checked items:
   - a question becomes *answered* and a risk *mitigated*, each with the note "Resolved by: <new outcome> (<meeting>, <date>)";
   - an action item becomes *done*.
   - One toast offers **Undo** for all of it.
   - **Dismiss** closes nothing and drops the suggestions.
6. **Already confirmed.** For an outcome that needs no review (logged by hand, or confirmed earlier), the detail modal shows the same list with a **Close selected** button.
7. **Privacy.**
   - Candidates come only from spaces the meeting's owner can access, plus action items they own.
   - A suggestion is shown only to people who can see both items. A colleague's private item is never shown.
8. **Cost and limits.**
   - At most one extra Claude call per captured meeting, and only when some candidate passes the similarity threshold.
   - The call is recorded with `recordAiUsage` (feature `cross_meeting_links`) and counts toward the daily caps.
   - Meet auto-capture is never blocked. Imports of past meetings skip linking.
9. **Existing data.** `scripts/migrations/014-cross-meeting-links.js` runs the same linking for outcomes still waiting for review, so today's queue gets suggestions. Like the other migrations, it is a dry run unless `--apply`.

## Out of scope (next steps)

- **Contradictions:** "this reverses decision #12" (roadmap C1).
- **Linking outcomes that are already confirmed** to each other after the fact.
- **Editing threads by hand.**

## Data

- `decisions`: `resolves` (array, above). `reason` is meeting content, so it goes in `FIELD_PATHS` (encrypted).
- `topic_id` is reused; there is no new collection.
- Embeddings already exist on `decisions` and `action_items`.

## Test plan

- **Unit:**
  - candidate selection (threshold, window, only open items, only accessible spaces);
  - parsing Claude's judgement;
  - the Confirm payload.
- **Integration:**
  - the pipeline links a new decision to an earlier question and action item, and joins their thread;
  - Confirm with suggestions closes the checked items, and Undo reopens them;
  - a colleague's private item is never a candidate.
- **Eval:** a labeled set of meeting pairs, with linking precision of at least 0.85 before turning it on for everyone. Precision matters more than recall: a wrong "this may close" costs trust.
