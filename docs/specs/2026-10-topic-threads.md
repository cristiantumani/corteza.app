# Topic threads: closing the loop on questions, risks and next steps

**Status:** approved (Oct 2, 2026) · **Owner:** Cristian · **Roadmap:** B1/B4 (follow-through)

## Problem

A meeting often produces several outcomes about one subject: an open question ("Should we pursue ISO 27001?"), a risk ("We lose enterprise deals without it") and a next step ("Cristian researches the requirements by Oct 16"). Corteza saves them as unrelated rows (`decisions` and `action_items`), so nobody sees that the action item is the way to answer the question, and nothing prompts closing the question when the work is done.

## Behavior (acceptance criteria)

1. **Threads.** Outcomes from the same meeting about the same subject share a `topic_id` and a short `topic` label. A thread is everything with that `topic_id`: open questions, risks, decisions (in `decisions`) and action items (in `action_items`).
2. **New meetings.** The extraction returns a `topic` for every item (a short label, the same for items about the same subject). The pipeline gives items with the same label in one capture the same `topic_id`. The existing `decision_ref` link (action item → the decision it carries out) stays.
3. **Questions & risks page.**
   - Each card shows a **Linked** section with the other items of its thread: type, text, owner and due date for action items, and status.
   - With "All" types, a risk whose thread has an open question in the list is shown under that question, not as a separate card. With the "Risks" filter it shows as its own card.
   - `/questions?topic=<id>` shows one thread.
4. **Action items page.** An item in a thread shows "Part of: <topic> · N questions, M risks", linking to `/questions?topic=<id>`.
5. **Closing the loop.** Corteza suggests and never closes anything by itself.
   - Marking an action item done when its thread has an open question asks "This was the next step on *<question>*. Mark it answered?", with an optional note.
   - Answering a question whose thread has open risks asks "Close the linked risk too?", one click per risk.
   - A decision in the thread is shown as "May answer this question" on the question's card.
6. **Morning summary.** A due or overdue action item whose thread has an open question shows "Next step on: <question>".
7. **Privacy.** Linked items follow the same visibility as everything else: only items in spaces the viewer can access, or action items they own. Never a colleague's private item.
8. **Existing data.** `scripts/migrations/010-topic-threads.js` groups outcomes and action items **from the same meeting** whose embeddings are close (cosine ≥ 0.55 by default, `--threshold`). It's a dry run unless `--apply`; the dry run lists the proposed groups by id (`--show-text` adds the first words of each item, for the operator's own terminal).

## Out of scope (next step)

- Linking across meetings ("the ISO topic came up again two weeks later"): roadmap B4, with Claude judging matches. It will reuse `topic_id`.
- Editing threads by hand (moving an item to another thread).

## Data

- `decisions` and `action_items`: `topic_id` (`top_<hex>`, null when an item has no thread), `topic` (label, at most 80 characters). Index `{ workspace_id, topic_id }` on both.
- No new collection.

## Test plan

- Unit: topic label normalization and grouping in the pipeline; email line.
- Integration: pipeline assigns shared `topic_id`s; thread lookup respects spaces; Questions API returns linked items and groups risks under questions; action items API returns the thread summary; migration groups the ISO-like case and leaves unrelated items alone.
- Eval: `node scripts/eval-extraction.js` before and after the prompt change; precision and recall per type must not drop. The new field doesn't change scoring.
