# How to report a UI/UX audit or review

## Before writing findings

1. Run `scripts/preview.js` for the pages in scope (desktop and mobile; add `--state empty` and `--state onboarding` when relevant) and look at every PNG.
2. Read the page's HTML (`src/views/…`) and script (`public/scripts/…`) for states the screenshots don't show: errors, loading, long text, many items, missing metadata.
3. Check `report.json`: console errors and horizontal overflow are findings on their own.
4. Walk the page through SKILL.md §12 (user goal → product model → hierarchy → cognitive load → interaction → trust → consistency → accessibility → edge cases → distinctiveness → delight).
5. Skip what SKILL.md §15 lists as known gaps unless it got worse or you have a concrete proposal for it.

## Severity (SKILL.md §13)

| Level | Meaning | Examples |
|---|---|---|
| **P0** | Trust / correctness | A colleague's data visible; AI outcome shown as fact with no source; misleading count; a critical workflow broken (can't mark done, can't connect Meet) |
| **P1** | Major usability | Page unusable on a phone; can't find how to do an important task; the page is built around the data model, not the user's question; heavy cognitive load |
| **P2** | UX quality | Unnecessary complexity, weak hierarchy, inconsistency, accessibility, jargon, polish |

Effort: **S** (one file, under an hour), **M** (a page or a shared partial), **L** (cross-page, new component or product change).

Label each finding's nature (SKILL.md §1.5): **UX problem**, **product strategy**, **technical constraint** or **aesthetic preference**. Aesthetic preferences are never above P2.

## Each finding

```
### [P1] <short title>
- Page / viewport: Action items · mobile
- Nature: UX problem
- Where: the filter row (src/views/actions.html:84, public/scripts/actions.js:72)
- What's wrong: <what a person sees, can't do or has to think about, one or two sentences>
- Principle: <section of SKILL.md, e.g. "§6 Responsive: no horizontal scrolling">
- Fix: <concrete change: structure, copy, classes; not "improve spacing">
- Effort: S
- Screenshot: actions-mobile.png
```

## Report shape

1. **Summary:** one paragraph on the page's job, how well it does it today, and the top 3 changes.
2. **Findings:** P0 first, then P1, P2. At most ~15 per page; merge repeats ("all chips on this page…").
3. **Product proposals:** ideas that change the experience rather than fix it (SKILL.md §1.5–1.7): what to remove or merge, a better model for the page, a way to make accumulated knowledge visible. For each: the user problem, why the current pattern falls short, the trade-off, and a rough sketch in words.
4. **Keep:** what works and a redesign must not lose (short list).

Write in English (findings become issues and PRs); quote UI text exactly as it appears.
