# How to report a UI/UX audit or review

## Before writing findings

1. Run `scripts/preview.js` for the pages in scope (desktop and mobile; add `--state empty` and `--state onboarding` when relevant) and look at every PNG.
2. Read the page's HTML (`src/views/…`) and script (`public/scripts/…`) for states the screenshots don't show: errors, loading, long text, many items.
3. Check `report.json`: console errors and horizontal overflow are findings on their own.
4. Skip what SKILL.md lists under "Known gaps" unless it got worse or you have a concrete fix proposal for it.

## Severity

| Level | Meaning | Examples |
|---|---|---|
| **P1** | Breaks a task, misleads, or breaks a principle | Can't use the page on a phone; AI outcome with no source; a colleague's data visible; action with no feedback; dead-end empty state |
| **P2** | Slows people down or erodes trust | Primary action not obvious; inconsistent wording for the same thing; low contrast; jargon |
| **P3** | Polish | Spacing, alignment, icon mismatch, one-off color |

Effort: **S** (one file, under an hour), **M** (a page or a shared partial), **L** (cross-page or new component).

## Each finding

```
### [P1] <short title>
- Page / viewport: Action items · mobile
- Where: the filter row (public/scripts/actions.js:72, src/views/actions.html:84)
- What's wrong: <what a person sees or can't do, one or two sentences>
- Rule: <principle or section of SKILL.md, e.g. "§3 Layout: must work at 390px">
- Fix: <concrete change: classes, copy, structure; not "improve spacing">
- Effort: S
- Screenshot: actions-mobile.png
```

## Report shape

1. One paragraph: the overall state of the page(s) and the top 3 things to fix.
2. Findings, P1 first, then P2, P3. At most ~15 per page: merge repeats ("all chips on this page…").
3. What works well and should be kept (short list), so a redesign doesn't lose it.

Write findings in English (they become issues and PRs); quote UI text exactly as it appears.
