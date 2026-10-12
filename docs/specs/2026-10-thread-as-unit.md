# The thread as a unit: "is this still open?"

**Status:** draft for approval (Oct 12, 2026). Linear COR-44 (points 1, 2, 3 and 5). Builds on topic
threads (`docs/specs/2026-10-topic-threads.md`) and cross-meeting links
(`docs/specs/2026-10-cross-meeting-links.md`).

## Why

Threads exist in the data (a question, its risks, the decisions about it and its next steps share a
`topic_id`, now across meetings), but on screen they read like an implementation detail: a grey
uppercase "LINKED · Plan anual" under each card, the same list repeated on every card of a topic, and
no way to tell at a glance whether a question is moving. The questions people ask are "is this still
open, and is anyone on it?" and "what did we end up deciding?". The thread is where Corteza answers them
(design skill §1.6).

Out of scope here: a decision's "What happened after" and "Revised / replaced" (needs the decision
lifecycle, roadmap A3).

## 1. Each open question and risk says where it stands

Under the text of every open question or risk that is in a thread (Questions & risks page, and the
thread view below), one line in plain words, computed on the server:

| Situation | Line |
|---|---|
| An open action item in the thread, not overdue | "Open 12 days · next step: Ana, due Oct 16" |
| Its earliest next step is overdue | "Open 12 days · next step overdue: Ana, Oct 2" (overdue part in the error colour) |
| A next step with no due date | "Open 12 days · next step: Ana, no due date" |
| No open action item in the thread | "Open 12 days · **No next step**" + **Add a next step** (the existing one-line form; the new item is linked to it and joins the thread) |
| A decision in the thread may answer it | adds "· a decision may answer it" (see 3) |

- "Next step" is the open action item of the thread with the earliest due date (no date last; then the
  oldest). Owner: the first owner's name, "you" when it's the viewer, "no owner" when none.
- Age: days since the outcome's `timestamp` ("today", "1 day", "12 days").
- Questions and risks without a thread show only the age.
- The grey "LINKED" header goes; the thread's items keep showing in the card as today, under a normal
  sentence-case heading "In this thread · <topic>" that links to the thread view.

## 2. A topic is one thread, not N cards

`/questions?topic=<id>` becomes the **thread view** (today it filters the same cards):

- **Header:** the topic's name as the title, and its state in one line: "2 open questions · 1 risk ·
  3 next steps (1 overdue) · last activity Oct 7", or "All settled · last activity Oct 7" when nothing
  is open.
- **Timeline:** every item of the thread the viewer can see (questions, risks, decisions, action items),
  oldest first, grouped by the meeting it came from ("Weekly Product Led Growth · Sep 18"), so the
  story across meetings reads top to bottom. Each item: type chip, text, status (open / answered /
  mitigated / done / cancelled), owner and due date for action items. Answered and mitigated items show
  their note.
- **Actions in place:** Mark as answered / mitigated / done, reopen, and the per-item actions of 3 and 5.
- Open questions get the status line from 1.
- Links into it: the topic name on Questions & risks cards, the "Part of" chip on Action items, and the
  Linked section of the outcome detail modal.
- "Show all" returns to the full list.

## 3. "Use as answer"

A decision in the same thread as an open question can close it:

- On the decision's row (question card and thread view): **Use as answer** (for a risk: **Use as
  mitigation**). One click marks the question answered (risk mitigated) with the note "Answered by the
  decision: <decision text> (<meeting>, <date>)", in the viewer's language, and records
  `answered_by: <decision id>`.
- Toast with **Undo** (reopens it, clears `answered_by`).
- When a question has several decisions in its thread, each row has its own button; nothing is chosen
  automatically.
- A question answered this way shows "Answered by: <decision>" with a link that opens the decision.

API: `POST /api/questions-risks/:id/resolve` accepts `{ decision_id }` instead of `note`; the server
checks that the decision is in the same thread and visible to the person, writes the note itself and
stores `answered_by`. Reopen clears it.

## 5. "Not related"

Grouping is automatic, so it can be wrong. Any item shown in a thread (card or thread view) has
**Not related** in a small menu:

- It leaves the thread: its `topic_id` and `topic` are cleared, and the thread id goes into
  `unlinked_topics` on the item so cross-meeting links never put it back (`applyLinks` skips items
  whose `unlinked_topics` contains that thread).
- Toast with **Undo** (puts it back).
- Who can do it: whoever can edit the item (outcomes: `canModifyDecision`; action items: owners, author
  or an admin, as PATCH allows).
- If the item was the one holding a sensitive mark for the thread, nothing changes for the item itself
  (it stays sensitive and private); the rest of the thread keeps its marks.

API: `POST /api/threads/unlink` `{ kind: 'decision'|'action_item', id }` → `{ topic_id }`, and
`POST /api/threads/relink` `{ kind, id, topic_id }` (undo; only a thread listed in its
`unlinked_topics`).

## Data

- `decisions.answered_by` (number|null): the decision that answered a question / mitigated a risk.
- `decisions.unlinked_topics`, `action_items.unlinked_topics` (string[]): threads a person took the
  item out of.
- No encrypted fields are queried; the note is written through `setResolution` as today.

## API summary

- `GET /api/questions-risks` (existing): each open item gains `status: { age_days, next_step:
  { text, owner, mine, due_date, overdue } | null, may_answer: number }`.
- `GET /api/threads/:topicId` (new): `{ topic_id, topic, summary: { open_questions, risks, next_steps,
  overdue, last_activity }, meetings: [{ title, date, items: [...] }] }`, only what the viewer can see
  (`loadThreads` access rules, sensitive threads included only for `private_to`). 404 when nothing is
  visible.
- `POST /api/questions-risks/:id/resolve` gains `decision_id`.
- `POST /api/threads/unlink`, `POST /api/threads/relink`.

## UI and copy

English and Spanish (glossary): "In this thread" / "En este tema", "Next step" / "Siguiente paso",
"No next step" / "Sin siguiente paso", "Add a next step" / "Agregar siguiente paso", "Use as answer" /
"Usar como respuesta", "Use as mitigation" / "Usar como mitigación", "Answered by" / "Respondida por",
"Not related" / "No está relacionado", "All settled" / "Todo resuelto". The status line uses the
existing tokens (overdue in `text-error`, "No next step" in `text-signal-ink`), at most one orange
element per card.

## Not now

- A decision's "What happened after" and "Revised on / replaced by" (decision lifecycle, A3).
- Renaming a thread, merging two threads, or moving an item to another thread.
- Threads on Home and Search beyond the existing links.

## Tests

- Unit: next-step choice (earliest due, no date last, overdue), age wording, thread summary counts.
- Integration: `/api/threads/:id` only shows what the viewer can see (a colleague's private item and a
  sensitive thread stay hidden); Use as answer (same thread only, note and `answered_by`, undo); Not
  related (cleared, recorded, cross-meeting links don't re-add it, undo, permission).
- Preview: Questions & risks with status lines, and the thread view (desktop and mobile).
