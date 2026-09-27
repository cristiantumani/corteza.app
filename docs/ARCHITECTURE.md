# Corteza architecture

The first half describes the system **as it is today** (after Phase 0). The second half is the **target architecture** for the Google Workspace refocus. Change this file whenever either one changes.

## Today

### Runtime

- **Stack:** one Node.js process (Express + Slack Bolt) on Railway, backed by MongoDB Atlas.
- **AI:** Anthropic Claude for decision extraction and conversational search, and OpenAI `text-embedding-3-small` for semantic-search embeddings.
- **Email:** Resend.
- **Coupled to Slack:** Express is currently created by Bolt's `ExpressReceiver` (`src/index.js`), so the app still needs Slack env vars to start. Phase 1 removes that coupling.

### Entry points

| Entry point | Code | Auth |
|---|---|---|
| Dashboard pages (`/dashboard`, `/settings`, `/select-space`, `/ai-search`, `/ai-analytics`) | `src/routes/dashboard.js`, `src/views/*`, `public/scripts/*` | session (`requireAuthBrowser`) |
| Dashboard JSON API (`/api/*`) | `src/routes/api.js`, `spaces-api.js`, `invites-api.js`, `ai-extract-web.js`, `settings-api.js`, `semantic-search-api.js` | session + `requireWorkspaceAccess` |
| Integration API (`/api/v1/*`) | `src/routes/extract-api.js`, `api.js#getDecisionById` | API key (`src/middleware/api-key-auth.js`) |
| Chrome extension | `browser-extension/` calls `/auth/me`, `/api/spaces?writable=true`, `/api/memory/create` | session cookie (`credentials: 'include'`) |
| Slack (`/slack/events`) | `src/routes/slack.js` (`/decision`, `/decisions`, `/login`), `src/routes/ai-decisions.js` (file uploads → AI suggestions) | Slack signing secret |
| Login | `/auth/login` page; magic link (`email-auth.js`), password (`password-auth.js`), Slack `/login`, all ending at `/auth/token` (`dashboard-auth.js`) | one-time tokens (`src/services/login-tokens.js`) |
| Jobs | `src/jobs/weekly-digest.js` (opt-in), `src/jobs/reengagement.js` | n/a |

### Key flows

**Logging a decision (dashboard or extension):**
`POST /api/memory/create` → check `canCreateInSpace` → assign the next per-workspace `id` → insert into `decisions`.

**Transcript upload (dashboard):**
`POST /api/ai/extract-from-text` → `extractTextFromFile` → `processTranscriptWeb`:
1. Deduplicate by content hash in `meeting_transcripts`.
2. Extract decisions with Claude (`services/claude.js`).
3. Save them to `ai_suggestions`, where the user reviews them.
4. Approving a suggestion inserts it into `decisions`.

**Transcript via automation:**
`POST /api/v1/extract` (API key) → same pipeline, into the key owner's space or the default space → a pending banner in the dashboard.

**Slack `/decision`:**
modal → insert into `decisions`, in the workspace's **default space** (`ensureDefaultSpace`).

**Login (token):**
`/auth/token` → `consumeLoginToken` → `resolveMembership`, then:
- **New workspace:** the first user becomes admin and a default space is created.
- **Slack `/login`:** joins as a member.
- **Email magic link to an existing workspace:** refused, because joining needs an invite.

Only after that is the session created.

### Workspaces, spaces, permissions

- **`workspace_id`:** a Slack team ID (`T…`) for Slack-installed workspaces, or `W<NAME>` for email-created ones. There is no `workspaces` collection yet; a workspace is implied by its `workspace_members` rows.
- **Default space:** every workspace has exactly one public default space, "General". `ensureDefaultSpace()` creates it lazily, including on every `GET /api/spaces`, and a partial unique index enforces one per workspace.
- **Spaces** are `public`, `shared` or `private`. Space roles are owner, admin, member and viewer. Rules are in `src/services/permissions.js`. `GET /api/spaces` returns `can_create` per space, and `?writable=true` returns only spaces the user can post to.
- **Workspace admins** live in `workspace_admins`. `isAdmin` still falls back to Slack admin status; Phase 1 removes that.

### MongoDB collections

| Collection | Purpose |
|---|---|
| `decisions` | Decisions and other memories (`id` per workspace, `space_id`, `type`, `text`, `tags`, `embedding`, `source`) |
| `workspace_spaces`, `space_members` | Spaces and explicit space membership |
| `workspace_members`, `workspace_admins`, `workspace_invites` | Membership, admins, invite links |
| `ai_suggestions`, `meeting_transcripts`, `ai_feedback` | AI extraction queue, uploaded transcripts, approve/reject feedback used as few-shot examples |
| `workspace_settings` | Per-workspace settings, such as encrypted Jira credentials |
| `api_keys` | Integration API keys |
| `login_tokens` | One-time login tokens (hashed, TTL index) |
| `sessions` | Express sessions (connect-mongo, 7 days) |
| `slack_installations` | Slack OAuth installs (Bolt installation store) |
| `feedback` | User feedback from the dashboard |
| `digest_runs` | Weekly digest claims (one per workspace per week) |
| `extension_installs` | Chrome extension installs and activation |

### Environment

See `.env.example`. Required today: `MONGODB_URI`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `SLACK_SIGNING_SECRET`, and either a Slack bot token or Slack OAuth credentials. Optional: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `BASE_URL`, `FEEDBACK_EMAIL`, `WEEKLY_DIGEST_ENABLED`, `DIGEST_HOUR_UTC`, `JIRA_*`, `DB_NAME`.

### Migrations

Run manually, and they're safe to re-run. Each script starts as a dry run and needs `--apply` to write.

- `scripts/migrations/001-backfill-default-spaces.js`: creates missing default spaces and moves decisions without a space into them.

---

## Target (Google Workspace refocus)

### Product scope

1. **Auto-capture:** Google Meet transcripts and Gemini notes are turned into saved decisions with no review step. Every decision is marked AI-captured, links to the meeting, and can be edited or deleted.
2. **Manual capture:** Chrome extension and dashboard.
3. **Slack:** an input source only, connected from Settings, with no identity.

**Identity:**
- Sign in with Google only.
- A company's Google domain is its Corteza workspace, and colleagues join automatically.
- Consumer accounts (gmail.com) get a personal workspace.

### Module layout

```
src/
  server.js              # boot: config → db → app → jobs (Slack optional)
  app.js                 # express app, middleware, route mounting
  config/                # env validation, db connection, collections
  core/                  # business logic; no Express/Slack/Google imports
    decisions/           # decision-service.js — the ONLY place that writes decisions
    workspaces/          # create/find by Google domain, default space
    users/               # users + memberships
    spaces/              # space rules (from services/permissions + services/spaces)
  ingestion/
    pipeline.js          # Transcript → dedupe → extract → decisionService.create → notify
    extractor.js         # Claude extraction (from services/claude.js)
    parsers/             # txt/md/vtt/srt/pdf/docx (from utils/text-extractors.js)
    sources/             # adapters producing a Transcript
      google-meet/  slack/  upload/  api/
  integrations/          # thin API clients + token storage
    google/  slack/  jira/  email/
  auth/                  # Google sign-in, session, requireAuth/requireWorkspace/requireAdmin, API keys
  http/                  # route modules only: parse → call core/ingestion → respond
  jobs/                  # scheduler.js (Mongo lease locks) + meet-poller, weekly-digest, reengagement
```

**Rules:**
- `core/` never imports `http/`, `integrations/` or Express.
- Every source adapter produces `Transcript { workspaceId, source, externalId, title, text, participants, occurredAt, url }`.
- Decisions are only written through `decision-service`.

### Data model changes

- **`workspaces` (new):** `{ workspace_id, name, google_domain (unique), slack_team_id (unique), created_at }`
- **`users` (new):** `{ user_id, email (unique), google_sub (unique), name }`
- **`google_connections` (new):** `{ user_id, workspace_id, scopes, refresh_token_encrypted, last_polled_at, settings, status }`
- **`ingestions` (new):** unique `(workspace_id, source, external_id)`, with status and `decisions_created`. Replaces the dedup role of `meeting_transcripts`.
- **`decisions`:** standardized `source { type, external_id, title, url }`, `capture: ai|manual`, `confidence`, a required `space_id`, and `deleted_at` for soft delete.
- **`counters`:** atomic per-workspace decision IDs.

Existing `workspace_id` and `user_id` values are kept as opaque strings; migrations only add rows.

### Phases

| Phase | Outcome |
|---|---|
| 0 | Default spaces, workspace-takeover fix, DB-backed login tokens, Obsidian and dead code removed, tests, lint, CI, these docs *(done)* |
| 1 | `core/decisions` single write path and counters, `app.js`/`server.js` split, Slack optional, `workspaces`/`users` collections, DB-only admin checks, scheduler |
| 2 | Google OIDC sign-in with domain workspaces; magic link, passwords and Slack `/login` removed; extension uses Google sign-in |
| 3 | "Connect Google" (Meet and Drive-Meet scopes), Meet poller, ingestion pipeline with auto-save, privacy defaults (skip 1:1s, keyword exclusions), summary email, AI-captured badge with edit and delete |
| 4 | "Connect Slack" install flow mapped to a workspace; `/decision` and uploads through the pipeline; no Slack identity |
| 5 | Split docs (DATA_MODEL, INGESTION, AUTH, GOOGLE, SLACK, DEPLOY, ADRs), remove unused dependencies and collections |
