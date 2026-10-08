# Closing an action item closes the loop

**Status:** approved (Oct 8, 2026). Extends the close-the-loop prompts of topic threads (`docs/specs/2026-10-topic-threads.md`).

## The problem

Marking an action item done offered to answer the open questions of its thread, but never its
risks (only after a question was answered), nothing for items without a thread, and nothing at
all when an item was cancelled, which can leave a question or risk with nobody working on it.

## What's related to an action item

The open questions and risks (not resolved, not dismissed, in the person's spaces) of:

1. **its thread** (`topic_id`), else
2. **the outcome it carries out** (`decision_id`): that outcome's thread if it has one, else the
   other questions and risks of the same meeting (`source_details.external_id`), plus the outcome
   itself when it's a question or risk.
3. Neither: nothing. No guessing.

At most 6, questions first.

## Marked done

The page shows one prompt, **"Does this also resolve…?"**, listing the related questions and risks
**unchecked** (the link is "same thread or meeting", not a judgement that it's resolved). A checked
question can take an answer. **Close selected** marks questions answered and risks mitigated, with
the note (for a risk, a default note naming the action item); **Not now** dismisses it. Nothing
closes without a click.

## Cancelled

A cancelled item resolved nothing, so nothing is offered to close. When it was the **last open
action item** (that the person can see) of its thread or meeting, the related open questions and
risks are left without a next step, and the page says so:

> This question is left with no action items: "…" · **Add an action item** · **That's fine**

Add an action item opens a one-line form; the new item is linked to that question or risk
(`decision_id`) and joins its thread, owned by the person.

## API

`PATCH /api/action-items/:id`:
- marked done (from open): `may_resolve: [{ id, type, text }]` (replaces `linked_questions`)
- cancelled (from open): `orphaned: [{ id, type, text }]`

`POST /api/action-items` with `decision_id`: the new item also takes the outcome's thread.

Closing uses the existing `POST /api/questions-risks/:id/resolve`.

## Tests

- Integration (`test/integration/close-loop-actions.test.js`, core and API): thread, decision's thread, same
  meeting, the outcome itself, nothing without links, access (other spaces), dismissed and resolved
  left out, orphaned only when no other open item is left, done and cancel responses, new item joins
  the thread.
