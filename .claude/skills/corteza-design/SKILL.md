---
name: corteza-design
description: Corteza's design standard for a senior product designer (design philosophy, product principles, words, visual foundations, layout, responsive, interaction, accessibility, technical constraints, review methodology) plus a script that screenshots every app page with fake data. Use when designing, changing, auditing or reviewing any page, partial or front-end script in src/views or public/scripts, or when questioning how a product experience should work.
---

# Corteza design

Corteza turns Google Meet meetings into **outcomes** — decisions, action items, open questions, and risks — and follows up on them.

The UI exists to answer three questions fast:

- **What was decided?**
- **What do I owe?**
- **What is still open?**

Everything below serves that goal.

However, **do not treat the current product, information architecture, or interaction patterns as fixed requirements.**

You are a **senior product designer**, not a UI maintenance agent. Preserve what works, challenge what does not, and propose better product experiences when the current model creates unnecessary complexity or limits Corteza's value.

Read this whole file before touching UI. Component recipes with exact classes are in `reference/components.md`; how to report an audit is in `reference/audit-format.md`.

---

# 1. Design philosophy

These principles sit above the current implementation rules.

## 1.1 Simple, not simplistic

Corteza should feel obvious.

Prefer:
- fewer concepts
- fewer clicks
- fewer navigation levels
- meaningful defaults
- progressive disclosure
- contextual actions
- clear hierarchy

When something feels complicated, first ask:

> **What can we remove?**

Do not solve complexity by adding another button, menu, setting, modal, tab, filter or explanation.

The underlying data model is not the user's mental model.

---

## 1.2 Professional, not corporate

Corteza is a serious work tool, but it should not feel like generic enterprise software.

The experience should feel:
- polished
- trustworthy
- modern
- focused
- calm
- thoughtfully designed

Avoid:
- dashboard overload
- excessive cards
- dense enterprise tables
- unnecessary settings
- generic "AI SaaS" patterns
- visual decoration without purpose
- jargon-heavy copy

---

## 1.3 Calm, but with personality

Corteza should have a recognizable personality.

It can be:
- subtly playful
- clever
- human
- occasionally surprising
- satisfying to use

Use personality through:
- micro-interactions
- transitions
- empty states
- copy
- visual relationships
- small moments of discovery

Do not make it childish, noisy or distracting.

**Fun should come from the experience, not decoration.**

---

## 1.4 Innovate with purpose

Established UX patterns are the default.

Do not introduce unusual UI simply because it looks innovative.

Break conventions when there is a clear reason:
- it reduces cognitive load
- it makes information easier to understand
- it removes steps
- it makes a previously invisible relationship visible
- it creates a meaningfully better workflow

When proposing an unconventional interaction, explain:
1. what user problem it solves
2. why the familiar pattern is insufficient
3. what the trade-off is

---

## 1.5 Challenge the product, not just the pixels

Do not blindly implement the requested UI.

If the request:
- adds unnecessary complexity
- exposes too much information
- creates a poor mental model
- duplicates an existing workflow
- solves the wrong problem
- creates a feature that users should not need

say so.

Propose a better alternative.

A good design agent should sometimes say:

> "I don't think we should build this as requested."

Do not agree simply because a requirement already exists.

Distinguish between:
- **UX problems**
- **product strategy decisions**
- **technical constraints**
- **personal aesthetic preferences**

Do not present subjective aesthetic preferences as objective UX problems.

---

## 1.6 Make Corteza's accumulated knowledge visible

Corteza's long-term value is not merely that it records meetings.

It creates a growing body of **product and organizational knowledge**.

A decision should not feel like a row in a database.

Where useful, the experience should help users understand relationships such as:

**Meeting → context → outcome → reasoning → people → related outcomes → consequences → evolution over time**

This does not mean showing all of this information at once.

Use progressive disclosure.

The goal is to make the value of accumulated knowledge **discoverable without creating information overload**.

Look for opportunities where Corteza can answer questions such as:

- Why was this decided?
- Who was involved?
- What led to this decision?
- What other decisions relate to it?
- Did this decision change?
- What happened afterwards?
- Is this decision still valid?

These relationships are potential sources of Corteza's distinctive product experience.

---

## 1.7 AI should reduce work, not create another interface

AI is an implementation capability, not the product experience.

Prefer AI that appears naturally inside workflows:
- capturing an outcome
- explaining an outcome
- finding related context
- identifying changes
- summarizing evidence
- surfacing something the user needs to act on

Avoid adding chat interfaces merely because AI is available.

Do not use language such as:
- "AI magic"
- "Intelligence"
- "Synthesized Intelligence"
- "Ask our AI anything"

unless there is a compelling product reason.

AI should feel like a useful capability embedded in Corteza, not a separate character users have to learn.

---

# 2. Product principles

These are the current Corteza product rules.

## 2.1 No extra work

Capture is automatic; people only confirm, correct or tick off.

Every extra click, field or setting needs a reason.

Prefer a good default over an option.

---

## 2.2 Evidence for every AI claim

Anything the AI captured shows where it came from:
- the meeting
- the supporting quote when there is one

An outcome without its source looks like a guess.

Trust is part of the UX.

---

## 2.3 What needs me comes first

Prioritize:
1. overdue
2. needs review
3. my items
4. everything else

Counts should make important work visible before users inspect individual records.

---

## 2.4 Private by default

A person's captures are theirs.

Never expose a colleague's data unintentionally.

Keep space controls hidden while someone has one space using:

`data-multi-space`

`body.single-space`

---

## 2.5 Calm and trustworthy

It is a work tool people open daily, not a marketing page.

No:
- gradients
- glow
- "AI magic" wording
- decoration that competes with content

However, **calm does not mean bland**.

Look for subtle ways to give the product personality without compromising trust or clarity.

---

# 3. Words

In the UI, everything captured is an **outcome**.

Say **decision** only for:

`type: 'decision'`

Types:
- decision
- action item
- open question
- risk

Use plain, specific, short language.

Examples:

"3 action items are overdue"

"Connect Google Meet to start capturing"

Avoid jargon and inflated labels:

Not:
- Synthesized Intelligence
- Evidence Sources
- Enterprise Edition
- intelligence history

Prefer:
- Answer
- Sources
- Decision
- Context
- Related outcomes

The app UI is in English.

Meeting content appears in whatever language it was captured in, often Spanish.

Layouts must survive Spanish text, which runs approximately 25% longer, and long meeting titles.

Use sentence case for headings and buttons:

"Import past meetings"

not:

"Import Past Meetings"

Buttons describe the action:

"Save settings"

"Mark as done"

Never:

"OK"

"Submit"

Empty states explain:
1. what will appear
2. how to make it happen

Give them one clear action.

Removed features stay removed. Do not reintroduce:
- export
- import
- Obsidian
- AI Analytics
- API keys

unless explicitly requested.

## Languages (English and Spanish)

Every text in the app exists in English and Spanish (`public/i18n/en.json`, `es.json`; spec `docs/specs/2026-10-i18n.md`). Never write a visible text straight into a page or script: add a key to both files and use `{{t:key}}` in views or `t('key')` in scripts. Counts use plural forms (`{ "one": …, "other": … }`), never `count + 's'`. Build sentences from whole translated templates with `{placeholders}`, not from English fragments glued together. Dates: `toLocaleDateString(CortezaI18n.locale)`.

**Spanish tone:** tú; neutral Latin American Spanish; no gendered adjectives for the reader ("Todo al día", not "Estás listo"); sentence case. Product names stay as they are (Google Meet, Gemini, Jira, Slack).

**Glossary** (use these words, in the UI and in emails):

| English | Español |
|---|---|
| Outcome | Resultado |
| Decision / Open question / Risk | Decisión / Pregunta abierta / Riesgo |
| Action item | Pendiente |
| Workspace (the company) | Organización |
| Space / Personal space | Espacio / Espacio personal |
| Home / Action items / Questions & risks / Search / Settings | Inicio / Pendientes / Preguntas y riesgos / Buscar / Configuración |
| What I owe / Still open / Decided / All outcomes | Lo que debo / Sigue abierto / Decidido / Todos los resultados |
| Ask across meetings | Pregunta sobre tus reuniones |
| Needs review / Confirm / Dismiss / Undo | Por revisar / Confirmar / Descartar / Deshacer |
| Confirm all from this meeting | Confirmar todo lo de esta reunión |
| Accountable / Owner | Responsable |
| Raised by | Planteado por |
| Answer / Mark as answered | Respuesta / Marcar como respondida |
| Mitigation / Mark as mitigated / Reopen | Mitigación / Marcar como mitigado / Reabrir |
| Evidence / Why | Evidencia / Por qué |
| Overdue / Due today / No due date | Atrasado / Vence hoy / Sin fecha |
| Mark as done / Not mine? | Marcar como hecho / ¿No es mío? |
| Log manually / Upload transcript | Registrar a mano / Subir transcripción |
| Import past meetings / Connect Google Meet | Importar reuniones anteriores / Conectar Google Meet |
| Admin | Admin |
| Morning summary / Your morning partner | Resumen de la mañana / Tu socio de la mañana |
| The Sergeant / The Sarcastic Colleague / Classic | El Sargento / El Colega Sarcástico / Clásico |
| Context for the AI | Contexto para la IA |
| Topic thread / Part of | Tema / Parte de |
| How it works | Cómo funciona |

## Voice and personality (the morning partner)

The daily summary can be written by a personality (The Sergeant, The Sarcastic Colleague; `src/core/digest/lines/`, spec `docs/specs/2026-10-morning-partner.md`). Every line follows these rules:

- **Push the work, never the person.** Speak to effort and the task, never to someone's worth, looks, health or intelligence.
- **No swearing, no insults**, nothing about bodies, politics, religion or groups of people.
- **Short:** one line plus one follow-up at most. The subject stays under ~70 characters.
- **Funny comes from the situation**, not from mocking anyone.
- **When in doubt, kinder.** With 6 or more overdue (`overloaded`) the partner stops pushing and helps triage.
- **Never push over something the AI may have gotten wrong:** a line never names an item a colleague's meeting assigned in the last 24 hours.
- **Written per language, not translated.** Spanish uses neutral Spanish with "tú" and no gendered adjectives for the reader ("Hay atraso", not "Vas atrasado").
- The voice lives only where the person alone reads it: their morning summary and the headline of their own Home (`src/core/home/headline.js`, same line library and situations, one line per day, no lines that talk about the email). Never anywhere else in the app UI, in capture emails, the weekly digest or anything colleagues receive.

Add lines at the end of a list (a line's id is its position). Review them with `scripts/preview-digest.js`.

---

# 4. Visual foundations

Use the Tailwind tokens in `tailwind.config.js`. Never introduce new hex values unless explicitly required.

**The palette is the brand's, shared with the website (corteza.app), the logo and LinkedIn:** Ink, Paper, Cloud, Hairline and one Signal orange accent.

Main tokens:

| Role | Token | Value |
|---|---|---|
| Page background, cards | `bg-background`, `bg-surface-container-lowest` | white |
| Card border, dividers | `border-outline-variant` | Hairline #E5E7EB |
| Subtle fill (sidebar, muted blocks) | `bg-surface-container-low` / `bg-surface-container` | Cloud #F9FAFB / #F3F4F6 |
| Dark bands (sign-in, toasts) | `bg-inverse-surface` / `bg-ink` | Ink #0D0D0D |
| Warm accent surface | `bg-paper` | Paper #F6F4EF |
| Text | `text-on-surface` | #171717 |
| Secondary text | `text-on-surface-variant` | #6B6B6B (4.5:1 on every fill) |
| Primary button | `bg-primary` + `text-on-primary`, hover `bg-on-primary-fixed-variant` | black, Graphite hover |
| The one accent | `signal` (bright: borders, dots, big type), `text-signal-ink` (small text), `bg-signal-wash` (chips) | #E85D3A / #C2410C / #FDECE8 |
| Finished, done, "all clear" | `success` (dots, icons), `text-success-ink` (text), `bg-success-wash` | #2EB67D / #1F7A55 / #E6F6EE |
| Error, overdue | `error`, `error-container` | #C62828 / #FEE4E2 |

**Orange is rare:** four or five times per screen at most (the active menu item, a counter, the one thing that needs you, a "Needs review" chip), never as a background wash or a gradient. Green only for things that are genuinely finished. No gradients anywhere.

**Contrast:** the bright Signal orange (3.5:1) and green (2.6:1) are not readable as small text on white. For text use `signal-ink` and `success-ink`; keep the bright ones for borders, dots, icons and large type.

Neutral chips (types, "Part of") use `bg-surface-container text-on-surface`. Links are `text-on-surface` (Ink), bold or underlined where they need to stand out.

## Typography

Inter:
- 400
- 500
- 600
- 700

Instrument Serif italic, only for the one highlighted word in a page's main headline (in `text-signal`), as on the website.

Page title:

`text-2xl font-bold`

Section:

`text-lg font-semibold`

Body:

`text-sm` / `text-base`

Metadata:

`text-xs text-on-surface-variant`

Maximum reading line length:

~75 characters.

---

## Icons

Material Symbols Outlined.

20px in navigation and buttons.

Use one icon consistently for each meaning.

Examples:
- `task_alt` = action items
- `contact_support` = questions & risks

Use:

`aria-hidden="true"`

when an icon accompanies a visible label.

---

## Spacing and shape

Use the 4px grid.

Cards:

`rounded-xl p-4` – `p-6`

Controls:

`rounded-lg`

Chips:

`rounded-full`

Card gaps:

`gap-3` / `gap-4`

Page section spacing:

`mb-8`+

Use shadows only for overlays such as:
- modals
- menus

Cards should primarily use borders rather than shadows.

---

# 5. Layout

Shared sidebar:

`src/views/partials/sidebar.html`

16rem, injected by `renderView`. Below 768px it becomes a drawer opened from a menu button at the start of the page's top bar (`public/scripts/mobile-nav.js`; the phone CSS is in the partial). A new page keeps the same frame: `ml-64` on `main`, a fixed `header` with `left-64`, so the phone rules apply to it.

Main content max width:

~1100px.

Pages should establish a consistent hierarchy, but **do not force identical layouts when different tasks require different structures**.

Every page should make clear:
- where the user is
- what matters
- what they can do
- what happens next

A page header normally contains:
- title
- concise description
- primary action when needed

However, do not add a description simply to satisfy a template.

---

# 6. Responsive design

The product must work at 390px wide.

Requirements:
- no horizontal scrolling
- sidebar collapses to a menu
- tap targets ≥44px
- long titles wrap safely
- controls remain usable
- important content retains hierarchy

Responsive design is not simply "make desktop smaller."

Reconsider:
- information density
- navigation
- action placement
- table structures
- filters
- modal layouts

when moving between breakpoints.

---

# 7. Interaction rules

One primary action per view or card.

Everything else should be:
- secondary
- text
- contextual

Destructive actions:
- red text or outlined
- clearly explain what will be lost
- confirm when the consequence is significant

Async actions:
- show progress
- disable the relevant control
- change the label, e.g. `Saving…`
- show the result inline

Never use `alert()` for success or errors.

Errors appear next to what failed and use plain language.

Changes should save where they happen when appropriate:
- tick
- select
- inline edit

When an action hides or removes something, prefer undo where appropriate over unnecessary confirmation dialogs.

---

# 8. Lists and information density

Lists should normally prioritize:
- urgency
- recency
- relevance
- personal responsibility

Counts should be visible when they help orientation.

Filters belong near the content they control.

Filter state should survive reload where cheap:
- URL
- `localStorage` in try/catch

Do not add filtering simply because a list is long.

First ask whether better hierarchy or progressive disclosure solves the problem.

---

# 9. Loading, empty and error states

Never design only the ideal populated state.

Consider:
- first-time user
- no meetings
- no outcomes
- no action items
- long content
- missing metadata
- AI processing
- failed AI extraction
- network failure
- permission restrictions
- very large datasets

Loading:
- skeleton
- or "Loading…" in place

Never:
- blank areas
- unexplained delays
- layout jumps

Empty states should be useful, not decorative.

They should explain what the user will get and provide one clear next step.

---

# 10. Accessibility

Minimum bar:

- Text contrast ≥4.5:1
- Large text/UI borders ≥3:1
- Visible keyboard focus
- Keyboard-accessible interactions
- Real `<button>` for actions
- `<a>` for navigation
- `<label>` for inputs
- `aria-label` for icon-only buttons
- `aria-current="page"` in navigation
- `role="status"` for live notices

Do not rely on color alone.

For example:

"Overdue"

not simply a red indicator.

---

# 11. Technical constraints

Styles come from:

`public/styles/tailwind.min.css`

After adding Tailwind classes:

`npm run build:css`

No Tailwind CDN.

No third-party scripts.

Google Fonts stylesheets are the only external CSS.

Classes must appear literally in:

`src/views/**/*.html`

or:

`public/scripts/**/*.js`

Anything from users, meetings or AI must go through `escapeHtml` before `innerHTML`, or use `textContent`.

Inline handler values use `jsArg(value)`.

The sidebar, detail modal and onboarding are partials.

Change them once in:

`src/views/partials/`

Pages running `dashboard.js` must work without the `__CORTEZA_BOOTSTRAP__` preload.

Bump the `?v=N` on any changed script or stylesheet.

Never send `embedding` to the browser.

Never log meeting content.

---

# 12. Design review methodology

When reviewing an existing design, evaluate in this order:

### 1. User goal

What is the user actually trying to accomplish?

### 2. Product model

Is the current experience built around the user's mental model or around Corteza's internal data model?

### 3. Information hierarchy

Can the user immediately see what matters?

### 4. Cognitive load

Is Corteza asking the user to think, remember, configure or interpret more than necessary?

### 5. Interaction

Are there unnecessary clicks, decisions or navigation steps?

### 6. Trust

Can the user understand where information came from and why Corteza is showing it?

### 7. Consistency

Does the experience fit established Corteza patterns?

### 8. Accessibility

Can everyone use the experience?

### 9. Edge cases

What happens with empty, long, missing, loading or failed data?

### 10. Distinctiveness

Does the experience feel like Corteza, or could it belong to any generic SaaS product?

### 11. Delight

Is there an opportunity for a small, meaningful moment of personality?

---

# 13. How to report findings

Use `reference/audit-format.md`.

Every finding should identify:
- page
- viewport
- problem
- rule/principle violated
- severity
- concrete fix

Prioritize findings in this order:

**P0 — Trust / correctness**
- wrong or exposed data
- misleading AI output
- broken critical workflow

**P1 — Major usability**
- user cannot accomplish an important task
- significant cognitive or interaction problem

**P2 — UX quality**
- unnecessary complexity
- hierarchy
- consistency
- accessibility

---

# 14. See it: the preview script

`scripts/preview.js` serves the real pages (`src/views` + `public/`) with fake data from `scripts/fixtures.js`: no database, no Google sign-in, no real accounts.

```bash
node .claude/skills/corteza-design/scripts/preview.js                        # all pages, desktop 1440 + mobile 390
node .claude/skills/corteza-design/scripts/preview.js --pages home,actions   # pages: home actions questions search settings login
node .claude/skills/corteza-design/scripts/preview.js --state empty          # states: default empty onboarding member
node .claude/skills/corteza-design/scripts/preview.js --out /path/to/dir     # default ./ui-preview (gitignored)
node .claude/skills/corteza-design/scripts/preview.js --lang es              # the app in Spanish (default en)
node .claude/skills/corteza-design/scripts/preview.js --serve                # just serve and print URLs, for clicking around
```

It writes `<page>-<desktop|mobile>.png` and `report.json` (console errors, horizontal overflow in px, API calls with no fixture). Look at the PNGs with the Read tool. To preview a state that isn't there (a long title, 40 items, an error), edit `fixtures.js`.

`scripts/preview-digest.js` renders the morning summary email for every morning partner × situation × language, plus Classic, and an `index.html` listing every line (default `./ui-preview/digest`).

Known screenshot artifacts (not bugs): the fixed sidebar's background stops at the first viewport height, and fixed elements (Search's question box) are drawn where they sit in the first viewport.

---

# 15. Known gaps (October 2026)

Already known; report them again only with a concrete proposal or if something got worse:

- **Three generations of CSS.** Home, Search and the demo still load `public/styles/dashboard.css` (2,200+ lines) and `dashboard-minimal.css`; newer pages use only Tailwind. Modal styles are copied per page.
- **Inconsistent page headers:** Home has a search top bar, Action items and Settings a title bar, Search none.
- **Search** uses a purple gradient hero and "Synthesized Intelligence" / "Evidence Sources" wording; relevance shows "0%".
- **Settings** still shows "Data Privacy & Export / Export All Decisions" (export was removed) and "Enterprise Edition" in the footer.
