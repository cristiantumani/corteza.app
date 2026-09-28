# CLAUDE.md

Guide for AI agents (and humans) working on Corteza. Read this first, then `docs/ARCHITECTURE.md`.

## What Corteza is

A team decision log focused on **Google Workspace**:

1. **Automatic capture:** reads Google Meet transcripts and Gemini meeting notes and saves the decisions in them with no human in the loop (Settings → Google Meet).
2. **Manual capture:** the Chrome extension (`browser-extension/`) and the dashboard's Log Decision form.
3. **Slack as an input source only:** `/decision` and transcript uploads. Slack must not be used for sign-up, login or identity.

**Sign-in is Google only.** A company's Google Workspace domain is its Corteza workspace.

Also kept: Jira linking, AI (semantic) search, the demo, and the weekly digest email.
Removed: the Obsidian plugin, import and export, and the AI Analytics page (Sept 2026). Don't re-add them; analytics will come back as roadmap C4.

## Commands

```bash
npm install
npm start                 # node src/index.js (needs .env, see .env.example)
npm test                  # unit tests; integration tests run when TEST_MONGODB_URI is set
npm run lint              # ESLint (warnings allowed, errors fail CI)
npm run build:css         # rebuild public/styles/tailwind.min.css after changing Tailwind classes
TEST_MONGODB_URI=mongodb://localhost:27017 npm test   # run everything against a local MongoDB
node scripts/eval-extraction.js   # extraction quality eval (calls Claude, costs money); run before/after prompt or model changes
```

CI (`.github/workflows/ci.yml`) runs lint and all tests against a MongoDB service on every PR.

## Where things live

| Area | Location |
|---|---|
| App entry, route wiring, Slack Bolt setup | `src/index.js` |
| Env config / MongoDB connection and indexes | `src/config/environment.js`, `src/config/database.js` |
| HTTP routes (handlers) | `src/routes/*.js` |
| Business logic services | `src/services/*.js` |
| Space helpers (personal space per member, default space for Slack/API) | `src/services/spaces.js` (`ensurePersonalSpace`, `ensureDefaultSpace`) |
| Spaces a user sees, with counts and roles (API and page preload) | `src/core/spaces/list-spaces.js` (`listSpacesForUser`) |
| Space/admin permission rules | `src/services/permissions.js` |
| Google sign-in routes (login page, OAuth callback, onboarding) | `src/auth/routes.js` |
| Which workspace a Google user lands in | `src/auth/google-signin.js` (`signInWithGoogle`) |
| Private beta: approved list, sign-in check, approve link from the early access email, welcome email | `src/core/beta/` (`beta-access.js`, `approve.js`), `src/http/beta.js`, `scripts/beta-approve.js` |
| Google OAuth client (URLs, token verification) | `src/integrations/google/oauth.js` |
| Workspaces (Google domain ↔ workspace) | `src/core/workspaces/workspace-service.js` |
| Users and memberships | `src/core/users/user-service.js` |
| Invites (validate, join) | `src/core/invites/invite-service.js` |
| Create a decision (single write path for new code) | `src/core/decisions/decision-service.js` (`createDecision`) |
| Transcript → decisions pipeline (dedupe, extract, auto-save) | `src/ingestion/pipeline.js` (`ingestTranscript`) |
| Google Meet: connect/settings routes, token storage, API client | `src/integrations/google/{routes,connections,meet-client}.js` |
| Google Meet: meeting → transcript text | `src/ingestion/sources/google-meet.js` |
| Google Meet poller (every 5 min) | `src/jobs/meet-poller.js` |
| Import past Google Meet meetings (list by period, background import jobs) | `src/ingestion/meet-import.js` |
| AI extraction prompt (Claude) | `src/services/claude.js` |
| Language outcomes are written in (detected from the spoken transcript, or fixed in Settings → Google Meet) | `src/core/language/detect.js`, `outputLanguage` in `src/services/claude.js`; translate saved ones: `scripts/migrations/006-translate-outcomes.js` |
| Decision types (decision, action_item, open_question, risk, …), outcome counts and labels | `src/core/decisions/types.js` (`countByType`, `describeOutcomes`), `public/scripts/outcome-labels.js` |
| Action items ("pendientes"): owners, due dates, status, link to decision | `src/core/actions/` (`action-service.js`, `owners.js`, `due-date-requests.js`) |
| Action items page and API (`/actions`, `/api/action-items`, `/api/people`) | `src/http/action-items.js`, `src/views/actions.html`, `public/scripts/actions.js`; inside a decision's detail: `public/scripts/decision-actions.js` |
| Extraction eval (labeled transcripts, scoring) | `scripts/eval-extraction.js`, `scripts/eval/score.js`, `test/fixtures/extraction/` |
| Product roadmap (what to build next, go-to-market) | `docs/ROADMAP.md` |
| Google verification / launch checklist | `docs/launch/google-verification.md` |
| Embeddings / semantic search (answer + sources used, keyword fallback, source feedback) | `src/services/embeddings.js`, `src/services/semantic-search.js`, `src/core/search/relevance.js`, `src/http/search-feedback.js`, `public/scripts/ai-search.js` |
| App sidebar (one for every page: Home, Action items, Search, Settings) | `src/views/partials/sidebar.html`, injected at `<!-- SIDEBAR -->` by `renderView` in `src/http/page-partials.js`. Change it there, never per page |
| Outcome detail modal (shared by Home and Search) | `src/views/partials/detail-modal.html`, injected at `<!-- DETAIL_MODAL -->` by `renderView` in `src/http/page-partials.js` |
| File/transcript parsing (txt, md, vtt, srt, pdf, docx) | `src/utils/text-extractors.js` |
| Web transcript extraction + suggestion review | `src/routes/ai-extract-web.js` |
| Slack commands and Slack transcript flow | `src/routes/slack.js`, `src/routes/ai-decisions.js` |
| API-key integrations (`/api/v1/*`) | `src/routes/extract-api.js`, `src/middleware/api-key-auth.js` |
| Email (Resend) | `src/utils/n8n-client.js` (historical name; it's Resend, not n8n) |
| Background jobs | `src/jobs/` (weekly digest, re-engagement) |
| Dashboard UI | `src/views/dashboard-new.html` + `public/scripts/dashboard.js` + `public/scripts/dashboard-new.js` (click-to-edit in the detail modal: `public/scripts/inline-edit.js`) |
| Settings UI | `src/views/settings-new.html` + `public/scripts/settings-new.js` (+ `settings-integrations.js` for Google Meet) |
| Chrome extension | `browser-extension/` |
| DB migrations (manual, idempotent) | `scripts/migrations/` |
| Tests | `test/unit/`, `test/integration/`, helper `test/helpers/db.js` |
| Old docs (historical, may be wrong) | `docs/archive/` |

## Conventions and rules

- **New action items go through `createActionItem`** (`src/core/actions/action-service.js`), never into `decisions`.
- **Naming:** in the UI, everything captured from a meeting is an **outcome**; a *decision* is one type of outcome, next to action items, open questions and risks. Say "decisions" only for `type: 'decision'`. Code, collections and APIs keep the `decisions` name.
- **New decisions go through `createDecision`** (`src/core/decisions/decision-service.js`); new transcript sources are adapters in `src/ingestion/sources/` that call `ingestTranscript`.
- **Every decision has a `space_id`.** The dashboard filters by space. When there's no space picker, a person's captures go to their **personal space** (`ensurePersonalSpace(workspaceId, userId)` in `src/services/spaces.js`; private, created at sign-in). Only captures with no Corteza user behind them (Slack, API keys) use `ensureDefaultSpace(workspaceId)`.
- **Spaces stay out of sight while someone has one.** Space controls carry `data-multi-space` and are hidden when the page sets `body.single-space` (1 space). Never show a colleague's personal space, not even to admins.
- **Workspace isolation:** never trust a `workspace_id` from the request body or query. Use the session's (`req.session.user.workspace_id`), `requireWorkspaceAccess`, or the API key's (`req.user.workspace_id`).
- **Joining a workspace:** only through Google sign-in (same `hd` domain, or an invite link). Never trust the email's domain, only Google's `hd` claim. See `signInWithGoogle` in `src/auth/google-signin.js`.
- **User IDs:** memberships keep their own `user_id` (legacy Slack/email IDs). The session uses the membership's `user_id`, and decisions reference it.
- **New code goes in the target layout** (`src/core`, `src/integrations`, `src/auth`; see `docs/ARCHITECTURE.md`). Older code in `src/routes` and `src/services` moves there over time.
- **Secrets:** per-workspace credentials are encrypted with `src/utils/encryption.js`. Never commit keys; `*.pem` and `*.crx` are gitignored.
- **Performance:**
  - Never send `embedding` to the browser; project it out.
  - Keep static assets ahead of the session middleware.
  - Avoid a query per item: use one aggregate or one `$in` query, as `core/spaces/list-spaces.js` does.
  - Pages that run `dashboard.js` get the user and spaces preloaded (`routes/dashboard.js` → `window.__CORTEZA_BOOTSTRAP__`). Keep them working without the preload.
- **Style:** CommonJS, async/await, JSDoc comments on exported functions, and the existing emoji-prefixed `console.log` style for server logs. Match the surrounding code.
- **Tests:** new services get unit tests. Anything that touches MongoDB goes in `test/integration/` using `setupTestDatabase()`, which gives each file its own throwaway database.
- **Docs:** when you change architecture, data shape or env vars, update `docs/ARCHITECTURE.md`, `.env.example` and this file in the same PR.

## Roadmap (Google Workspace refocus)

The full plan and target module layout are in `docs/ARCHITECTURE.md`. Phases:

0. **Stabilize:** default spaces, security fixes, cleanup, tests and CI. *(done)*
1. **Restructure:** single decision write path (`core/decisions`), `app.js`/`server.js` split, Slack optional. (`workspaces`/`users` collections were added in Phase 2.)
2. **Google sign-in:** Google OIDC with domain workspaces. Magic link, passwords and Slack login are removed. *(done)*
3. **Google Meet auto-capture:** "Connect Google", Meet transcript and Gemini notes poller, auto-save pipeline. *(done; see `docs/integrations/google-meet.md`)*
4. **Slack input-only:** "Connect Slack" from Settings, events mapped to workspaces.
5. **Docs and cleanup.**

**Next (approved Sept 2026): `docs/ROADMAP.md`.** It covers ready-to-sell work (Google verification, extraction v2, decision lifecycle, onboarding, billing) and follow-through (action items, owners, nudges, cross-meeting progress detection, pre-meeting briefs). Read it before starting new product work.
