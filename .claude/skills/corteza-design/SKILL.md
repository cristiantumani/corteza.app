---
name: corteza-design
description: Corteza's UI and UX rules (product principles, colors and type, components, copy, accessibility, technical constraints) plus a script that screenshots every app page with fake data. Use when designing, changing, auditing or reviewing any page, partial or front-end script in src/views or public/scripts.
---

# Corteza design

Corteza turns Google Meet meetings into **outcomes** (decisions, action items, open questions, risks) and follows up on them. The UI exists to answer three questions fast: *what was decided, what do I owe, what is still open*. Everything below serves that.

Read this whole file before touching UI. Component recipes with exact classes are in `reference/components.md`; how to report an audit is in `reference/audit-format.md`.

## 1. Product principles (the "why" behind every review comment)

1. **No extra work.** Capture is automatic; people only confirm, correct or tick off. Every extra click, field or setting needs a reason. Prefer a good default over an option.
2. **Evidence for every AI claim.** Anything the AI captured shows where it came from: the meeting (linked), and the supporting quote when there is one. An outcome without its source looks like a guess.
3. **What needs me comes first.** Overdue and "needs review" before everything else; counts before lists; my items before everyone's.
4. **Private by default.** A person's captures are theirs. Never show a colleague's data, and keep space controls hidden while someone has one space (`data-multi-space`, `body.single-space`).
5. **Calm and trustworthy.** It's a work tool people open daily, not a marketing page: no gradients, glow, "AI magic" wording or decoration that competes with content.

## 2. Words

- In the UI, everything captured is an **outcome**. Say **decision** only for `type: 'decision'`. Types: decision, action item, open question, risk.
- Plain, specific, short. Say what happened and what to do: "3 action items are overdue", "Connect Google Meet to start capturing".
- No jargon or inflated labels: not "Synthesized Intelligence", "Evidence Sources", "Enterprise Edition", "intelligence history". Use "Answer", "Sources", nothing.
- The app UI is in **English**; meeting content shows in whatever language it was captured in (often Spanish). Layouts must survive Spanish text, which runs ~25% longer, and long meeting titles.
- Sentence case for headings and buttons ("Import past meetings", not "Import Past Meetings").
- Buttons say the action ("Save settings", "Mark as done"), never "OK" or "Submit".
- Empty states explain what will appear and how to make it happen, with one action.
- Removed features stay removed: no export, import, Obsidian, AI Analytics or API keys in the UI (CLAUDE.md).

## 3. Visual foundations

**Color: use the Tailwind tokens in `tailwind.config.js`**, never new hex values. Main ones:

| Role | Token |
|---|---|
| Page background | `bg-background` (#fcf8fb) |
| Card | `bg-surface-container-lowest` (white) + `border-outline-variant` |
| Subtle fill (inputs, hover, sidebar) | `bg-surface-container-low` / `bg-surface-container` |
| Text / secondary text | `text-on-surface` / `text-on-surface-variant` |
| Primary action, links, selection | `primary` (#3953bd), `on-primary`; tints `bg-primary/10`, `primary-fixed` |
| Error, overdue, destructive | `error`, `error-container`, tint `bg-error/10` |
| Success | `tertiary` (#006947) |

Warning (amber) and success-tint chips currently use hardcoded hex (`#fff4e5`/`#8a5300`, `#e6f4ea`/`#1e6b34`); when touching them, add proper tokens instead of copying the hex. `secondary` (purple) is for rare accents only.

**Type:** Inter (400, 500, 600, 700). Page title `text-2xl font-bold`; section `text-lg font-semibold`; body `text-sm`/`text-base`; metadata `text-xs text-on-surface-variant`. Max line length ~75 characters for reading text.

**Icons:** Material Symbols Outlined, 20px in navigation and buttons, `aria-hidden="true"` when next to a label. One icon per meaning across the app (e.g. `task_alt` = action items, `contact_support` = questions & risks).

**Spacing and shape:** 4px grid (Tailwind scale). Cards `rounded-xl p-4`–`p-6`, controls `rounded-lg`, chips `rounded-full`. Gaps between cards `gap-3`/`gap-4`; between page sections `mb-8`+. Shadows only on overlays (modals, menus); cards use a border.

**Layout:** shared sidebar (`src/views/partials/sidebar.html`, 16rem, injected by `renderView`) + main column, content max width ~1100px. Every page has the same header pattern (title + one-line description). **Must work at 390px wide:** no horizontal scroll, sidebar collapses to a menu, tap targets ≥ 44px. (Today it doesn't: see Known gaps.)

## 4. Interaction rules

- One primary button per view or card; the rest secondary or text buttons. Destructive actions are red text or outlined, and confirm with what will be lost.
- Every async action shows progress (button disabled + label "Saving…") and its result inline. No `alert()` for success or errors; errors go next to what failed, in plain words.
- Changes save where they happen (tick, select, inline edit) with an undo when it hides something (dismiss, done).
- Lists: newest or most urgent first, counts visible, filters as segmented buttons or selects above the list; filter state survives reload where cheap (URL or `localStorage` in try/catch).
- Loading: skeleton or "Loading…" in place; never a blank area or layout jump.
- Modals only for focused tasks (detail, log manually); `Esc` and backdrop click close them; focus moves in and returns.

## 5. Accessibility (minimum bar)

- Text contrast ≥ 4.5:1 (≥ 3:1 for large text and UI borders). `text-on-surface-variant` on white passes; light tints on tints often don't, so check.
- Everything works by keyboard with a visible focus ring (`focus-visible:ring-2 ring-primary`).
- Real elements: `<button>` for actions, `<a>` for navigation, `<label>` on every input, `aria-label` on icon-only buttons, `aria-current="page"` in navigation, `role="status"` for live notices.
- Don't rely on color alone: overdue says "Overdue", not just red.

## 6. Technical constraints (CI and security enforce these)

- Styles come from the built `public/styles/tailwind.min.css`. After adding Tailwind classes run `npm run build:css` and commit the CSS. **No Tailwind CDN** and no third-party scripts (the CSP blocks them); Google Fonts stylesheets are the only external CSS.
- Classes must appear literally in `src/views/**/*.html` or `public/scripts/**/*.js` or the build drops them (no `'bg-' + color`).
- Anything from users, meetings or the AI goes through `escapeHtml` before `innerHTML`, or use `textContent`. Inline handler values use `jsArg(value)`.
- The sidebar, detail modal and onboarding are partials: change them once in `src/views/partials/`, never per page.
- Pages that run `dashboard.js` must work without the `__CORTEZA_BOOTSTRAP__` preload.
- Bump the `?v=N` on a script or stylesheet `<link>`/`<script>` you change so browsers don't use a stale copy.
- Never send `embedding` to the browser; never log meeting content.

## 7. See it: the preview script

`scripts/preview.js` serves the real pages (`src/views` + `public/`) with fake data from `scripts/fixtures.js`: no database, no Google sign-in, no real accounts.

```bash
node .claude/skills/corteza-design/scripts/preview.js                        # all pages, desktop 1440 + mobile 390
node .claude/skills/corteza-design/scripts/preview.js --pages home,actions   # pages: home actions questions search settings login
node .claude/skills/corteza-design/scripts/preview.js --state empty          # states: default empty onboarding member
node .claude/skills/corteza-design/scripts/preview.js --out /path/to/dir     # default ./ui-preview (gitignored)
node .claude/skills/corteza-design/scripts/preview.js --serve                # just serve and print URLs, for clicking around
```

It writes `<page>-<desktop|mobile>.png` and `report.json` (console errors, horizontal overflow in px, API calls with no fixture). Look at the PNGs with the Read tool. To preview a state that isn't there (a long title, 40 items, an error), edit `fixtures.js`.

Known screenshot artifacts (not bugs): the fixed sidebar's background stops at the first viewport height, and fixed elements (Search's question box) are drawn where they sit in the first viewport.

## 8. Known gaps (October 2026)

Fix these when touching the area; auditors don't need to report them again unless something changed:

- **No mobile layout.** The sidebar is always 16rem and fixed; at 390px it covers most of the screen. Home, Search and Settings overflow horizontally.
- **Three generations of CSS.** Home, Search and the demo still load `public/styles/dashboard.css` (2,200+ lines) and `dashboard-minimal.css`; newer pages use only Tailwind. Modal styles are copied per page.
- **Inconsistent page headers:** Home has a search top bar, Action items and Settings a title bar, Search none.
- **Search** uses a purple gradient hero and "Synthesized Intelligence"/"Evidence Sources" wording (against principle 5 and the Words rules); relevance shows "0%".
- **Settings** still shows "Data Privacy & Export / Export All Decisions" (export was removed) and "Enterprise Edition" in the footer.
- Hardcoded hex colors in scripts (`#eef1fb`, `#e3e7fb`, `#fff4e5`, `#e6f4ea`…).

## 9. When reviewing or auditing

Use `reference/audit-format.md`. Judge against sections 1–6 in that order: a principle violation (no source on an AI claim, a colleague's data visible, a dead-end empty state) outranks a spacing nit. Every finding names the page, the viewport, what's wrong, which rule it breaks and a concrete fix.
