# Concise outcomes: the point first, the meeting as reference

**Status:** approved and built (Oct 24, 2026). Linear COR-55. Builds on extraction v2
(`src/services/claude.js`), the eval (`scripts/eval-extraction.js`, `scripts/eval/score.js`) and the
review card, Questions & risks and Action items pages.

## Why

Too much of what Corteza saves reads like the meeting itself, not like its result. A typical
review card today has three blocks of text:

> **Se decide comenzar una investigación técnica sobre cómo implementar una experiencia interactiva
> con IA y Excel para los usuarios del curso, evaluando distintas alternativas de implementación.**
> Por qué: A raíz de la nueva estrategia presentada por Cristian al inicio de la reunión, en la que
> se planteó que el producto necesita diferenciarse con IA frente a la competencia…
> "yo creo que lo que tenemos que hacer es ver cómo metemos IA en el Excel, o sea que el alumno
> pueda preguntarle cosas al Excel mientras hace el curso…"

That's 80+ words to say one thing. People skim a log; when every item is a paragraph, nothing
stands out, and the copy-pasted parts (the quote, a rationale that repeats the text) add length,
not information.

The goal: every outcome reads in one glance, **clearer than before, in fewer words**, and the
meeting is one click away for whoever wants the detail.

> **Investigar cómo sumar IA a los Excel del curso**
> Por qué: diferenciarnos con IA frente a la competencia · Planificación comercial Q4, 14 oct

## What changes

### 1. What the AI writes (extraction prompt, `src/services/claude.js`)

| Field | Today | New rule |
|---|---|---|
| `text` | "one or two sentences" | **A headline: the outcome itself, at most 15 words** (about 100 characters). Paraphrased, never copied from the transcript. No "Se decide…", "Se acordó…", "The team agreed…": the type already says it's a decision. Action items: owner + verb + what (+ when): "Ana envía el deck de precios (viernes)". Questions as a question: "¿Certificamos ISO 27001 este año?". Risks as the threat: "La factura de octubre puede llegar tarde". |
| `rationale` | "one or two sentences" | **One short sentence (at most 20 words), only when it adds something the headline doesn't say.** Otherwise null. Never restates the headline. |
| `evidence_quote` | "under 200 characters" | **The single line where it was agreed, at most 120 characters**, trimmed with "…". Still verbatim. It's proof, not content: it's never shown by default (see 2). |

Two worked examples go into the prompt (one decision, one action item), each with a long "bad" and a
short "good" version, so the model sees the target length. Headlines and rationales stay in the
output language; quotes stay in the language spoken.

The server keeps its current hard caps as a safety net (it doesn't cut words; the eval tells us if
the model ignores the rule).

### 2. How it's shown (cards, pages, emails)

Everywhere an outcome appears as a card (Home review queue, Home → Meetings, Questions & risks,
Action items):

- **The headline**, then one line of chips: owner, due date, and the **meeting** ("Planificación
  comercial Q4 · 14 oct", a link to the meeting in Home → Meetings).
- **Por qué** in one muted line, when there is one.
- **The quote is no longer on the card.** It moves to the detail modal, under "En la reunión", next
  to the link to the meeting. The modal keeps everything.

Morning summary and capture emails show the headline only (they already link to the item).

### 3. Measure it (eval, before and after)

New numbers in `scripts/eval/score.js`, reported by every eval run next to precision and recall:

- **Words per headline**: average, and the share over 15 words (target: under 10%).
- **Copied from the meeting**: share of headlines that contain a run of 6 or more consecutive words
  from the transcript (target: under 10%). Quotes don't count; they're meant to be verbatim.
- **Rationale repeats the headline**: share of rationales whose words are mostly (70%+) the
  headline's (target: under 10%).
- **Characters per card** (headline + rationale), the number a reader feels.

Protocol, as in `docs/research/extraction-quality.md`: run the current prompt (baseline) and the new
one on the same set, the synthetic fixtures plus your real meetings in `~/corteza-eval`. Ship only if
**precision and recall don't drop** and the new numbers improve. About 2 to 4 USD per run.

### 4. What's already saved (optional, your call)

New captures follow the new rules. For the outcomes already saved there's an optional migration,
`016-shorten-outcomes.js`, the same shape as `006-translate-outcomes.js`:

- Claude rewrites each headline and rationale under the new rules (one call per 20 items, metered
  as `shorten_outcomes`; cents per hundred outcomes) and keeps the old ones in `original_text` and
  `original_rationale` (encrypted like the text), marked `shortened_at`, so nothing is lost and
  `--undo` puts them back.
- Dry run first: it prints 10 before → after pairs to your terminal only (never to logs), for you to
  judge before `--apply`.
- Only long AI-captured outcomes (headline over 15 words or why over 20) that nobody edited by hand:
  editing an outcome's or action item's text or why now records `text_edited_at`.

## Not now

- A separate "title" field next to `text`: the headline **is** `text`, so search, threads, emails
  and the extension keep working unchanged.
- Rewriting outcomes typed by hand (Log manually, decide-and-close, the extension).
- Changing what gets captured (precision rules): this is about how it's written, not what.

## Tests

- Unit: the new eval metrics (copied run detection, headline length, rationale overlap) on fixed
  examples; the prompt keeps the new rules and examples (snapshot of key lines).
- Integration: migration 016 dry run changes nothing; apply keeps `original_text`; edited outcomes
  are skipped; a second run does nothing.
- UI: cards render headline + chips + why with no quote; the detail modal shows the quote under
  "En la reunión". Preview screenshots (desktop and mobile, EN and ES) of Home, Meetings, Questions
  and Action items.

## Decisions (Oct 24)

1. 15 words for the headline, 20 for the why.
2. The quote leaves the cards: it's in the detail modal ("En la reunión") and, for action items, in
   the editor.
3. Saved outcomes are rewritten with migration 016 after Cristian reviews the dry run's samples.
