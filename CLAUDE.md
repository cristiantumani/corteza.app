# CLAUDE.md

Guide for AI agents (and humans) working on Corteza. Read this first, then `docs/ARCHITECTURE.md`.

## What Corteza is

A team decision log focused on **Google Workspace**:

1. **Automatic capture:** reads Google Meet transcripts and Gemini meeting notes and saves the decisions in them with no human in the loop. Being built; see the roadmap below.
2. **Manual capture:** the Chrome extension (`browser-extension/`) and the dashboard's Log Decision form.
3. **Slack as an input source only:** `/decision` and transcript uploads. Slack must not be used for sign-up, login or identity.

**Sign-in is Google only.** A company's Google Workspace domain is its Corteza workspace.

Also kept: Jira linking, AI (semantic) search, AI analytics, the demo, and the weekly digest email.
Removed: the Obsidian plugin, import and export. Don't re-add them.

## Commands

```bash
npm install
npm start                 # node src/index.js (needs .env, see .env.example)
npm test                  # unit tests; integration tests run when TEST_MONGODB_URI is set
npm run lint              # ESLint (warnings allowed, errors fail CI)
npm run build:css         # rebuild public/styles/tailwind.min.css after changing Tailwind classes
TEST_MONGODB_URI=mongodb://localhost:27017 npm test   # run everything against a local MongoDB
```

CI (`.github/workflows/ci.yml`) runs lint and all tests against a MongoDB service on every PR.

## Where things live

| Area | Location |
|---|---|
| App entry, route wiring, Slack Bolt setup | `src/index.js` |
| Env config / MongoDB connection and indexes | `src/config/environment.js`, `src/config/database.js` |
| HTTP routes (handlers) | `src/routes/*.js` |
| Business logic services | `src/services/*.js` |
| Space helpers (default space) | `src/services/spaces.js` (`ensureDefaultSpace`) |
| Space/admin permission rules | `src/services/permissions.js` |
| Google sign-in routes (login page, OAuth callback, onboarding) | `src/auth/routes.js` |
| Which workspace a Google user lands in | `src/auth/google-signin.js` (`signInWithGoogle`) |
| Google OAuth client (URLs, token verification) | `src/integrations/google/oauth.js` |
| Workspaces (Google domain ↔ workspace) | `src/core/workspaces/workspace-service.js` |
| Users and memberships | `src/core/users/user-service.js` |
| Invites (validate, join) | `src/core/invites/invite-service.js` |
| AI extraction prompt (Claude) | `src/services/claude.js` |
| Embeddings / semantic search | `src/services/embeddings.js`, `src/services/semantic-search.js` |
| File/transcript parsing (txt, md, vtt, srt, pdf, docx) | `src/utils/text-extractors.js` |
| Web transcript extraction + suggestion review | `src/routes/ai-extract-web.js` |
| Slack commands and Slack transcript flow | `src/routes/slack.js`, `src/routes/ai-decisions.js` |
| API-key integrations (`/api/v1/*`) | `src/routes/extract-api.js`, `src/middleware/api-key-auth.js` |
| Email (Resend) | `src/utils/n8n-client.js` (historical name; it's Resend, not n8n) |
| Background jobs | `src/jobs/` (weekly digest, re-engagement) |
| Dashboard UI | `src/views/dashboard-new.html` + `public/scripts/dashboard.js` + `public/scripts/dashboard-new.js` |
| Settings UI | `src/views/settings-new.html` + `public/scripts/settings-new.js` |
| Chrome extension | `browser-extension/` |
| DB migrations (manual, idempotent) | `scripts/migrations/` |
| Tests | `test/unit/`, `test/integration/`, helper `test/helpers/db.js` |
| Old docs (historical, may be wrong) | `docs/archive/` |

## Conventions and rules

- **Every decision has a `space_id`.** The dashboard filters by space. When there's no space picker (Slack, API, AI), use `ensureDefaultSpace(workspaceId)` from `src/services/spaces.js`.
- **Workspace isolation:** never trust a `workspace_id` from the request body or query. Use the session's (`req.session.user.workspace_id`), `requireWorkspaceAccess`, or the API key's (`req.user.workspace_id`).
- **Joining a workspace:** only through Google sign-in (same `hd` domain, or an invite link). Never trust the email's domain, only Google's `hd` claim. See `signInWithGoogle` in `src/auth/google-signin.js`.
- **User IDs:** memberships keep their own `user_id` (legacy Slack/email IDs). The session uses the membership's `user_id`, and decisions reference it.
- **New code goes in the target layout** (`src/core`, `src/integrations`, `src/auth`; see `docs/ARCHITECTURE.md`). Older code in `src/routes` and `src/services` moves there over time.
- **Secrets:** per-workspace credentials are encrypted with `src/utils/encryption.js`. Never commit keys; `*.pem` and `*.crx` are gitignored.
- **Style:** CommonJS, async/await, JSDoc comments on exported functions, and the existing emoji-prefixed `console.log` style for server logs. Match the surrounding code.
- **Tests:** new services get unit tests. Anything that touches MongoDB goes in `test/integration/` using `setupTestDatabase()`, which gives each file its own throwaway database.
- **Docs:** when you change architecture, data shape or env vars, update `docs/ARCHITECTURE.md`, `.env.example` and this file in the same PR.

## Roadmap (Google Workspace refocus)

The full plan and target module layout are in `docs/ARCHITECTURE.md`. Phases:

0. **Stabilize:** default spaces, security fixes, cleanup, tests and CI. *(done)*
1. **Restructure:** single decision write path (`core/decisions`), `app.js`/`server.js` split, Slack optional. (`workspaces`/`users` collections were added in Phase 2.)
2. **Google sign-in:** Google OIDC with domain workspaces. Magic link, passwords and Slack login are removed. *(done)*
3. **Google Meet auto-capture:** "Connect Google", Meet transcript and Gemini notes poller, auto-save pipeline.
4. **Slack input-only:** "Connect Slack" from Settings, events mapped to workspaces.
5. **Docs and cleanup.**
