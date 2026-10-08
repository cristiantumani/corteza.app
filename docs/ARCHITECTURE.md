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
| Context for the AI (`/api/ai-context*`) | `src/http/ai-context.js` → `core/context/context-service.js`; documents from Google Drive: `integrations/google/drive-files.js` (`readDriveFile`, the admin's short-lived `drive.file` token from the Google Picker, never stored) | session; company context: admins only (`isAdmin`). The Settings page alone opens the CSP to Google's Picker (`allowDrivePicker` in `middleware/auth.js`) when `GOOGLE_PICKER_API_KEY` and `GOOGLE_CLOUD_PROJECT_NUMBER` are set |
| First-run onboarding (`/api/onboarding`, `/api/onboarding/seen`) | `src/http/onboarding.js` → `core/onboarding/onboarding-service.js`; UI `partials/onboarding.html` + `public/scripts/onboarding.js` on Home | session |
| Chrome extension | `browser-extension/` calls `/auth/me`, `/api/spaces?writable=true`, `/api/memory/create` | session cookie (`credentials: 'include'`) |
| Slack (`/slack/events`) | `src/routes/slack.js` (`/decision`, `/decisions`; `/login` only links to the web sign-in), `src/routes/ai-decisions.js` (file uploads → AI suggestions) | Slack signing secret |
| Sign-in | `/auth/login` page → `/auth/google` → Google → `/auth/google/callback` (`src/auth/routes.js`) | Google OpenID Connect (`src/integrations/google/oauth.js`) |
| Jobs | `src/jobs/weekly-digest.js` (opt-in), `src/jobs/reengagement.js` | n/a |

### Key flows

**Logging a decision (dashboard or extension):**
`POST /api/memory/create` → check `canCreateInSpace` → assign the next per-workspace `id` → insert into `decisions`.

**Transcript upload (dashboard):**
`POST /api/ai/extract-from-text` → `extractTextFromFile` → `processTranscriptWeb`:
1. The uploader must be able to post to the target space (`canCreateInSpace`).
2. Deduplicate by content hash in `meeting_transcripts`, only among the same person's uploads.
3. Extract decisions with Claude (`services/claude.js`).
4. Save them to `ai_suggestions` (random, unguessable ids), where the user reviews them.
5. Suggestions belong to the uploader: only they list (`GET /api/ai/pending-suggestions`), approve or reject them. Ids come from the request as plain strings, never objects.
6. Approving one creates the outcome through `createDecision` (atomic number, embedding), in a space the reviewer can post to, already confirmed (`review_status: 'confirmed'`).

**Google Meet auto-capture** (see `docs/integrations/google-meet.md`):
1. A user connects Google Meet in Settings, which stores an encrypted refresh token in `google_connections`.
2. Every 5 minutes, `jobs/meet-poller.js` lists conference records that ended in the last 6 hours for each connection (with a lease so only one poller works on it).
3. `ingestion/sources/google-meet.js` loads the transcript entries and Gemini notes.
4. The skip rules run: 1:1s, excluded titles, meetings with no transcript.
5. `ingestion/pipeline.js` claims the meeting in `ingestions`, extracts decisions with Claude, and saves every decision through `core/decisions/decision-service.createDecision` (`capture: 'ai'`, `source_details` with title and link). No email per meeting: the day's numbers go out in the daily digest.

**Page load (Home and Search):**
- `routes/dashboard.js` renders the page with the user and their spaces already embedded (`window.__CORTEZA_BOOTSTRAP__`, built by `core/spaces/list-spaces.js`). The browser then only fetches decisions; stats load in parallel without blocking.
- Responses are gzip-compressed.
- Static assets are served before the session middleware, so they never read the session from MongoDB, and are cached for 10 minutes.
- Slack installation lookups are cached per workspace for 5 minutes (`config/slack-client.js`).

**Action items:** the pipeline saves decisions (and open questions and risks) through `createDecision`, then the action items through `core/actions/action-service.createActionItem`. Action items are linked to their decision through `decision_ref` → `decision_id`, and spoken owner names are matched to members (`core/actions/owners.js`). Owners hear about new, overdue and undated items in their daily digest (no email per meeting). The page and API are in `src/http/action-items.js` (`/actions`, `GET/PATCH /api/action-items`). People add them by hand with `POST /api/action-items`: to a decision (`decision_id`, the detail modal's "+ Add action item"; closing the modal with the form filled in saves it) or on their own (`space_id`, Log manually with the type Action item, which asks for owners and a due date and never creates an outcome card).

**Open questions & risks** (`core/decisions/questions-risks.js`, page `/questions` in `http/questions-risks.js`): outcomes with `type: 'open_question'` or `'risk'` from the spaces the viewer can access, filtered by type and status, with open counts per type. Anyone who can access the space marks one resolved ("Answered" for a question, "Mitigated" for a risk) with an optional note, or reopens it: `resolution_status` (`open` when missing, `resolved`), `resolution_note`, `resolved_by` { user_id, name }, `resolved_at` on the outcome. API: `GET /api/questions-risks?type=&status=`, `POST /api/questions-risks/:id/resolve` { note? }, `POST …/:id/reopen`.

**Field encryption** (`core/crypto/`, spec `docs/specs/2026-10-workspace-encryption.md`): meeting content (`FIELD_PATHS` in `fields.js`: outcome and action item text, rationale, quotes, resolution notes, topics, meeting titles, AI context, suggestions and feedback examples) is sealed with AES-256-GCM under a per-workspace data key, stored in `workspace_keys` wrapped by `DATA_KEK` (env, phase 1; Google Cloud KMS later). `config/database.js` wraps the Db: writes are sealed when `FIELD_ENCRYPTION=on`, reads always open values (`enc1:<workspace>:<key>:<payload>`; a value that can't be decrypted reads `[unavailable]`). Queries can't filter on encrypted fields (`FIELD_ENCRYPTION_STRICT=true` throws in tests), so keyword search matches the newest `KEYWORD_SEARCH_LIMIT` (2,000) outcomes in memory. Deleting a workspace (GDPR) destroys its keys. `getRawDatabase()` skips the layer. Existing data: migration 012.

**Topic threads** (`core/topics/`, spec `docs/specs/2026-10-topic-threads.md`): outcomes and action items about one subject share `topic_id` (`top_<hex>`) and `topic` (label, ≤ 80 characters). The extraction returns a `topic` per item; `assignTopics` (`topics.js`) groups one capture's items with the same label, plus action items with the decision they carry out (`decision_ref`), and only groups of two or more become threads. `thread-service.js` reads threads as the viewer can see them (outcomes in their spaces; action items in their spaces or owned by them): `GET /api/questions-risks` adds `linked: { outcomes, actions }` per item and takes `?topic=`; `GET /api/action-items` adds `thread` ({ topic, questions, risks, open_questions }); marking an action item done returns `may_resolve` (its open questions and risks: its thread's, else those of the outcome it carries out: that outcome's thread or meeting, plus the outcome itself) and cancelling the last open item of a question or risk returns `orphaned` (`core/actions/close-loop.js`, spec `docs/specs/2026-10-close-loop-actions.md`); answering a question returns `linked_risks`. The pages offer to close them, unchecked, or to add an action item for an orphaned one (`public/scripts/close-loop.js`; nothing closes by itself). An action item added to an outcome joins its thread. The morning summary adds `next_step_on` to due items. Threads start inside one capture; cross-meeting links (below) extend them across meetings. Older captures: `scripts/migrations/010-topic-threads.js` (embeddings: each item joins only its closest question or risk, cosine ≥ 0.6, at most 4 decisions and action items per thread). A due date the AI gives a decision becomes a linked action item; on a question or risk it's ignored.

**Cross-meeting links** (`core/links/`, spec `docs/specs/2026-10-cross-meeting-links.md`, roadmap B4): after a meeting is captured (not imports), `linkAcrossMeetings` (`cross-meeting.js`) compares its new outcomes and action items with open items from earlier meetings the owner can see (open questions and risks, open action items, earlier decisions; last 120 days). Embeddings pre-filter (cosine ≥ `CROSS_MEETING_SIMILARITY`, 15 per item, 40 per meeting); one Claude call (`cross_meeting_links`, metered) judges each pair: same subject, and whether a new decision `answers` a question, `mitigates` a risk or `completes` an action item. New items join the earlier item's thread (`topic_id`; two existing threads are never merged), and a decision stores `resolves: [{ kind, id, relation, reason, status: 'suggested'|'closed' }]` (`reason` encrypted). Nothing closes by itself: `close-links.js` closes the chosen ones when a person confirms (`POST /api/decisions/:id/review` with `close`, or `/links/close`), undo is `/links/reopen`, and `describeLinks` gives the browser only open targets the viewer can see (`GET /api/decisions/:id/links`, Home's `review[].may_close`; raw `resolves` never leaves the server). UI: `public/scripts/may-close.js` (Home review card, detail modal). On only for `CROSS_MEETING_LINKS_DOMAINS`. Outcomes already waiting for review: `scripts/migrations/014-cross-meeting-links.js --domain <domain>`.

**Action items a colleague assigns** (`core/actions/colleague-assignments.js`): when a capture (or a person, by hand) names another member as owner, the pipeline runs `reviewColleagueAssignments` on the new items. For each owner other than the author it looks for the same task among the owner's own items: same meeting (another person's capture), same text, or, with OpenAI embeddings, cosine ≥ `ACTION_DUPLICATE_SIMILARITY` (0.86). Only items from around the meeting count (from a meeting within 3 days, or added by hand from 3 days before to 30 after), so a weekly meeting's recurring task stays a new task. A match goes in `owner_duplicates` and the copy is left out of the owner's list and morning summary; when every owner had already finished it, the copy is saved done (`completed_earlier`). Otherwise the owner goes in `unseen_by`: Action items shows a banner ("N new action items assigned to you by colleagues", by name) and a "New" badge, the sidebar shows the count (`public/scripts/assigned-badge.js`), and the morning summary says who assigned them. Opening Action items clears it (`GET /api/action-items/from-colleagues`, `POST …/from-colleagues/seen`). Hand-assigned items are only flagged, never matched. Item embeddings are stored on the item and never sent to the browser.

**Import past meetings:** Settings → Google Meet → pick a period (at most `MEET_IMPORT_MAX_DAYS` back, 7 during the beta; `parseRange` refuses older periods and `runImport` marks older meetings `too_old` without reading them) → `GET /api/integrations/google/meetings` lists the meetings (`ingestion/meet-import.findMeetings`) → the user ticks some → `POST /api/integrations/google/imports` starts a background job (`meet_imports`) that runs each meeting through the same pipeline with `manual: true` → the UI polls for progress. **Batch extraction** (`ingestion/batch-extraction.js`): the job extracts its importable meetings in one Message Batches request at half price (`services/claude.prepareExtraction` builds the same prompt as a live call, `buildExtractionParams` the same request, without server-side fallbacks). Items wait as `extracting` with their `batch_id` (custom_id); `meet_imports.batch` holds `{ id, submitted_at, requests, collected_at }`. The Meet poller's `resumeStaleImports` checks the batch every 5 minutes; when it has ended, each meeting is read from Google again (transcripts are never stored) and saved through the pipeline with the batch's reply (`finishExtraction`, AI usage feature `extraction_batch`). A request the batch failed or expired, a batch that can't be created, and meetings that need no AI call (too short, already imported, over the daily AI cap) go through the live path one at a time. `AI_BATCH_IMPORTS=false` turns batching off. The job runs on the server, so people can leave the page: `GET /api/integrations/google` returns `active_import` (the running job, `getActiveImport`), which Home shows as a progress bar and Settings uses to pick the progress back up; when the job finishes, `sendImportSummaryEmail` emails the person a summary, once.

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

   **Private beta** (`BETA_REQUIRED=true`): the last two cases (a new workspace) only happen for people on the approved list, `beta_access` (an email, or a whole Google domain; `src/core/beta/beta-access.js`). Anyone else is sent to the website's early access form (`EARLY_ACCESS_URL?from=signin`; the email isn't put in the URL, which ends up in analytics and logs) and nothing is saved.
4. The session is regenerated (new ID) and the user goes to the page they were trying to open, or the dashboard. There are no onboarding questions: the name comes from Google, and company, team size and meeting tool were asked on the website's early access form.

**Approving beta testers:**
1. Someone requests early access on the website. Its edge function (`Corteza_website`, `supabase/functions/trigger-webhook`) emails the team, with an **Approve** link to `/beta/approve?t=<token>`. The token is the signup (email, first name, company, 30-day expiry) signed with HMAC-SHA256 using `BETA_APPROVAL_SECRET`, which the app and the website share.
2. `GET /beta/approve` shows a confirmation page (email scanners open links, so GET changes nothing). `POST` adds them to `beta_access` and sends the welcome email ("Sign in with Google") from Cristian's address so testers can reply (every other email comes from `noreply@corteza.app`), once, via `approveBetaTester` (`src/core/beta/approve.js`, route in `src/http/beta.js`).
3. Without the link: `node scripts/beta-approve.js <email|domain> [--name Ana] [--welcome]`, or `--list`.

Linking an older workspace (Slack or magic link) to a Google domain: `scripts/migrations/002-link-workspace-to-google.js`.

**Request input** (`src/middleware/input-safety.js`, wired in `src/index.js`): after the session, one `express.json({ limit: '1mb' })` parses every JSON body and `rejectOperatorKeys` answers 400 when a body has a key starting with `$` or `__proto__` at any depth, so `{"id": {"$ne": ""}}` can't turn a lookup into a query. Slack's routes are registered by Bolt before it and keep their raw body. Multipart uploads run the same check after multer. Malformed or oversized JSON gets a JSON 400/413 (`jsonBodyErrors`).

**AI usage and limits** (`core/usage/ai-usage.js`):
- **Recorded:** every Claude call (extraction, search answers) adds to `ai_usage`, one document per workspace, person and UTC day: calls, input and output tokens, and per-feature totals.
- **Per hour:** `aiRateLimiter` allows 20 AI requests per hour per signed-in person (per IP without a session). It runs on search, extraction from text and transcript uploads. The general API limit is 1000 requests per 15 minutes per person.
- **Per day:** `requireAiBudget` returns a 429 with a readable message when the person passed `AI_DAILY_CALLS_PER_USER` or the workspace passed `AI_DAILY_TOKENS_PER_WORKSPACE`. It runs on search, extraction from text and uploads. Slack transcripts check the workspace cap.
- **Imports and capture:** imports of past meetings are skipped at the workspace cap (`skip_reason: 'ai_budget'`, re-import them the next day). Automatic capture of new meetings is recorded but never blocked.
- **Input size:** search questions are capped at 1000 characters, and uploads at 5 MB.

**Daily digest** (`jobs/daily-digest.js`, email in `utils/n8n-client.sendDailyDigestEmail`): the one routine email, a morning summary to plan the day.
- **Replaces** the per-meeting capture email and the per-meeting due date requests.
- **When:** Mon–Fri at `DAILY_DIGEST_HOUR` (default 8:00) in each person's time zone, within a 4-hour window (a restart doesn't skip a day; nobody gets it in the afternoon).
- **Time zone** (`core/users/timezone.js`): `workspace_members.timezone` (IANA name) with `timezone_source`:
  - `auto`: every app page reports the browser's zone once per session (`public/scripts/timezone.js`, loaded by the sidebar partial) to `POST /api/me/timezone` (`http/timezone.js`);
  - `manual`: picked in Settings → Morning summary; the browser never overrides it.
  - Without one: the workspace's most common zone, else `DAILY_DIGEST_DEFAULT_TIMEZONE` (default UTC).
- **Content:** each member gets their own counts since their previous check (at most 72 h, so Monday covers the weekend):
  - on their plate today: their own open action items due today (their local date) or overdue, listed with their text and meeting title (up to 5, each with an **Open** link to `/actions?item=…`; copies captured by colleagues show once), then counts of outcomes to review in their spaces and items without a due date;
  - since then: meetings captured for them and their outcomes by type (imports, `ingestions.manual`, don't count), and action items newly assigned to them.
  - **prepare for today's meetings** (`core/briefs/meeting-prep.js`): with calendar access (the optional `calendar.events.readonly` scope on the Google connection, `connections.hasCalendar`), the rest of their local day's events (`integrations/google/calendar-client.js`; timed, not declined, at least one other attendee, with their Meet code), each with what is open from **its own history**, never from its attendees (spec `docs/specs/2026-10-meeting-prep-series.md`). Earlier instances are the conference records of the event's Meet code (`meet-client.listConferenceRecordsForMeetingCode`, matched to `source.external_id` / `source_details.external_id`), or the same title when Meet can't tell (no link, an error, captures not from Meet); a code match with two unrelated real titles is dropped (a reused personal room). For a series: everyone's open action items with their owner (overdue first, 5 max), open questions and risks (3), and what was closed since the last instance (3). A meeting without history is listed with nothing connected; a 1:1 without history suggests the open items shared with that person. Only what the person can see (their spaces, or items they own); copies show once. At most 8 meetings, one Meet call each, no AI. Events and records are read when the summary is built, never stored or logged; Google errors leave the summary without this section (Meet errors fall back to titles). A meeting with nothing to show doesn't make the summary news.
- **Content limits:** besides counts, only the text of the person's own due and overdue action items, and in meeting prep the open items, questions and risks of today's meetings' earlier sessions that they can already see in Corteza (their spaces, or items they own); never decisions, colleagues' private items or transcript text. `daily_digests` keeps counts only. Links: `/actions?item=…`, `/actions?due=today|overdue|none`, `/dashboard?review=pending`. No one-click actions in the email (link scanners would trigger them). `/api/action-items` computes "today" and "overdue" in the viewer's saved time zone.
- **Only when there's news, something due today, or a meeting today with items to prepare:** the other reminders alone never send it.
- **Once per person per day:** each person/local day is claimed in `daily_digests` (unique on workspace, user and day; the row keeps the time zone used).
- **Morning partner** (`core/digest/voice.js`, spec `docs/specs/2026-10-morning-partner.md`): a personality (The Sergeant, The Sarcastic Colleague) writes the subject and opening line from a fixed library (`core/digest/lines/`, English and Spanish, no AI), picked by situation (all clear, due today, 1–2 / 3–5 / 6+ overdue, meeting prep only) without repeating a line within 14 days. The person picks it in Settings (`workspace_members.digest_voice`; missing means `DIGEST_DEFAULT_VOICE`, default `sarcastic` during the beta); admins can turn it off (`workspaces.digest_voices_enabled: false` → Classic). `daily_digests` keeps `voice`, `situation`, `line_id` and `language`, never the line. Classic renders exactly as before.
- **Opt-out:** the email's signed link (`/digest/unsubscribe?…&k=daily`) sets `workspace_members.daily_digest_opt_out`.

**Reviewing AI-captured outcomes** (`core/decisions/review-service.js`, `http/decision-review.js`, `public/scripts/outcome-review.js`):
- **On Home:**
  - cards of AI-captured outcomes nobody reviewed say **Needs review** and show ✓ Confirm / ✕ Dismiss (also in the detail modal);
  - "N to review" next to the list title filters to them;
  - the capture and import emails link to `/dashboard?review=pending`.
- **Confirm** (`POST /api/decisions/:id/review {action:'confirm'}`) marks it confirmed and saves an approved example.
- **Dismiss** removes the outcome and saves a rejected example with a copy of it.
  - A toast offers **Undo** (`POST /api/decisions/:id/restore`, same number, only for whoever dismissed it).
  - It also offers optional "Why?" chips (`POST /api/decisions/:id/dismiss-reason`): not relevant, nobody decided this, inaccurate, duplicate, about a person.
  - The reason goes into the extraction prompt's "BAD" examples.
- **Permission:** same as editing (your own outcomes, or an admin), and only in spaces you can access, so a colleague's personal space is out of reach even for admins.

**Product analytics (PostHog, server-side only):** `src/integrations/posthog/client.js`.
- **What's sent:** events with counts, types and ids, never meeting content (transcripts, outcome text, search questions or answers, AI context). This keeps Meet data within Google's Limited Use policy.
- **URLs:** only the path, never the query string (OAuth codes, search text).
- **Who:** inside a request, events go to the signed-in user (the session's `user_id`; client-sent `x-posthog-*` headers are ignored). Background work passes the owner: `track(event, props, userId)`. Sign-in sets email, name and workspace on the person (`identify`).
- **Events:**
  - `user_signed_in`, `google_meet_connected`, `google_meet_sync_completed`, `google_meet_import_started`;
  - `meeting_captured` (outcome counts per type) and `meeting_capture_failed`;
  - `semantic_search_completed`, `action_item_added`, `action_item_updated`, `onboarding_closed` (finished, skipped or link, and the step);
  - `outcome_confirmed`, `outcome_dismissed` (with the reason), `outcome_dismiss_reason`, `outcome_restored`;
  - invites, spaces, Jira, web extraction and suggestion review;
  - uncaught route errors (`$exception`).
- **AI cost:** each Claude call (extraction, search answer) is an `$ai_generation` event with model, tokens and latency only (`trackAiGeneration`). The prompt and the output are not sent.
- **Off** when the env vars are missing, in tests, or with `POSTHOG_DISABLED=1` (the extraction eval). Queued events are sent on SIGTERM.

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
| `decisions` | Meeting **outcomes** (the UI's word): decisions, open questions, risks and notes. `GET /api/decisions?type=` takes one type or several (`open_question,risk`). Fields: `id` per workspace, `space_id`, `type` (see `core/decisions/types.js`), `text`, `tags`, `embedding`, `source`. AI-captured items also have `owner_name`, `due_date` (YYYY-MM-DD), `rationale` and `evidence_quote`. The owner is the person **accountable** for the outcome: a member (`owner_user_id` + `owner_name`) or a name heard in the meeting (`owner_name` only). AI-captured open questions and risks also have `raised_by`: who raised it, as named in the meeting (risks show it as "Raised by"). Outcomes have no due dates: `due_date` only exists on older captures, and new dated commitments become linked `action_items`. **Review:** AI-captured outcomes (`capture: 'ai'`) with no `review_status` are waiting for review; Confirm sets `review_status: 'confirmed'`, `reviewed_by`, `reviewed_at`. `GET /api/decisions` returns `pending_review` (count in that space) and takes `?review=pending`. **Open questions and risks** also carry `resolution_status` (`open`/`resolved`), `resolution_note`, `resolved_by`, `resolved_at` (`core/decisions/questions-risks.js`). `topic_id`, `topic`: its topic thread (`core/topics`) |
| `workspace_spaces`, `space_members` | Spaces and explicit space membership |
| `workspace_members`, `workspace_admins`, `workspace_invites` | Membership, admins, invite links. `workspace_members.onboarding_seen_at`: when the person finished or skipped the first-run onboarding (`core/onboarding`). `workspace_members.digest_voice`: their morning partner (`core/digest`). `workspace_members.language`: the app language they picked (`'en'`/`'es'`; missing: the browser's, `core/i18n`); `browser_language`: the browser's language, saved for emails when they haven't picked one |
| `ai_suggestions`, `meeting_transcripts`, `ai_feedback` | AI extraction queue, uploaded transcripts (file name, word count and `content_hash` only: the text is never stored; `scripts/migrations/011-remove-uploaded-transcript-text.js` removed it from older uploads), approve/reject feedback used as few-shot examples. Reviews on Home add rows with `source: 'review'`, `decision_id`, `action` ('approved' / 'rejected'), `reason` and, for dismissals, a `snapshot` of the outcome (no embedding) to undo. Extraction reads only the meeting owner's own feedback (`user_id`), so colleagues' outcomes never reach their prompt |
| `workspace_settings` | Per-workspace settings, such as encrypted Jira credentials |
| `api_keys` | No longer used: API keys and `/api/v1/*` were removed (Sept 2026). Old rows are ignored |
| `workspaces` | One row per workspace; unique `google_domain` maps a Google Workspace domain to it |
| `users` | Google accounts (`google_sub`, `email`, `last_workspace_id`) |
| `ai_context` | Context the AI reads with every meeting (`core/context`), unique on `workspace_id` + `user_id`. Company row (`user_id: null`): `description`, `glossary`, `documents` (`doc_id`, `name`, extracted `text`, `chars`, and `source: { type: 'google_drive', file_id, mime_type, modified_time }` when picked from Drive), edited by admins, used by everyone's captures. Personal rows: `role`, `focus`, `glossary`, used only by that person's captures. Capped (4k description, 8k glossary, 5 documents / 40k characters) so it stays a small part of the prompt |
| `beta_access` | Private beta approved list: one row per `email` or Google `domain` (each unique), with `name`, `company`, `approved_at`, `approved_via` ('email_link' / 'script'), `welcome_sent_at` (`core/beta`) |
| `sessions` | Express sessions (connect-mongo, 7 days) |
| `slack_installations` | Slack OAuth installs (Bolt installation store) |
| `google_connections` | Per-user "Connect Google Meet": encrypted refresh token, settings (space, skip 1:1, excluded keywords, `language`: 'auto' or a fixed 'es'/'en'/'pt' for the outcomes' language), poll cursor/lease, counters (`decisions_captured` = all outcomes, `outcomes_by_type`, `meetings_processed`) |
| `ingestions` | One row per person per processed/skipped external item (unique `workspace_id` + `user_id` + `source` + `external_id`): colleagues in the same meeting each capture it into their own personal space. `user_id` is whose Google Meet connection handled it; "Latest meetings" shows each person only their own (older rows backfilled by `scripts/migrations/008-ingestion-owners.js`). status, attempts, `decisions_created` (all outcomes), `outcomes_by_type` (e.g. `{ decision: 3, risk: 1 }`, from `countByType`), `action_items_created` |
| `search_feedback` | Search → "Is this related to your question?": one row per `workspace_id` + `user_id` + `query` + `decision_id`, with `relevant` (true/false). Kept to tune search later |
| `counters` | Atomic per-workspace decision ids (`decision:<workspace_id>`) |
| `action_items` | Action items ("pendientes") from meetings: `owners` [{ name, user_id, email }], `owner_ids`, `due_date`, `status` open/done/cancelled, `decision_id` (the decision it carries out), `source`, `evidence_quote`, `due_date_requested_at`, `owner_duplicates` [{ user_id, item_id, status }], `unseen_by` [user_id], `completed_earlier`, `embedding` (`core/actions`; the last four never reach the browser), `topic_id`, `topic` (`core/topics`) |
| `meet_imports` | "Import past meetings" jobs: chosen meetings with per-meeting status and outcome counts (`outcomes_by_type`), totals, progress, lease for resume |
| `feedback` | User feedback from the dashboard |
| `digest_runs` | Weekly digest claims (one per workspace per week) |
| `extension_installs` | Chrome extension installs and activation |

### Environment

See `.env.example`. Required today: `MONGODB_URI`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (nobody can sign in without them), `SLACK_SIGNING_SECRET`, and either a Slack bot token or Slack OAuth credentials. The Google OAuth redirect URI is `${BASE_URL}/auth/google/callback`. Optional: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `BASE_URL`, `FEEDBACK_EMAIL`, `WEEKLY_DIGEST_ENABLED`, `DIGEST_HOUR_UTC`, `DAILY_DIGEST_ENABLED` (on unless `false`), `DAILY_DIGEST_HOUR` (local hour, default 8), `DAILY_DIGEST_DEFAULT_TIMEZONE` (default UTC), `DIGEST_DEFAULT_VOICE` (`classic` | `sergeant` | `sarcastic`, default `sarcastic`), `MEET_CAPTURE_ENABLED`, `MEET_POLL_INTERVAL_MINUTES`, `MEET_IMPORT_MAX_DAYS` (default 7), `AI_BATCH_IMPORTS` (on unless `false`), `BETA_REQUIRED`, `BETA_APPROVAL_SECRET`, `EARLY_ACCESS_URL`, `BETA_FROM` (sender of the beta welcome email, default `Cristian from Corteza <cristian@corteza.app>`), `BETA_REPLY_TO`, `JIRA_*`, `DB_NAME`, `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` (product analytics, off when unset), `POSTHOG_DISABLED`, `AI_DAILY_CALLS_PER_USER` (default 150), `AI_DAILY_TOKENS_PER_WORKSPACE` (default 3,000,000), `ACTION_DUPLICATE_SIMILARITY` (default 0.86).

### Migrations

Run manually, and they're safe to re-run. Each script starts as a dry run and needs `--apply` to write.

- `scripts/migrations/001-backfill-default-spaces.js`: creates missing default spaces and moves decisions without a space into them.
- `scripts/migrations/002-link-workspace-to-google.js`: links an older workspace to a Google domain and sets a member's email to their Google account, so their first Google sign-in lands in it. `--list` shows workspaces and members.
- `scripts/migrations/003-repair-member-roles.js`: restores `workspace_members.role` (admin/member) that the old onboarding overwrote with a job title.
- `scripts/migrations/005-move-action-items.js`: moves action items that extraction v2 briefly saved as decisions (`type: 'action_item'`) into `action_items`.
- `scripts/migrations/009-review-colleague-assignments.js`: runs the colleague-assignment check (`core/actions/colleague-assignments`) on action items saved before it, last 45 days by default; dry run unless `--apply`.
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
| 3 | "Connect Google" (Meet and Drive-Meet scopes), Meet poller, ingestion pipeline with auto-save, privacy defaults (skip 1:1s, keyword exclusions), summary email (replaced by the daily digest, Sept 2026), AI-captured badge with edit and delete *(done)* |
| 4 | "Connect Slack" install flow mapped to a workspace; `/decision` and uploads through the pipeline; no Slack identity |
| 5 | Split docs (DATA_MODEL, INGESTION, AUTH, GOOGLE, SLACK, DEPLOY, ADRs), remove unused dependencies and collections |
