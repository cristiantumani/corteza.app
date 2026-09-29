# Corteza architecture

The first half describes the system **as it is today** (after Phase 0). The second half is the **target architecture** for the Google Workspace refocus. Change this file whenever either one changes.

## Today

### Runtime

- **Stack:** one Node.js process (Express + Slack Bolt) on Railway, backed by MongoDB Atlas.
- **AI:** Anthropic Claude for decision extraction and conversational search, and OpenAI `text-embedding-3-small` for semantic-search embeddings.
- **Search** (`POST /api/semantic-search`, `services/semantic-search.js`):
  - Uses vector search when `OPENAI_API_KEY` is set. Otherwise, or when vector search finds nothing, it falls back to keyword search (`core/search/relevance.js`: English and Spanish stop words, accents ignored, word-start matches, about half of the keywords required).
  - With fewer than 3 matches (semantic search off, or question and sources in different languages), the space's 60 latest outcomes are added as candidates (`recentOutcomes`). Claude picks the ones that answer, and only those are shown (`visibleSources`).
  - Claude answers in the question's language and returns `used_ids`, the sources it used.
  - `exclude_ids` answers again without sources the user marked as unrelated (`POST /api/search-feedback`).
  - Results never include `embedding`.
  - **Open action items** (`core/search/action-items.js`): the open items the question is about go to Claude with the outcomes and back as `action_items`, shown above Evidence Sources. A person named in the question (any owner name) gets their items; "my/mis pendientes" gets the viewer's; a question about pending work gets items on its topic, or all of them; other questions only get items on their topic (at most 5). Items come from the current space plus those the viewer owns.
- **Email:** Resend.
- **Coupled to Slack:** Express is currently created by Bolt's `ExpressReceiver` (`src/index.js`), so the app still needs Slack env vars to start. Phase 1 removes that coupling.

### Entry points

| Entry point | Code | Auth |
|---|---|---|
| Dashboard pages (`/dashboard`, `/settings`, `/ai-search`; `/select-space` redirects to Home) | `src/routes/dashboard.js`, `src/views/*`, `public/scripts/*` | session (`requireAuthBrowser`) |
| Dashboard JSON API (`/api/*`) | `src/routes/api.js`, `spaces-api.js`, `invites-api.js`, `ai-extract-web.js`, `settings-api.js`, `semantic-search-api.js` | session + `requireWorkspaceAccess` |
| Chrome extension | `browser-extension/` calls `/auth/me`, `/api/spaces?writable=true`, `/api/memory/create` | session cookie (`credentials: 'include'`) |
| Slack (`/slack/events`) | `src/routes/slack.js` (`/decision`, `/decisions`; `/login` only links to the web sign-in), `src/routes/ai-decisions.js` (file uploads → AI suggestions) | Slack signing secret |
| Sign-in | `/auth/login` page → `/auth/google` → Google → `/auth/google/callback` (`src/auth/routes.js`) | Google OpenID Connect (`src/integrations/google/oauth.js`) |
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

**Google Meet auto-capture** (see `docs/integrations/google-meet.md`):
1. A user connects Google Meet in Settings, which stores an encrypted refresh token in `google_connections`.
2. Every 5 minutes, `jobs/meet-poller.js` lists conference records that ended in the last 6 hours for each connection (with a lease so only one poller works on it).
3. `ingestion/sources/google-meet.js` loads the transcript entries and Gemini notes.
4. The skip rules run: 1:1s, excluded titles, meetings with no transcript.
5. `ingestion/pipeline.js` claims the meeting in `ingestions`, extracts decisions with Claude, and saves every decision through `core/decisions/decision-service.createDecision` (`capture: 'ai'`, `source_details` with title and link). The connected user gets a summary email.

**Page load (Home and Search):**
- `routes/dashboard.js` renders the page with the user and their spaces already embedded (`window.__CORTEZA_BOOTSTRAP__`, built by `core/spaces/list-spaces.js`). The browser then only fetches decisions; stats load in parallel without blocking.
- Responses are gzip-compressed.
- Static assets are served before the session middleware, so they never read the session from MongoDB, and are cached for 10 minutes.
- Slack installation lookups are cached per workspace for 5 minutes (`config/slack-client.js`).

**Action items:** the pipeline saves decisions (and open questions and risks) through `createDecision`, then the action items through `core/actions/action-service.createActionItem`. Action items are linked to their decision through `decision_ref` → `decision_id`, and spoken owner names are matched to members (`core/actions/owners.js`). For recent meetings, owners of undated items are emailed for a date (`core/actions/due-date-requests.js`). The page and API are in `src/http/action-items.js` (`/actions`, `GET/PATCH /api/action-items`).

**Import past meetings:** Settings → Google Meet → pick a period → `GET /api/integrations/google/meetings` lists the meetings (`ingestion/meet-import.findMeetings`) → the user ticks some → `POST /api/integrations/google/imports` starts a background job (`meet_imports`) that runs each meeting through the same pipeline with `manual: true` → the UI polls for progress. The job runs on the server, so people can leave the page: `GET /api/integrations/google` returns `active_import` (the running job, `getActiveImport`), which Home shows as a progress bar and Settings uses to pick the progress back up; when the job finishes, `sendImportSummaryEmail` emails the person a summary, once.

**Slack `/decision`:**
modal → insert into `decisions`, in the workspace's **default space** (`ensureDefaultSpace`).

**Sign in with Google** (the only way to log in):
1. `/auth/google` stores a random `state` and `nonce` in the session and redirects to Google (scopes `openid email profile`).
2. `/auth/google/callback` checks `state`, exchanges the code, and verifies the ID token (signature, audience, expiry, `nonce`) with `google-auth-library`.
3. `signInWithGoogle` (`src/auth/google-signin.js`) picks the workspace:
   - **Invite link** (`/auth/google?invite=<id>`): joins the invite's workspace with its role and space. An invite addressed to an email only works for that account.
   - **Existing membership** (matched by email): the last workspace used, else the one owning the user's Google domain. An admin of a workspace without a domain claims theirs, so colleagues auto-join.
   - **Google Workspace account whose domain has a workspace:** joins as a member.
   - **New Google Workspace domain:** creates the workspace and becomes admin.
   - **Consumer account (gmail.com):** gets a personal workspace.

   Only Google's `hd` claim counts as the domain, never the email's domain.

   **Private beta** (`BETA_REQUIRED=true`): the last two cases (a new workspace) only happen for people on the approved list, `beta_access` (an email, or a whole Google domain; `src/core/beta/beta-access.js`). Anyone else is sent to the website's early access form (`EARLY_ACCESS_URL?email=…&from=signin`) and nothing is saved.
4. The session is regenerated (new ID) and the user goes to the page they were trying to open, or the dashboard. There are no onboarding questions: the name comes from Google, and company, team size and meeting tool were asked on the website's early access form.

**Approving beta testers:**
1. Someone requests early access on the website. Its edge function (`Corteza_website`, `supabase/functions/trigger-webhook`) emails the team, with an **Approve** link to `/beta/approve?t=<token>`. The token is the signup (email, first name, company, 30-day expiry) signed with HMAC-SHA256 using `BETA_APPROVAL_SECRET`, which the app and the website share.
2. `GET /beta/approve` shows a confirmation page (email scanners open links, so GET changes nothing). `POST` adds them to `beta_access` and sends the welcome email ("Sign in with Google"), once, via `approveBetaTester` (`src/core/beta/approve.js`, route in `src/http/beta.js`).
3. Without the link: `node scripts/beta-approve.js <email|domain> [--name Ana] [--welcome]`, or `--list`.

Linking an older workspace (Slack or magic link) to a Google domain: `scripts/migrations/002-link-workspace-to-google.js`.

### Workspaces, spaces, permissions

- **`workspace_id`:** `ws_…` for workspaces created through Google sign-in. Older ones keep their IDs: a Slack team ID (`T…`) or `W<NAME>` from the removed magic-link login.
- **`workspaces`** holds one row per workspace (`name`, unique `google_domain`, `slack_team_id`). Older workspaces get a row the first time they're linked to Google. **`users`** holds one row per Google account (`google_sub`, `email`). Memberships keep their own `user_id`, and the session always uses the membership's.
- **Personal space:** every member has one private space of their own (`personal_for: <user_id>`, name "My space"), created at sign-in and on `GET /api/spaces` by `ensurePersonalSpace()`; they're its owner in `space_members`. Their Google Meet captures, imports and Log manually go there unless they pick another space, so colleagues on the same domain don't see each other's meetings. A partial unique index enforces one per member. It can't be deleted, and admins never see a colleague's personal space. Action items are the exception: an item owned by someone is visible to (and updatable by) that owner even when it sits in a colleague's personal space.
- **One space, no space UI:** while someone has a single space, every space control (header picker, "Searching in", space pickers in Log manually, edit and Google Meet settings, space chips on cards, Settings → Manage Spaces) is hidden: those elements carry `data-multi-space` and the page sets `body.single-space`.
- **Default space:** "General", public, only for captures with no Corteza user behind them (Slack). `ensureDefaultSpace()` creates it when one of those needs it; a partial unique index enforces one per workspace. `scripts/migrations/007-personal-spaces.js` split the old General into personal spaces.
- **Spaces** are `public`, `shared` or `private`. Space roles are owner, admin, member and viewer. Rules are in `src/services/permissions.js`. `GET /api/spaces` returns `can_create` per space, and `?writable=true` returns only spaces the user can post to.
- **Workspace admins** live in `workspace_admins`. `isAdmin` still falls back to Slack admin status; Phase 1 removes that.

### MongoDB collections

| Collection | Purpose |
|---|---|
| `decisions` | Meeting **outcomes** (the UI's word): decisions, open questions, risks and notes. `GET /api/decisions?type=` takes one type or several (`open_question,risk`). Fields: `id` per workspace, `space_id`, `type` (see `core/decisions/types.js`), `text`, `tags`, `embedding`, `source`. AI-captured items also have `owner_name`, `due_date` (YYYY-MM-DD), `rationale` and `evidence_quote`. The owner is the person **accountable** for the outcome: a member (`owner_user_id` + `owner_name`) or a name heard in the meeting (`owner_name` only). Outcomes have no due dates: `due_date` only exists on older captures, and new dated commitments become linked `action_items` |
| `workspace_spaces`, `space_members` | Spaces and explicit space membership |
| `workspace_members`, `workspace_admins`, `workspace_invites` | Membership, admins, invite links |
| `ai_suggestions`, `meeting_transcripts`, `ai_feedback` | AI extraction queue, uploaded transcripts, approve/reject feedback used as few-shot examples |
| `workspace_settings` | Per-workspace settings, such as encrypted Jira credentials |
| `api_keys` | No longer used: API keys and `/api/v1/*` were removed (Sept 2026). Old rows are ignored |
| `workspaces` | One row per workspace; unique `google_domain` maps a Google Workspace domain to it |
| `users` | Google accounts (`google_sub`, `email`, `last_workspace_id`) |
| `beta_access` | Private beta approved list: one row per `email` or Google `domain` (each unique), with `name`, `company`, `approved_at`, `approved_via` ('email_link' / 'script'), `welcome_sent_at` (`core/beta`) |
| `sessions` | Express sessions (connect-mongo, 7 days) |
| `slack_installations` | Slack OAuth installs (Bolt installation store) |
| `google_connections` | Per-user "Connect Google Meet": encrypted refresh token, settings (space, skip 1:1, excluded keywords, `language`: 'auto' or a fixed 'es'/'en'/'pt' for the outcomes' language), poll cursor/lease, counters (`decisions_captured` = all outcomes, `outcomes_by_type`, `meetings_processed`) |
| `ingestions` | One row per person per processed/skipped external item (unique `workspace_id` + `user_id` + `source` + `external_id`): colleagues in the same meeting each capture it into their own personal space. `user_id` is whose Google Meet connection handled it; "Latest meetings" shows each person only their own (older rows backfilled by `scripts/migrations/008-ingestion-owners.js`). status, attempts, `decisions_created` (all outcomes), `outcomes_by_type` (e.g. `{ decision: 3, risk: 1 }`, from `countByType`), `action_items_created` |
| `search_feedback` | Search → "Is this related to your question?": one row per `workspace_id` + `user_id` + `query` + `decision_id`, with `relevant` (true/false). Kept to tune search later |
| `counters` | Atomic per-workspace decision ids (`decision:<workspace_id>`) |
| `action_items` | Action items ("pendientes") from meetings: `owners` [{ name, user_id, email }], `owner_ids`, `due_date`, `status` open/done/cancelled, `decision_id` (the decision it carries out), `source`, `evidence_quote`, `due_date_requested_at` (`core/actions`) |
| `meet_imports` | "Import past meetings" jobs: chosen meetings with per-meeting status and outcome counts (`outcomes_by_type`), totals, progress, lease for resume |
| `feedback` | User feedback from the dashboard |
| `digest_runs` | Weekly digest claims (one per workspace per week) |
| `extension_installs` | Chrome extension installs and activation |

### Environment

See `.env.example`. Required today: `MONGODB_URI`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (nobody can sign in without them), `SLACK_SIGNING_SECRET`, and either a Slack bot token or Slack OAuth credentials. The Google OAuth redirect URI is `${BASE_URL}/auth/google/callback`. Optional: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `BASE_URL`, `FEEDBACK_EMAIL`, `WEEKLY_DIGEST_ENABLED`, `DIGEST_HOUR_UTC`, `MEET_CAPTURE_ENABLED`, `MEET_POLL_INTERVAL_MINUTES`, `BETA_REQUIRED`, `BETA_APPROVAL_SECRET`, `EARLY_ACCESS_URL`, `BETA_REPLY_TO`, `JIRA_*`, `DB_NAME`.

### Migrations

Run manually, and they're safe to re-run. Each script starts as a dry run and needs `--apply` to write.

- `scripts/migrations/001-backfill-default-spaces.js`: creates missing default spaces and moves decisions without a space into them.
- `scripts/migrations/002-link-workspace-to-google.js`: links an older workspace to a Google domain and sets a member's email to their Google account, so their first Google sign-in lands in it. `--list` shows workspaces and members.
- `scripts/migrations/003-repair-member-roles.js`: restores `workspace_members.role` (admin/member) that the old onboarding overwrote with a job title.
- `scripts/migrations/005-move-action-items.js`: moves action items that extraction v2 briefly saved as decisions (`type: 'action_item'`) into `action_items`.
- `scripts/migrations/007-personal-spaces.js`: creates every member's personal space and moves outcomes out of General: all of them (then archives General) when the workspace has one member, else each to the person who captured it. Meet connections that saved to General go back to the personal space.
- `scripts/cleanup-all-data.js`: empties every collection of the app database (keeps collections and indexes) so everyone starts over. Dry run unless `--apply`; `--keep a,b` keeps some collections.
- `scripts/workspace-keep-only.js <email>`: leaves one person as the only member of their workspace; removes everyone else's membership, admin role, space memberships, Meet connection, sessions and account, and revokes invite links. Outcomes are kept unless `--delete-their-outcomes`. Dry run unless `--apply`.
- `scripts/migrations/004-date-meeting-decisions.js`: sets `timestamp` of AI-captured decisions to their meeting's start (`source_details.occurred_at`) instead of when they were saved.

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
    workspaces/          # create/find by Google domain
    users/               # users + memberships
    spaces/              # space rules (from services/permissions + services/spaces)
  ingestion/
    pipeline.js          # Transcript → dedupe → extract → decisionService.create → notify
    extractor.js         # Claude extraction (from services/claude.js)
    parsers/             # txt/md/vtt/srt/pdf/docx (from utils/text-extractors.js)
    sources/             # adapters producing a Transcript
      google-meet/  slack/  upload/
  integrations/          # thin API clients + token storage
    google/  slack/  jira/  email/
  auth/                  # Google sign-in, session, requireAuth/requireWorkspace/requireAdmin
  http/                  # route modules only: parse → call core/ingestion → respond
  jobs/                  # scheduler.js (Mongo lease locks) + meet-poller, weekly-digest, reengagement
```

**Rules:**
- `core/` never imports `http/`, `integrations/` or Express.
- Every source adapter produces `Transcript { workspaceId, source, externalId, title, text, participants, occurredAt, url }`.
- Decisions are only written through `decision-service`.

### Data model changes

- **`workspaces`, `users`:** done in Phase 2 (see above).
- **`google_connections`, `ingestions`, `counters`:** done in Phase 3 (see above).
- **`decisions`:** `createDecision` already writes `source` (string), `source_details { type, external_id, title, url }`, `capture: ai|manual` and `confidence`. Still to do: move the older write sites onto it, and add `deleted_at` for soft delete.
- **`counters`:** atomic per-workspace decision IDs.

Existing `workspace_id` and `user_id` values are kept as opaque strings; migrations only add rows.

### Phases

| Phase | Outcome |
|---|---|
| 0 | Default spaces, workspace-takeover fix, DB-backed login tokens, Obsidian and dead code removed, tests, lint, CI, these docs *(done)* |
| 1 | `core/decisions` single write path and counters, `app.js`/`server.js` split, Slack optional, DB-only admin checks, scheduler |
| 2 | Google OIDC sign-in with domain workspaces; magic link, passwords and Slack `/login` removed; extension uses Google sign-in *(done)* |
| 3 | "Connect Google" (Meet and Drive-Meet scopes), Meet poller, ingestion pipeline with auto-save, privacy defaults (skip 1:1s, keyword exclusions), summary email, AI-captured badge with edit and delete *(done)* |
| 4 | "Connect Slack" install flow mapped to a workspace; `/decision` and uploads through the pipeline; no Slack identity |
| 5 | Split docs (DATA_MODEL, INGESTION, AUTH, GOOGLE, SLACK, DEPLOY, ADRs), remove unused dependencies and collections |
