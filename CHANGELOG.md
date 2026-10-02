# Changelog

All notable changes to Corteza will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added - Support Corteza
- **"Buy me a coffee"** at the top of the sidebar's footer and in the morning summary's footer, a regular link with Buy Me a Coffee's yellow cup as its icon (the only touch of yellow), linking to buymeacoffee.com/corteza.app, so beta testers who find it useful can chip in for the AI costs. A plain link (no third-party widget or script)

### Changed - Importing past meetings costs half as much
- **Batch extraction:** an import sends all its meetings to Claude in one Message Batches request, billed at 50% of the normal price. Settings shows "Extracting outcomes…" while it runs (usually a few minutes, up to an hour), the outcomes are saved when it ends, and the summary email goes out then. People can leave the page as before
- Same prompt and model as before, so the same quality. A meeting the batch couldn't answer is extracted the normal way. Transcripts are still never stored: each meeting is read from Google again when the results arrive
- New meetings captured automatically stay immediate. `AI_BATCH_IMPORTS=false` goes back to one meeting at a time

### Added - The morning summary prepares you for today's meetings
- **"Prepare for today's meetings":** with calendar access, the morning summary lists today's meetings (time, title, who's in it) with the open action items involving those people: yours that you share with them or that came from the last meeting with the same name, and the ones they own that you can see. "You have 3 open items with Juan, and you meet him at 11:00"
- **Calendar access is optional:** new connections are asked for `calendar.events.readonly`; people connected before see "Add calendar access" in Settings → Google Meet. Events are read when the summary is written and never stored. Without it, nothing changes
- A meeting with items to prepare is reason enough to send the summary; the subject says "N meetings to prepare"

### Added - Action items colleagues assign you: marked as new, and never twice
- **"New from a colleague":** when a colleague's meeting (or a colleague, by hand) names you as owner of an action item, Action items shows a banner ("3 new action items assigned to you by colleagues. They came from meetings captured by Martín (2), Ana (1)"), a **New** badge on each one, and the count next to Action items in the sidebar until you open it. The morning summary says it too
- **Already yours, or already done:** before it reaches you, Corteza checks whether you already have that task: from the same meeting, with the same words, or with the same meaning (OpenAI embeddings), among your items from around the meeting's date. If you have it, the copy doesn't show up again; if you had finished it, the copy is saved as done ("Already done") so the colleague doesn't chase it either. A weekly meeting's recurring task still counts as new each week
- `ACTION_DUPLICATE_SIMILARITY` tunes how alike two items must be (default 0.86). For items saved before this: `node scripts/migrations/009-review-colleague-assignments.js --apply`

### Changed - Import past meetings reaches back 7 days during the beta
- **Settings → Google Meet → Import past meetings** offers the last 7 days only (the month picker and the 30 and 90 day presets are gone). Every imported meeting is an AI extraction, and importing a month at a time was the biggest AI cost. The server refuses older periods too, and a meeting older than the limit is marked "Too old to import" without being read
- `MEET_IMPORT_MAX_DAYS` changes the limit (default 7, at most 92). Automatic capture of new meetings is unchanged

### Privacy - No meeting content or secrets in server logs
- **Search:** the server no longer logs the question, the request body or the text of the matching outcomes, only ids, scores and the question's length. Search feedback no longer logs the question either
- **Meetings and extraction:** meeting titles, uploaded file names, outcome text the AI skipped, the AI's raw reply when it can't be parsed, and outcomes edited in Slack are no longer logged (ids, types and lengths instead)
- **Secrets:** the first and last characters of the OpenAI key and a failed Slack installation (with its tokens) are no longer logged
- **Less noise:** removed the per-request workspace and session lines, and the list of every member's email when a space member is added by an unknown email

### Fixed - AI answers in the demo and in Search
- **Demo answers work again:** the demo sent `temperature`, which current models reject, so every demo question fell back to the plain text answer. It also read only the first block of the reply, which is a thinking block on current models
- **Search answers no longer get cut off:** thinking counts toward `max_tokens`, and 1000 left too little room for the answer. Now 16000, with `effort: low` on models that support it (a short chat answer)

### Privacy - No email in the early access link
- People who sign in without beta access go to `corteza.app/early-access?from=signin`, without their email in the URL (URLs end up in web analytics, server logs and browser history). The form asks for it. The server log no longer prints their email either, only the domain

### Added - Daily AI limits per person and workspace
- **Every AI call is recorded** per workspace, person and day (`ai_usage`): calls and tokens, by feature
- **Daily caps:** a person can trigger up to 150 AI calls a day, and a workspace can use up to 3M tokens a day (`AI_DAILY_CALLS_PER_USER`, `AI_DAILY_TOKENS_PER_WORKSPACE`). Over a cap, search answers, uploads and extraction say "You reached today's AI limit. It resets at midnight UTC." Imports of past meetings stop and can be re-imported the next day. Automatic capture of new meetings is never blocked
- **Upload transcript is rate limited** (20 per hour per person). It had no limit before
- Search questions are capped at 1000 characters

### Fixed - "Too many requests" while working in the app
- **API rate limit per person, not per IP:** signed-in people get 1000 API calls per 15 minutes each (Home alone makes about 10 per load, and every confirm or edit refreshes the list). Before, everyone behind the same IP shared 100, so reviewing a handful of cards blocked Home. Requests without a session keep the 100-per-IP limit, and the AI limit (20 per hour) also counts per person now

### Fixed - PDF uploads
- **Uploading a PDF transcript works again.** pdf-parse 2 changed its API (a `PDFParse` class instead of a function), so every PDF upload failed with "PDF parsing module failed to load". Found by the new type check

### Added - Type checking and dependency audit in CI
- **`npm run typecheck`:** TypeScript checks the JavaScript in `src/core`, `src/jobs`, `src/ingestion`, `src/http`, `src/integrations`, `src/auth` and `src/middleware` (and what they use) through the JSDoc types, with no build step. It runs in CI. Fixed along the way: outdated JSDoc, date arithmetic, query values used without checking they're strings, and the session's shape (`src/types/session.d.ts`)
- **Dependency audit in CI:** `npm audit --omit=dev --audit-level=high`. Updated the 8 high and 5 moderate vulnerable production dependencies (`npm audit fix`, no breaking upgrades)
- **Express is declared** in `package.json` (it came in only through Slack Bolt)

### Fixed - Adding action items by hand
- **Log manually → Action item** now asks who owns it (you by default) and when it's due, and saves it to Action items, where it can be followed up and marked done. Before, it became an outcome card with no owner or date
- **In an outcome's detail,** the "+ Add action item" button is now "Save", and closing the window with an action item typed in saves it instead of losing it

### Changed - The morning summary lists your action items
- **Your due and overdue items, by name:** "On your plate today" lists up to 5 of your own action items due today or overdue, with the meeting they came from and an **Open** button that takes you to the item in Corteza. "See all" when there are more
- **New look:** a card with a blue top band, like a task list; outcomes to review and items without a date are rows with their own button
- Only your own action items' text is included: no decisions, no colleagues' items, no transcript. The record of sent summaries keeps counts only

### Changed - The daily digest is a morning email, at 8:00 in each person's time zone
- **Morning, to plan the day:** "Good morning. Here's your day." leads with what's on your plate today (action items due today, overdue ones, outcomes to review, items without a date), then what your meetings left since yesterday (since Friday on Mondays). The button opens Action items
- **Your own time zone:** Corteza detects it from the browser when you open the app; Settings → Morning summary lets you pick another one (then it stays put when you travel). People who haven't opened Corteza yet get their team's usual time zone
- **Also sent when something is due today,** not only after new meetings
- Action items: new "Due today" filter (`/actions?due=today`); "today" and "overdue" follow your time zone
- `DAILY_DIGEST_HOUR` (local hour, default 8) and `DAILY_DIGEST_DEFAULT_TIMEZONE` replace `DAILY_DIGEST_HOUR_UTC`

### Changed - One daily email instead of one per meeting
- **Daily digest:** at the end of each weekday, each person gets one summary: how many meetings Corteza captured for them, the decisions and other outcomes in them, new action items assigned to them, and what needs attention (outcomes to review, overdue action items, items without a due date), with links straight to each list. Counts only, no meeting content. It's sent only on days with something new, and Monday's covers the weekend
- **No more email per meeting:** the capture summary after each meeting and the "set a due date" email to owners are gone; both are covered by the daily digest. The import summary (one per import) stays
- **Unsubscribe** from daily summaries with the link in the email. `DAILY_DIGEST_ENABLED=false` turns it off; `DAILY_DIGEST_HOUR_UTC` sets the hour (default 22 UTC)
- Action items: `/actions?due=overdue` (or `none`, `week`) opens the list filtered

### Security - No stored XSS through names, spaces or meeting content
- **Escaped everywhere:** space names, descriptions and icons, member names, emails, workspace names, outcome text in the chat widget and the classic table, invite results and Jira links are escaped before they reach the page. A colleague's name like `<img onerror=…>` or a space called `'); …` shows as text instead of running code
- **One escape function per script that also escapes quotes:** Home had two, and the one that won didn't escape quotes, so it wasn't safe inside attributes. Settings and Search had the same weaker version
- **Inline handlers** get their arguments through `jsArg` (JSON, then escaped), so an apostrophe in a name can't break out of `onclick="…"`
- **No Tailwind CDN:** Action items and Settings loaded Tailwind's in-browser compiler from a CDN; they now use the built stylesheet like the other pages (their extra colors moved to `tailwind.config.js`), and the CSP no longer allows third-party scripts

### Security - Every request body checked for database operators
- **One JSON parser for the whole app:** bodies are parsed once and requests carrying MongoDB operators (`{"$ne": ""}`) or `__proto__` keys are refused with a 400 before reaching any route. Uploads get the same check. Before, each route had to remember to check types
- **Editing an outcome and the demo search** read the request stream by hand; they now use the parsed body (with a 1 MB limit instead of none)
- Malformed JSON gets a JSON error instead of an HTML page

### Security - Uploaded transcripts stay with whoever uploaded them
- **Space permission:** uploading notes or approving a suggestion now checks you can post to the space, so nobody can add outcomes to a colleague's personal space
- **Your suggestions only:** approving, rejecting and listing pending suggestions only work on your own uploads. Uploading a transcript a colleague already uploaded no longer returns their suggestions
- **No query objects:** suggestion ids and space ids must be plain text; a JSON object like `{"$ne": ""}` is refused instead of matching any suggestion. Suggestion and transcript ids are random
- **Approved suggestions** are saved through the single write path: an atomic decision number (older code could reuse or collide with another space's numbers), the embedding for search, and they count as already confirmed
- Error messages no longer include internal details

### Added - Confirm or dismiss what the AI captured
- **Needs review:** outcomes Corteza captured from a meeting show ✓ Confirm and ✕ Dismiss on Home and in their detail. Confirmed ones say so; outcomes logged by hand have no review. The old "Review / Finalized" label (it only checked for a Jira link) is gone
- **Dismiss** removes the outcome, with **Undo**, and optional reasons (not relevant, nobody decided this, inaccurate, duplicate, about a person). Corteza learns from them: each person's recent dismissals and confirmations are examples in the prompt for their next meetings
- **"N to review"** next to the list filters to what's left; the capture and import emails link straight there
- **Privacy:** the extraction's examples now come only from the meeting owner's own feedback, never a colleague's
- Fixed: pressing Escape on Home threw an error (a removed "delete all" modal)

### Added - Product analytics (PostHog)
- **Events from the server** (set up with the PostHog wizard, then trimmed): sign-in, Google Meet connected, sync and import, meeting captured (with outcome counts per type) or failed, searches, action items added or updated, onboarding finished or skipped, invites, spaces, and uncaught errors
- **AI cost per user:** each Claude call is recorded with model, tokens and latency only
- **No meeting content leaves Corteza:** transcripts, outcome text, questions, answers and context are never sent. PostHog's LLM tracing (which sends prompts) and the OpenTelemetry log exporter from the wizard were removed
- **URLs without query strings:** events and errors carry the request path only, so OAuth codes (`/auth/google/callback?code=…`) and search text in a URL never reach PostHog
- Off unless `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` are set; `POSTHOG_DISABLED=1` turns it off (the extraction eval does)

### Fixed - Long meetings losing all their outcomes
- **Cut-off responses:** when Claude's answer for a long meeting hit the output limit, the whole list failed to parse and the meeting saved nothing. The complete items are now kept, and `CLAUDE_MAX_TOKENS` defaults to 32000 (was 16000)
- **Eval:** `match` keywords accept alternatives with `|` (`"one pager|una pagina"`), and a missed item captured with another type is shown as "(captured as action_item)"

### Added - First-run onboarding
- **How Corteza works:** the first time someone opens Home they see short steps: how meeting capture works (with **Connect Google Meet**, or **Import past meetings** once connected), how to ask Search (example questions that run the search), and Action items. Admins also get an optional step to add the company context. Skip, Back and Next; shown once per person (saved on the membership, so it doesn't come back on another device)
- **Sidebar → How it works** opens the steps again from any page

### Changed - Capture only business outcomes
- **Relevance rules in the extraction prompt:** meeting logistics (rescheduling, "let's continue at 15:45"), problems with the meeting or someone's equipment (audio, a computer restarting, moving files to a new laptop), personal errands and small talk are no longer saved as decisions, risks or action items. A risk has to threaten a business result, not the meeting
- **`business_relevance` label:** each extracted item is labeled high, medium or low; low ones are discarded before saving, and action items keep their link to the right decision
- **Eval:** new fixture `revision-cac-es.json` (a meeting cut short by technical problems) counts logistics and equipment items as extras

### Added - Context for the AI
- **Settings → Context for the AI:** two levels. **Your company** (what it does, a glossary of acronyms, products, customers and people, and up to 5 reference documents as TXT, MD, CSV, PDF or DOCX) is shared by the workspace and only admins can edit it. **About you** (role, focus, personal glossary) only applies to your own meetings
- **Used by the extraction:** the context goes into the prompt before the transcript, marked as background, so Claude judges what matters to the business, spells names and acronyms right and recognizes owners. It never becomes an outcome by itself. Uploaded transcripts and Slack captures get the company context
- **Eval:** fixtures can carry a `context` to measure its effect

### Fixed - Transcripts reached the AI as one long line
- **Line breaks kept:** `sanitizeTranscriptText` collapsed every newline into a space, so each speaker turn, the transcript and the Gemini notes reached the extraction as a single line (worse owner attribution), and language detection couldn't find the spoken transcript and read the Gemini notes too. Spaces are still collapsed within a line

### Added - Evaluation with real meetings
- **`scripts/eval/export-meetings.js`:** exports one person's own Google Meet meetings as eval fixtures into a folder outside the repository
- **`scripts/eval/draft-labels.js`:** Claude drafts `expected` and `not_expected` labels for review
- **Eval:** `--dir` for real meetings, `not_expected` (things that must not be captured) and noise per meeting in the report; draft labels are skipped until reviewed
- **Research:** `docs/research/extraction-quality.md` (benchmark, findings and the plan to improve extraction)

### Fixed - Colleagues in the same meeting each get its outcomes
- **Shared meetings:** when two colleagues with Google Meet connected were in the same meeting, only the first one's connection captured it and the other got nothing. Each person now captures it into their own personal space (ingestions are unique per person, not per workspace)
- **No duplicate action items:** an item you own that a colleague also captured shows once in your list (your own copy, even after you mark it done). If you didn't capture the meeting, you still see the colleague's copy
- **One due date email:** colleagues with Google Meet connected are asked for due dates by their own capture only, not once per colleague

### Security - Colleagues could see each other's meetings and data
- **Latest meetings:** Home and Settings → Google Meet listed every meeting captured in the workspace, including colleagues' meeting titles and outcome counts. Each person now sees only their own (`ingestions.user_id`). Run `scripts/migrations/008-ingestion-owners.js --apply` to keep the history of existing meetings
- **Data export:** Settings → Data Privacy → Export downloaded the whole workspace, including colleagues' personal spaces and uploaded transcripts. It now exports only outcomes in spaces you can see and transcripts you uploaded
- **Delete all data:** any member could delete the whole workspace's data. Only a workspace admin can now
- **Counts and tags:** Home stats counted colleagues' outcomes, and search suggestions offered tags from their personal spaces. Both now use only spaces you can see
- **Edit and delete:** an admin could edit or delete an outcome in a colleague's personal space by its number. Editing now also requires access to the outcome's space

### Added - Database size script
- **`scripts/db-size.js`:** shows documents, data and index size per collection, total use against the Atlas free tier's 512 MB, and how much of `decisions` is embeddings. Read-only. Run it with `railway run node scripts/db-size.js`

### Removed - API keys
- **Settings → API Keys** and the integration API (`/api/keys*`, `/api/v1/extract`, `/api/v1/decisions/:id`) are gone. They were built for an n8n / Google Drive automation that Google Meet auto-capture replaces, and they were an extra way into a workspace's data. Existing keys stop working; the n8n guide moved to `docs/archive/`

### Fixed - Home showed no outcomes for workspaces created with Google sign-in
- **Empty "Recent decisions":** the query validator only accepted legacy workspace IDs (Slack `T…`, email `W…`), so `/api/decisions` answered 400 for every workspace created with Google sign-in (`ws_…`). It now accepts `ws_…` IDs, and `/api/decisions` and `/api/stats` use the session's workspace
- **Stats across workspaces:** for those workspaces, `/api/stats` counted the outcomes of every workspace. It now always counts only the signed-in workspace's

### Added - Search answers "what's pending?"
- **Action items in Search:** ask "What's still pending from Nicolle?", "¿cuáles son mis pendientes?" or "pendientes del directorio" and the answer says who owes what and by when (overdue first). The open action items appear in their own list above the evidence sources, with a link to Action items
- **Examples:** the empty Search page now starts with "What are my open action items?" and "What's still pending from <name> before our next meeting?" (the colleague with the most open items from your meetings; hidden when there's nobody else). Heading, description and placeholder mention pending work too

### Changed - Search shows the answer and its sources, once
- **One list:** under the answer, Search showed "Intelligence Breakdown" and "Evidence Sources" side by side, listing the same outcomes twice. The breakdown is gone; Evidence Sources now uses the full width (two columns on large screens), with "Other matches not used in the answer" below

### Changed - Importing past meetings runs in the background, visibly
- **Leave the page:** the import already ran on the server. Now Settings says so while it runs, and when you come back to Settings the progress shows up again
- **Progress on Home:** while an import runs, Home shows "Importing past meetings: 5 of 20" with a progress bar, refreshed every 10 seconds, and reloads your outcomes and action items when it finishes
- **Summary email:** when the import finishes you get an email with what it captured from each meeting (and which ones couldn't be imported)

### Removed - Onboarding questions after sign-in
- **Straight to Home:** the first sign-in no longer asks for your name, role, company size, use case and how you heard of Corteza. Google gives us your name, and the early access form already asked about your company, team and meetings
- **Old links:** `/auth/onboarding` redirects to Home. The page and `POST /auth/complete-onboarding` are gone, and new memberships no longer get an `onboarding_completed` flag

### Changed - Everyone gets their own space
- **Your own space:** the first time you sign in you get a private space ("My space"). Everything you capture goes there (Google Meet, imports, Log manually). Colleagues who sign in with the same company Google account get their own and don't see your meetings. Before, captures landed in "General", which everyone in the company could see
- **No space controls while you have one space:** the header picker, "Searching in", the space pickers, the space chips on cards and Settings → Manage Spaces stay hidden until you belong to more than one space
- **Action items still reach their owners:** an action item assigned to you in a colleague's meeting shows up in your Action items, and you can update it
- **Existing workspaces:** `scripts/migrations/007-personal-spaces.js` moves outcomes out of General into each person's space. `scripts/workspace-keep-only.js <email>` leaves one person as the only member of a workspace
- **Start over:** `scripts/cleanup-all-data.js` now empties the whole app database (every collection, including accounts, Google Meet connections and action items), keeps indexes, and is a dry run unless `--apply`
- **Fixed: endless loop on Home.** Opening a space you can't read (an admin sees spaces they only manage, or you were removed from one) made Home re-select that same space forever. Home now skips spaces you can't open, falls back to your own space instead of sending you to the old "choose a space" page (removed; `/select-space` redirects to Home), and never retries a space it was denied

### Fixed - One sidebar on every page
- **What was wrong:** Home, Action items, Search and Settings each had their own copy of the sidebar, with a different logo, spacing, icons and order. An old style also hid the icons on Home and Search
- **Now:** one sidebar (`src/views/partials/sidebar.html`) is injected into every page, and only the current page's link changes. The logo, spacing and order are the same everywhere, every link has its icon, and **Log manually** and **Log out** sit together at the bottom

### Added - Private beta: approve testers from the signup email
- **Who can create a workspace:** with `BETA_REQUIRED=true`, Google sign-in only creates a new workspace for approved people (an email, or a whole Google domain). Anyone else goes to the early access form with their email filled in, and nothing is saved for them. Existing members, invited people and colleagues joining their company's workspace sign in as before
- **Approve from the email:** the team's "new early access request" email has an **Approve** link (signed with `BETA_APPROVAL_SECRET`). It opens a confirmation page; approving sends the tester a welcome email inviting them to sign in with Google
- **Script:** `node scripts/beta-approve.js <email|domain> [--welcome]` approves without the link (for signups from before the link existed, or a whole company); `--list` shows who's approved

### Removed - Analytics page
- **Page gone:** the AI Analytics page (`/ai-analytics`) and its API (`GET /api/ai-analytics`, about 600 lines of aggregations) are removed, along with the sidebar links
- **Unused indexes:** the three database indexes that only served it (creator, channel, tags) are no longer created. Existing ones aren't dropped
- **Later:** decision-health analytics come back later as roadmap item C4

### Fixed - Outcomes are saved in the meeting's language
- **Why they came out in English:** a meeting held in Spanish could be saved in English. Gemini notes come in the Google account's language, and the extraction prompt didn't say which language to write in
- **What changes:** Corteza now detects the language spoken in the transcript, not the notes. It tells Claude to write the text, why and tags in that language; evidence quotes stay verbatim
- **New setting:** Settings → Google Meet → **Write outcomes in** fixes the language for every capture: the language spoken in each meeting (default), Español, English or Português
- **Existing outcomes:** `scripts/migrations/006-translate-outcomes.js --workspace <id> --to es` rewrites them (text, why, tags and action items) in one language. It's a dry run unless you pass `--apply`

### Fixed - Search found nothing when the question and the outcomes were in different languages
- **Cross-language questions:** keyword search can't connect "directorio de octubre" with "Board meeting on October 22", so a Spanish question about English outcomes found nothing when semantic search was unavailable. With fewer than 3 matches, Claude now also reads the space's 60 latest outcomes and picks the ones that answer. Only those are shown as sources; the rest stay hidden
- **Generic verbs ignored:** words like "tengo", "hacer", "debemos" and "necesito" no longer count as keywords

### Changed - Search: fewer, better sources; open a source in full; leave unrelated ones out
- **The answer works again:** search answers were falling back to a canned list ("Looking at our decisions about…") because the Claude call sent a temperature the current model rejects. Claude now answers in the question's language, and only from sources that help answer it
- **Sources used vs. other matches:** Claude says which sources it used, and only those appear under Evidence Sources. The rest are under "Other matches not used in the answer". The header reads "Based on N sources"
- **Fewer, closer matches:**
  - Keyword search ignores Spanish and English filler words ("que", "hemos", "con", "cara"…) and accents, and matches whole words ("con" no longer matches "confirm")
  - A source must contain about half of the question's keywords
  - Search asks for 8 sources instead of 20
  - Results never include embeddings
- **Open a source in full:** clicking a source opens the full outcome without leaving Search: content, why, action items, accountable person and meeting context. Home and Search now share the same detail modal
- **"Is this related?":** each source asks whether it's related to the question. "No, not related" lets you **update the answer without it**, from the source or from a banner under the answer. The vote is saved (`search_feedback`) to tune search
- **Security:** search takes the workspace from the session, not from the request body

### Changed - Decisions have someone "Accountable"; dates live in action items
- **Accountable:** a decision's "Owner" is now **Accountable**, the person who makes sure it gets done. A short note says that tasks and their owners go in Action items. Cards read "Accountable: Ana"
- **No due dates on decisions:** a decision no longer has a due date you can add. Older captures that have one show it read-only as "Due (older capture)"
- **Capture:** decisions, open questions and risks are saved without a due date
  - If the AI gave one a date and there's no linked action item, a linked action item is created with that owner and date
  - Without a date, the owner is kept as the accountable person

### Added - Add action items to a decision by hand
- **"+ Add action item" in a decision's detail:** write what needs to be done, pick one or more owners from the workspace members and add an optional due date. The item is linked to the decision and appears in Action items and in each owner's "My action items" on Home
- **Who can add:** anyone who can add decisions to the decision's space
- **Decision owner:** now picked from the workspace members (saved as `owner_user_id` + `owner_name`). A name the AI heard that isn't a member stays until you pick someone
- **API:**
  - `POST /api/action-items` takes `{ decision_id, text, owner_user_ids, due_date }`
  - `GET /api/people` lists the workspace members to pick from
  - `PUT /api/decisions/:id` accepts `owner_user_id`

### Added - Edit outcomes in place
- **Click to edit:** in an outcome's detail, click a field to edit it right there. Editable fields are the content, why, type, owner, due date, tags, meeting context and Jira epic. Enter saves (Ctrl/⌘+Enter in multi-line fields), and so does clicking away. Esc cancels
- **Empty fields:** empty fields you can edit show "+ Add why", "+ Add owner", "+ Add due date" and "+ Add tags"
- **Permissions:** only the author or an admin can edit, as with the Edit button. For everyone else the detail stays read-only. The Edit button still opens the full form (space, category)
- **API:** `PUT /api/decisions/:id` also accepts `rationale`, `owner_name` and `due_date` (YYYY-MM-DD, or null to clear), and returns the saved values

### Changed - "Outcomes" is the umbrella term
- **Outcomes, not decisions:** everything Corteza captures from a meeting is now an *outcome*. A decision is one type, next to action items, open questions and risks. "Decisions" now means only decisions
- **Counts by type:** Home, Settings and the capture email say "11 decisions, 2 open questions and 4 action items" instead of counting everything as decisions. Ingestions, import jobs and Google connections store `outcomes_by_type`. Data from before this change shows as "N outcomes"
- **Home:**
  - The list shows **Recent decisions** by default. "All outcomes" and the other types are in the filter
  - A new **Open questions & risks** panel sits under My action items. Clicking an item opens it
- **Capture email:** grouped under Decisions, Open questions, Risks and Action items. The subject reads e.g. "3 decisions and 2 action items captured from …"
- **API:** `GET /api/decisions?type=open_question,risk` accepts several types

### Changed - Home puts automatic capture first
- **"Executive Dashboard" removed:** the Home page now opens with Google Meet capture instead of manual logging
- **Not connected:** a "Capture decisions automatically" card explains the 3 steps and links to Connect Google Meet
- **Connected:** the Home shows:
  - capture status (account, last check, totals)
  - a reconnect warning when access stopped working or Gemini notes need re-consent
  - "Check now" and "Import past meetings"
  - the latest meetings and what came out of each
- **My action items** on Home: open, overdue and undated counts, plus the first few items
- **Manual capture moved down:** "Log manually" and "Upload transcript" are small buttons next to Recent Decisions. The sidebar "New Decision" is now a secondary "Log manually". From other pages it opens `/dashboard?log=1`
- **Fix:** a decision card with an owner no longer overlaps the owner line and the meeting line

### Performance - Faster Home and Search
- **Smaller decision lists:** decision lists no longer include `embedding` vectors. Each vector is about 1,500 numbers per decision, so about 50 decisions came to more than 1 MB, re-downloaded every 30 seconds
- **One fewer round trip on load:** Home and Search come with the user and their spaces preloaded. The page shows as soon as decisions arrive, and stats no longer block it
- **Fewer queries for spaces:** `GET /api/spaces` uses a fixed number of queries (one aggregate for counts, one for memberships) instead of 2 per space
- **Assets:** gzip compression. Static files are served before the session middleware, so each asset no longer reads the session from MongoDB, and are cached for 10 minutes
- **Slack lookups:** installation lookups are cached per workspace, and the cache is cleared on install or uninstall

### Added - Action items ("pendientes") with owners and due dates (roadmap B1/B2)
- **Separate from decisions:** action items live in a new `action_items` collection with several owners, a due date and a status (open, done, cancelled). Each is linked to the decision it carries out, for example "Se decide comenzar la investigación" → "Investigación técnica", owned by Martín and Felipe
- **Owners are real people:** names spoken in the meeting are matched to workspace members, ignoring accents; unmatched names are kept
- **Action items page (`/actions`):** filter by mine or everyone, status, overdue, due this week or no due date; mark items done and set dates inline. The decision detail lists its action items
- **"When will this be done?" email:** when an action item from a recent meeting has no due date, its owners get one email per meeting with a link to set the date
- Capture emails and import progress count action items
- Extraction returns `owner_names` (a list) and `decision_ref`
- Migration `005-move-action-items.js` moves action items that were briefly saved as decisions

### Changed - Extraction v2 (roadmap A2)
- **New item types:** meetings now yield `decision`, `action_item`, `open_question` and `risk`. Background explanations and "context" are no longer captured as decisions
- **Richer items:** each item carries `owner_name`, `due_date` (relative dates resolved from the meeting date), `rationale`, a verbatim `evidence_quote` and `supersedes_hint`. The dashboard shows the owner and due date
- **Model:** the default is `claude-sonnet-5` for the pilot period (about $0.06 per 1-hour meeting). Override it with `CLAUDE_MODEL`, and compare models with the eval first
  - Responses are streamed
  - Temperature is only sent to older models that still accept it
  - Refusals are detected, and server-side refusal fallbacks are enabled for models that support them
  - `CLAUDE_MAX_TOKENS` now defaults to 16000
- **Decisions read as outcomes:** "Se decide comenzar…", not "Se propuso…". The `rationale` captures the context from the whole meeting that led to each item, such as a strategy presented earlier. The decision detail view shows **Why**, **Owner** and **Due**, and its title names the type ("Context #92")
- **Extraction eval:** `node scripts/eval-extraction.js` scores the extraction on labeled transcripts in `test/fixtures/extraction/` (precision and recall per type, owner and due-date accuracy)
- Decision types now live in one place, `src/core/decisions/types.js`, used by API validation, filters and the decision service
- Added `docs/ROADMAP.md` (the approved plan to reach paying customers) and `docs/launch/google-verification.md`

### Fixed - Meeting decisions are dated by the meeting
- Decisions captured from a meeting get the meeting's date (`timestamp`), not the date Corteza processed it. This matters for imports of past meetings, and for search date filters and the weekly digest. `created_at` keeps the save time
- `createDecision` takes an optional `decidedAt`
- Migration `004-date-meeting-decisions.js` re-dates decisions captured before this fix

### Changed - Gemini notes and import messages
- **Gemini notes can be read:** Google Meet connect now also asks for Drive read access (`drive.readonly`), because `drive.meet.readonly` doesn't cover Gemini notes Docs. Existing connections see a "Reconnect" prompt in Settings
- **Import messages are plain language** ("Google doesn’t let Corteza read this meeting’s Gemini notes."); Google's technical reason and extraction errors are logged server-side only
- Drive export errors are logged as one readable line instead of raw JSON

### Fixed - Google Meet access errors
- A meeting whose transcript or notes Google refuses no longer blocks automatic capture of the user's other meetings
- Meetings are captured from whichever source is readable (transcript, transcript Doc, or Gemini notes)
- Import errors now say what Google refused and why, and show the meeting title; the reason is also logged
- Titles like "1:1 Ana / Bob: 2026/09/01 15:30 GMT-03:00" are cleaned to "1:1 Ana / Bob"

### Added - Import past Google Meet meetings
- **Settings → Google Meet → Import past meetings:** pick a month or date range (up to 92 days, with presets), see every meeting in that period with participants, whether a transcript or Gemini notes exist, and whether it was already imported
- **Choose what to import:** tick meetings (or "Select all available"), choose the space, and import up to 50 at a time. Runs in the background with a progress bar and per-meeting results
- **Manual imports override the automatic skip rules** (1:1s, title keywords); completed meetings are never imported twice; interrupted imports resume automatically
- New `ingestion/meet-import.js`, `meet_imports` collection, Meet client range listing and a lightweight `describeMeeting`

### Added - Automatic decision capture from Google Meet
- **Settings → Google Meet → Connect.** Separate consent for `meetings.space.readonly` and `drive.meet.readonly` with offline access. The refresh token is stored encrypted in `google_connections`, and the connected account must match the signed-in user
- **Poller** (`jobs/meet-poller.js`, every 5 min): finds meetings that ended, reads transcripts (speaker-labelled) and Gemini notes, and saves every extracted decision automatically, marked AI-captured with confidence, meeting title and a link to the transcript/notes
- **Privacy defaults:** 1:1 meetings skipped, title keyword exclusions, choice of destination space
- **Reliability:** each meeting is processed once (`ingestions`, unique per meeting) even with several connected participants; late transcripts retried for 6h; failed extractions retried up to 3 times; revoked Google access shown in Settings with a Reconnect link
- **Summary email** to the connected user with the captured decisions; "Check for new meetings now" button; recent meetings list in Settings
- **Dashboard:** "✨ AI-captured" badge and "Google Meet: <meeting>" link on decision cards
- **New modules:** `core/decisions/decision-service.js` (single write path with atomic per-workspace ids, `counters`), `ingestion/pipeline.js`, `ingestion/sources/google-meet.js`, `integrations/google/{connections,meet-client,routes}.js`
- **Docs:** `docs/integrations/google-meet.md`

### Added - Sign in with Google
- **Google is the only way to sign in.** "Continue with Google" on `/auth/login` (OpenID Connect with state, nonce and ID-token verification; the session ID is regenerated on login)
- **Domain workspaces:** a company's Google Workspace domain (the `hd` claim) is its Corteza workspace. The first person creates it and becomes admin; colleagues on the same domain join automatically. Consumer accounts (gmail.com) get a personal workspace
- **Existing users are linked by email.** An admin of an existing workspace claims their Google domain on first sign-in. `scripts/migrations/002-link-workspace-to-google.js` links workspaces created through Slack or magic links
- **Invites** go through Google (`/auth/google?invite=<id>`); invites addressed to an email only work for that Google account
- New `workspaces` and `users` collections; new code in `src/auth`, `src/core/{workspaces,users,invites}` and `src/integrations/google`
- Chrome extension 1.1.0: "Sign in with Google" replaces the email login form

### Removed
- Magic-link email login, passwords (login, reset, Settings "change password", invite sign-up), Slack `/login` sign-in (the command now links to the web sign-in), one-time login tokens, and the `bcrypt` dependency

### Fixed
- Completing onboarding overwrote the member's workspace `role` (admin/member) with the job title from the form. The job title is now stored as `role_title`; `scripts/migrations/003-repair-member-roles.js` repairs affected members
- The dashboard's admin flag (`/auth/me`) and admin-only settings endpoints only checked Slack admin status, so admins of workspaces without Slack were never treated as admins. They now check `workspace_admins` first

### 🔒 Security
- Magic links can no longer be used to join an existing workspace. Anyone could type another team's workspace name and get admin access; now joining an existing workspace needs an invite. Slack `/login` users join as members, not admins
- One-time login tokens are stored hashed in MongoDB (`login_tokens`, auto-expiring) instead of in memory, so they survive restarts and work across instances. Password-reset links can no longer be used to log in
- `GET /api/spaces` only lists spaces of the caller's own workspace
- Removed the committed extension signing key and build files; `*.pem`/`*.crx` are now gitignored

### Fixed
- Logging a decision failed with "No space selected" when a workspace had no spaces. Every workspace now gets a default "General" space automatically
- Decisions from Slack (`/decision`, AI approvals) were saved without a space and never showed in the dashboard. They now go to the default space; `scripts/migrations/001-backfill-default-spaces.js` fixes existing ones
- Admins could pick private spaces they can't post to. The Log Decision form now has a space picker listing only writable spaces (`can_create`, `?writable=true`), also used by the extension
- Password login crashed when a member had no `workspace_name`
- AI analytics queries for epics and rejection reasons ignored the `null` check (duplicate `$ne` keys)

### Removed
- Obsidian plugin, Obsidian import (`/api/v1/import/obsidian*`) and export (`/api/export/obsidian`), and the `archiver` dependency
- Old dashboard/settings pages (`/dashboard-old`, `/settings-old`, backups, minimal dashboard), `index.js.old/.backup`, one-off root scripts, unmounted test-login routes

### Changed
- Outdated docs moved to `docs/archive/`; new `CLAUDE.md` and `docs/ARCHITECTURE.md` describe the current system and the Google Workspace refocus plan
- Added `npm test` (node:test), `npm run lint` (ESLint) and GitHub Actions CI with a MongoDB service; `package-lock.json` regenerated so `npm ci` works
- `/api/extract-decisions` now only runs against the caller's own workspace, so another workspace's approved/rejected examples can no longer be pulled into the AI prompt
- Approving or rejecting an AI suggestion from the dashboard now checks that it belongs to the caller's workspace

### Added - Google Drive transcript import (Phase 0)
- `POST /api/v1/extract`: API-key endpoint for automations (e.g. Google Drive → n8n). Extracted decisions are saved as pending suggestions in the target space (or the workspace's default space)
- Dashboard banner listing pending AI suggestions for the current space, with review/approve/reject (`GET /api/ai/pending-suggestions`)
- File upload accepts `.md` and `.vtt`/`.srt` caption files (Google Meet, Zoom and Teams transcripts)

### Changed
- `docs/integrations/n8n-google-drive.md` (was `N8N_AUTOMATIONS_GUIDE.md`): Drive workflow now uses an API key instead of a copied session cookie, and exports Google Docs as text
- `docs/n8n-email-setup.md` marked deprecated (emails are sent via Resend)
- Upload no longer offers legacy `.doc`, which the parser never supported

---

## [0.4.0] - 2026-05-23

### 🎉 Added - Spaces System

**Major Feature: Organize decisions by team, project, or privacy level**

**New Features:**
- **Spaces within Workspaces:** Create unlimited spaces to organize decisions
- **3 Visibility Levels:**
  - 🌍 **Public** - All workspace members can view and contribute
  - 👥 **Shared** - Only invited members can access
  - 🔒 **Private** - Personal space for sensitive decisions
- **Granular Permissions:** Owner, Admin, Member, Viewer roles per space
- **Direct Space Invitations:** Invite people directly to spaces via email
- **Space-Aware Search:** Semantic search respects space permissions
- **Visual Indicators:** Color-coded badges, icons, privacy indicators
- **Default Spaces:** Backward compatible - existing decisions auto-migrated to "General" space

**Technical:**
- New collections: `workspace_spaces`, `space_members`
- Updated collections: `decisions` (added space_id, space_name)
- New API endpoints: `/api/spaces/*` for space management
- Enhanced permission system with workspace + space levels
- Migration script for existing workspaces

### 🌐 Added - Chrome Extension Space Integration

**Extension Now Supports Spaces:**
- **Visual Context Bar:** Purple gradient showing workspace and current space
- **Space Selector:** Dropdown with all accessible spaces
- **Space Icons:** Custom icons and privacy indicators (🔒)
- **Persistent Selection:** Remembers last selected space
- **Empty State:** Guidance when no spaces exist

**Technical:**
- Added `storage` permission to manifest.json
- Implemented `/api/spaces` endpoint integration
- Chrome storage API for space persistence
- Defensive error handling and null checks

### 🔧 Improved - Onboarding & Invitations

**Streamlined User Experience:**
- **One-Step Invitations:** Invite directly to spaces (no two-step process)
- **Eliminated Duplicate Onboarding:** Users only enter details once
- **Inline Space Creation:** Add members immediately after creating space
- **Enhanced Member Display:** Show names and emails instead of user IDs
- **Auto-Membership:** Invited users auto-added to both workspace and space

### 🐛 Fixed

**PDF Upload:**
- Fixed "pdfParse is not a function" error (pdf-parse v2.4.5 compatibility)
- Handle both CommonJS and ES module exports

**Chrome Extension:**
- Fixed "Cannot read properties of undefined (reading 'local')" - added storage permission
- Fixed "Open Dashboard" button not working - proper event listener
- Fixed event listener errors on null elements - defensive null checks

**Space Management:**
- Fixed admins unable to view space members - use `canModifySpace()` permission
- Fixed members showing as user IDs - enrich with workspace_members data
- Fixed duplicate onboarding for invited users - set onboarding_completed: true
- Fixed auto-membership for private spaces - creators must explicitly join

**Permissions:**
- Workspace admins can manage all spaces (even if not members)
- Space creators don't auto-join private spaces (true privacy)
- Clear permission hierarchy: workspace admins > space owners > admins > members

### 📚 Documentation

**New Files:**
- **RECENT_UPDATES.md** - Comprehensive list of all recent changes
- **SPACES_DEPLOYMENT.md** - Technical implementation guide

**Updated Files:**
- **README.md** - Added spaces section, updated features
- **browser-extension/README.md** - Added space selection guide
- **CHANGELOG.md** - This file

### 🔄 Database Changes

**New Collections:**
```javascript
workspace_spaces: {
  space_id, workspace_id, name, description,
  visibility, created_by, is_default, archived, settings
}

space_members: {
  membership_id, workspace_id, space_id,
  user_id, role, added_by, removed_at
}
```

**Updated Collections:**
```javascript
decisions: {
  // NEW fields
  space_id: "sp_abc123xyz",
  space_name: "Engineering Team"
}

workspace_invites: {
  // NEW fields
  space_id: "sp_abc123xyz",
  space_role: "member"
}
```

### 🚀 Migration

**Automatic Migration:**
- All existing decisions moved to default "General" space (public)
- Workspace owners assigned as space owners
- No action required from users
- Zero downtime migration

---

## [0.3.0] - 2026-01-21

### 🎉 Added - Role-Based Permission System

**New Features:**
- **Admin/Non-Admin Roles:** Simple 2-tier permission system
- **Auto-Promotion:** Slack Workspace Admins automatically become app Admins
- **Permission Management:** New `/permissions` command
  - `/permissions list` - View all workspace admins
  - `/permissions grant @user` - Promote users to admin
  - `/permissions revoke @user` - Demote admins
- **Permission Enforcement:**
  - Admins can edit/delete ANY decision
  - Non-admins can only edit/delete THEIR OWN decisions
  - Dashboard UI reflects permissions (hides buttons appropriately)
  - Settings access restricted to admins only

**Technical:**
- New `workspace_admins` collection in MongoDB
- Permission checks in API endpoints (edit/delete)
- Frontend permission enforcement in dashboard
- Audit trail for permission changes

### 🔒 Added - Per-Workspace Jira Configuration

**New Features:**
- **`/settings` Command:** Admins can configure Jira per-workspace
- **Encrypted Storage:** Jira API tokens encrypted with AES-256-GCM
- **Connection Testing:** Test Jira credentials before saving
- **Workspace Isolation:** Each workspace has its own Jira config
- **No Global Config:** Removed global Jira environment variables

**Technical:**
- New `workspace_settings` collection in MongoDB
- Encryption utilities for sensitive data
- Admin-only access to settings endpoints
- Graceful fallback for migration

### 🛠️ Changed

**Commands:**
- **`/decision`** and **`/memory`** now support category field (product/ux/technical)
- **`/login`** command added for easy dashboard access
- All slash commands now verify workspace membership

**Environment Variables:**
- Added `ENCRYPTION_KEY` (required for Jira token encryption)
- Added `SESSION_SECRET` (required for cookie security)
- Added `SLACK_STATE_SECRET` (required for OAuth CSRF protection)
- Removed global `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (now per-workspace)

**Dashboard:**
- Edit/Delete buttons now respect user permissions
- "Read-only" label shown for decisions user can't modify
- Edit modal hidden for non-modifiable decisions

### 📚 Improved

**Documentation:**
- New **[BETA_TESTER_GUIDE.md](BETA_TESTER_GUIDE.md)** for users (install & use in 10 min)
- New **[SELF_HOSTING_GUIDE.md](SELF_HOSTING_GUIDE.md)** for self-hosting (deploy in 45-60 min)
- New **[CHANGELOG.md](CHANGELOG.md)** for version history
- Updated README with latest features
- Clearer step-by-step instructions
- Troubleshooting section expanded
- Added permission system documentation

**Security:**
- Jira tokens encrypted at rest
- Admin-only access to sensitive operations
- Session secrets required for production
- Enhanced input validation

---

## [0.2.0] - 2026-01-15

### 🎨 Added - Modern Dashboard Design

**UI Improvements:**
- Modern gradient backgrounds
- Bold, animated stat cards
- Glassmorphism effects
- Hero banner with workspace info
- Improved mobile responsiveness

### ⚡ Improved - Claude API Optimization

**Performance:**
- Reduced token usage by 40%
- Implemented few-shot learning with workspace examples
- Added caching for repeated requests
- Optimized prompt engineering

**Cost Savings:**
- Average cost per decision reduced from $0.05 to $0.03
- Better context management
- Smarter semantic search queries

---

## [0.1.0] - 2025-12-20

### 🎉 Initial Beta Release

**Core Features:**
- Slack slash commands (`/decision`, `/decisions`)
- AI-powered transcript extraction with Claude
- MongoDB Atlas storage
- Basic web dashboard
- Semantic search with OpenAI embeddings
- Multi-workspace OAuth support
- GDPR compliance (export/delete)

**Integrations:**
- Slack Bot with OAuth
- MongoDB Atlas with vector search
- Anthropic Claude API
- OpenAI Embeddings API
- Jira API (global config)

---

## Migration Guide

### From 0.2.0 to 0.3.0

**Required Actions:**

1. **Add New Environment Variables to Railway:**
   ```bash
   ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   SESSION_SECRET=<generate if not set>
   SLACK_STATE_SECRET=<generate if not set>
   ```

2. **Add New Slash Commands to Slack App:**
   - `/settings` - Configure Jira (admins only)
   - `/permissions` - Manage permissions (admins only)
   - `/login` - Get dashboard login link

3. **Add New Bot Scope:**
   - Go to Slack App → OAuth & Permissions
   - Add scope: `users:read.email`
   - Reinstall app to workspace

4. **Migrate Jira Configuration (if using):**
   - If you had global Jira config, you can now remove those env vars
   - Have workspace admins run `/settings` to configure Jira per-workspace
   - Old global config will be used as fallback during transition

**Optional Actions:**

1. **Grant Admin Access:**
   - Slack Workspace Admins are auto-promoted
   - Use `/permissions grant @user` to promote others

2. **Test Permissions:**
   - Log in as non-admin user
   - Verify they can't edit others' decisions
   - Verify admins can edit any decision

**Breaking Changes:**
- None - all changes are backward compatible
- Global Jira config still works but is deprecated in favor of per-workspace config

---

## Upcoming Features

### In Development 🚧
- [ ] Decision templates
- [ ] Bulk import from Slack history
- [ ] Enhanced analytics dashboard
- [ ] Decision reversal tracking
- [ ] Viewer role (read-only access)

### Under Consideration 💭
- [ ] Passive decision detection (monitor channels)
- [ ] Integration triggers (Jira, GitHub)
- [ ] Decision impact tracking
- [ ] Team alignment scores
- [ ] Notion integration

---

## Support

**Questions or Issues?**
- 📖 [Beta Setup Guide](BETA_SETUP_GUIDE.md)
- 🐛 [Report Issues](https://github.com/cristiantumani/corteza.app/issues)
- 📧 Email: cristiantumani@gmail.com

**Feedback:**
We're actively improving based on beta tester feedback. Please share:
- What features do you love?
- What's confusing or broken?
- What would make this more useful for your team?

---

Made with ❤️ for teams who learn from their decisions
