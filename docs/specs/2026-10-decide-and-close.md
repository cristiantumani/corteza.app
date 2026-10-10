# Decide and close

**Status:** approved (Oct 10, 2026). Builds on cross-meeting links (`docs/specs/2026-10-cross-meeting-links.md`).

## Why

Decisions are often made outside a captured meeting: an analysis, a hallway chat, an email. When
someone decides "we're not going for ISO 27001 for now", the open questions, risks and action items
about it stay open in Corteza, and closing them means finding each one by hand. Corteza already knows
how to find what a new decision resolves (cross-meeting links); here the decision comes from a
sentence the person types instead of a meeting.

## The flow

1. On **Search** or Home's **Ask across meetings**, the person types a decision: "Decidimos no ir por
   ISO 27001 por ahora".
2. Text that reads like a decision (decision words such as "decidimos", "acordamos", "no vamos a",
   "we decided", "we won't", and not a question) goes to `POST /api/decide/preview` instead of search.
   Claude confirms it is a decision; when it isn't, the page runs the normal search. The card always
   offers **"No, it was a question"**, which runs the search.
3. Corteza finds the **open** items about the same subject in everything the person can see (the
   cross-meeting links candidates: embeddings, then one Claude call that judges each candidate), and
   shows a card:
   - **Record decision:** the decision, cleaned up by Claude (editable), and **Why** (optional).
   - **This would close:** each item with its type, meeting, owners and what happens to it:
     - question → *Answered*; risk → *Mitigated*; action item → *Done* (the decision completes it);
     - or **No longer applies** (`drops`): a question or risk closed as no longer relevant, an action
       item **cancelled** (not done).
     - Items Claude is sure about come **checked**, unsure ones unchecked.
     - A colleague's action item can be closed only by someone who could change it anyway (an owner,
       its author or an admin); otherwise it shows unchecked and disabled, "Only its owners or an
       admin can close it".
   - **Related, still open:** same subject, nothing to close (no checkbox).
4. **Record and close N** (or **Record decision** when nothing is checked):
   - the decision is saved (`createDecision`, the person's personal space, `rationale` from Why);
   - it joins the thread of what it closes (topic threads), and sensitive threads stay sensitive;
   - the chosen items close, each with a note naming the decision ("Decided: …" / "No longer applies: …");
   - its `resolves` keeps what it closed, like a meeting's decision.
5. **Undo** (in the confirmation): reopens what was closed and deletes the decision.

One sentence, one card, one confirmation: no open-ended chat.

## API

- `POST /api/decide/preview` `{ text }` → `{ is_decision, decision, items: [Proposal], related: [Proposal] }`.
  `aiRateLimiter`, `requireAiBudget`; the Claude call is recorded as feature `decide`.
  No Claude call when nothing similar is open (the text is the decision as typed).
- `POST /api/decide` `{ text, rationale?, close: [{ kind, id, relation }] }` → `{ decision, closed }`.
  Every item is checked again: the person can see it, it is still open, the relation fits its type
  (question: answers|drops; risk: mitigates|drops; action item: completes|drops) and, for an action
  item, they may change it. Anything else is skipped.
- `POST /api/decide/:id/undo` → reopens what it closed and deletes the decision (only the person who
  recorded it).

`Proposal`: `{ kind: 'decision'|'action_item', id, type, text, meeting, date, owners, due_date,
relation, confidence: 'high'|'low', reason, can_close }`.

## Data

- Cross-meeting `resolves` entries gain the relation `drops`. Closing a `drops` entry resolves a
  question or risk with the "No longer applies" note, and cancels an action item; undo reopens it.
- The decision's `source_details`: `{ type: 'dashboard', via: 'decide' }`.

## Not now

- Other commands with the same card: "we moved the launch to November" (due dates), "Nico takes X"
  (owners).
- A multi-turn chat.

## Tests

- Unit: the decision-words check; Claude's reply parsed (labels, relations per type, confidence).
- Integration: preview finds related open items only in the person's spaces; decide records the
  decision, closes the chosen items (drops cancels an action item), skips items they can't change or
  can't see; undo reopens and deletes; preview without similar items doesn't call Claude.
