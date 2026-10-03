# Component recipes

The classes the newer pages (Action items, Questions & risks) already use. Copy these instead of inventing variants; when a recipe is missing, add it here in the same PR.

## Card

```html
<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-col gap-2">
  <p class="text-on-surface font-medium">Outcome text</p>
  <p class="text-sm text-on-surface-variant">Why: rationale</p>
  <p class="text-xs italic text-on-surface-variant">“Supporting quote”</p>
  <p class="text-xs text-on-surface-variant">Google Meet: <a class="text-primary hover:underline" href="…">Meeting title</a></p>
</div>
```
Order inside an outcome card: chips (type, status) → text → why → quote → source → actions. Focused item from a link: add `ring-2 ring-primary`.

## Buttons

| Kind | Classes |
|---|---|
| Primary (one per view/card) | `bg-primary text-on-primary rounded-lg py-2 px-4 text-sm font-semibold hover:bg-on-primary-fixed-variant disabled:opacity-50` |
| Secondary | `border border-outline-variant rounded-lg py-2 px-4 text-sm font-semibold text-on-surface hover:bg-surface-container-low` |
| Text / link | `text-sm font-semibold text-primary hover:underline` |
| Destructive | `text-sm font-semibold text-error hover:underline` (or outlined with `border-error`) |

Compact versions in cards use `py-1.5 px-3`. Busy state: `disabled` + label "Saving…".

## Segmented filter

```html
<div class="inline-flex rounded-lg border border-outline-variant overflow-hidden" role="group" aria-label="Owner">
  <button type="button" class="px-4 py-2 text-sm font-semibold" aria-pressed="true">Mine</button>
  <button type="button" class="px-4 py-2 text-sm font-semibold" aria-pressed="false">Everyone</button>
</div>
```
Selected: `bg-primary text-on-primary`; unselected: `bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low`. Counts go inside the button ("Questions 3").

## Inputs and selects

`bg-surface-container-low border border-outline-variant rounded-lg py-2 px-3 text-sm` (compact in cards: `py-1 px-2 text-xs`). Always a `<label>` (visible, or `sr-only` + `aria-label` in tight rows).

## Chips

Base: `px-2 py-0.5 rounded-full text-xs font-semibold`.

| Meaning | Colors |
|---|---|
| Person matched to a member / primary info | `bg-primary/10 text-primary` |
| Neutral (unmatched name, space) | `bg-surface-container text-on-surface-variant` |
| Problem (No owner, overdue) | `bg-error/10 text-error` |
| Warning (No due date, needs review) | `bg-[#fff4e5] text-[#8a5300]` (to become a token) |
| Done / confirmed | `bg-[#e6f4ea] text-[#1e6b34]` (to become a token) |
| New | `bg-primary text-on-primary` |
| Thread link ("Part of …") | `inline-flex items-center gap-1 bg-primary-fixed text-primary hover:underline` + `contact_support` icon |

## Notice / banner

```html
<div class="rounded-xl border border-primary/30 bg-primary-fixed/40 p-4 text-sm text-on-surface" role="status">…</div>
```
Errors: `border-error/30 bg-error-container text-on-error-container`. One line of what happened + one action.

## Empty state

```html
<div class="text-center py-12 flex flex-col items-center gap-3">
  <span class="material-symbols-outlined text-4xl text-outline" aria-hidden="true">task_alt</span>
  <p class="text-on-surface font-medium">No action items yet</p>
  <p class="text-sm text-on-surface-variant max-w-md">They're captured automatically from your Google Meet meetings.</p>
  <a class="…primary button…" href="/settings">Connect Google Meet</a>
</div>
```

## Page header

```html
<header class="…"><h1 class="text-2xl font-bold text-on-surface">Action items</h1></header>
<p class="text-on-surface-variant mb-6">Commitments captured from your meetings: who owns them, and by when.</p>
```
One `<h1>` per page.

## Modal

Overlay `fixed inset-0 bg-black/50 z-50 flex items-center justify-center`; panel `bg-surface-container-lowest rounded-2xl shadow-xl w-[90%] max-w-[600px] max-h-[90vh] overflow-y-auto`. `role="dialog" aria-modal="true" aria-labelledby`, closes on `Esc` and backdrop, focus trapped while open. Prefer the shared detail modal partial over a new modal.
