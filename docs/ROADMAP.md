# Roadmap: from capture to follow-through

> Approved plan (Sept 2026) to take Corteza to paying customers. Status of each item is tracked in `CHANGELOG.md`. The Google verification checklist (A1) is in `docs/launch/google-verification.md`.

## Context

**Milestone reached (Sept 2026).** Google sign-in, automatic Meet capture (transcripts and Gemini notes) and "Import past meetings" all work end to end. The first real import turned 4 meetings into 43 decisions.

**The goal now:** turn Corteza from a *log* of decisions into the tool that makes decisions **stick** (follow-up) and makes the next decision **better and faster**. Then get it into customers' hands.

**What the product is missing today.** These gaps come from reading the code:

- **Extraction is shallow.**
  - `src/services/claude.js` extracts only `decision | explanation | context`, plus text, tags and confidence.
  - There is **no owner, no due date, no rationale, no evidence quote, and no action items**. "Explanation" and "context" are noise for most buyers.
  - The model is `claude-sonnet-4-5-20250929` (`src/config/environment.js:108`).
- **There's no lifecycle.** The "Review / Finalized" badge is fake: `getStatusInfo()` in `public/scripts/dashboard-new.js` only checks whether a Jira link exists. Nothing tracks whether a decision was carried out, changed or reversed.
- **Nothing connects meetings.** Each meeting is extracted on its own, so repeated or contradicting decisions go unnoticed.
- **Nothing pushes to people.** The only outreach is the weekly digest (`src/jobs/weekly-digest.js`) and a capture-summary email. There are no reminders, no pre-meeting context, and no Chat or Calendar presence.
- **We can't sell it yet.**
  - Our Google scopes are **restricted** (`drive.readonly`, `drive.meet.readonly`, `meetings.space.readonly`). The OAuth app is in Testing mode, capped at 100 listed test users.
  - There's no billing.
  - The app won't boot without Slack env vars.
  - There's no error monitoring or AI-cost guard. We already ran out of Anthropic credit once.
- **Privacy strength to keep:** we don't store transcripts. The `ingestions` collection keeps only the title, status and counts.

## Market scan: what others do, and the gap

| Category | Examples | What they do | Limitation |
|---|---|---|---|
| AI note-takers | Fellow ($7/$15/$25 per user/mo), Fireflies, Read.ai, Otter, tl;dv, Granola | They join calls with a bot and write a per-meeting recap with a "decisions" section and action items. They push tasks to Jira, Notion or Linear. Fellow sends recaps before recurring meetings and tracks action-item completion rates. | Decisions are one section of a recap that nobody reopens. There's no view of decisions across meetings, and no check that a decision was carried out. |
| Google itself | Gemini "Take notes for me" | Free inside Workspace. It writes a notes Doc with a summary and "Next steps", and now covers in-person meetings too (Aug 2026). | Next steps stay in a Doc and are moved to tasks by hand. There's no memory across meetings. |
| Decision logs | Loqbooq ($2.99 per user/mo), Decisions for Microsoft Teams ($8/$15/$29), monday/Notion templates | Manual entry, approvals, audit trail. | Someone has to log every decision. Adoption dies after a few weeks. |
| Decision intelligence | Cloverpop (enterprise), Reflect OS (£27 per user/mo) | Structured decision records, outcome reviews at 30, 90 and 180 days, and confidence calibration. | Heavy process, executive or enterprise buyers, all manual. |

Industry sources claim that about 44% of meeting action items are never completed. The usual causes are no owner, no deadline, and no system that brings forgotten items back up.

**The gap Corteza can own:**
> *Gemini takes the notes. Corteza makes sure decisions stick.*

Corteza would be the memory and follow-through layer for Google Workspace teams:
- **Zero effort:** no bot joins calls and nobody logs anything by hand. It reuses the Meet and Gemini output customers already have.
- **A living record:** decisions and their commitments are tracked across meetings. Corteza notices progress, reversals and repeated debates, and nudges the owners.
- **Outcomes:** reviews check whether each decision worked, so the next decision is better and faster.

The note-takers stop at the recap. The decision tools need manual entry. Nobody closes the loop automatically.

**Product principles for everything below:**
1. **No extra work.** Capture and updates happen automatically. People only confirm or correct.
2. **Evidence for every AI claim.** Every item shows a quote and a link to the meeting. This is what builds trust in auto-saved data.
3. **Go to where people already are:** Gmail, Calendar, Google Chat and the Meet side panel. The dashboard is for review.
4. **Google-native and privacy-first.** No transcript storage, and data stays inside the customer's workspace.

## Roadmap

### Phase A: Ready to sell (about 4 weeks, starts now)

A1. **Google verification.** This is the critical path, so it starts on day 1.
- Reduce scopes where possible. Check whether `drive.readonly` can be dropped for Gemini notes: the Meet API `smartNotes` resource may become readable through `drive.meet.readonly`. Keep the rest.
- Submit restricted-scope verification: brand verification, a demo video, and the privacy policy.
- Do the **CASA Tier 2** security assessment: roughly $500–1,000, 6–12 weeks, and renewed every year.
  - **Deferred (budget decision, Sept 2026):** pay for CASA only once there is revenue or funding, or when we need more than the 100 test users that Testing mode allows. Until then, do the free steps (brand verification, privacy policy, demo video) and run pilots with test users.
- **Pilot path while verification runs:** the pilot customer's Workspace admin marks Corteza as a **trusted app** under Admin console → Security → API controls. That lets their users connect before we're verified. We confirm this works with Ninja Excel first.
- Write a privacy policy and a DPA, and add a data-retention setting.

A2. **Extraction v2.** Quality is the product.
- **Model:** default to `claude-sonnet-5` for the pilot period, for cost. Re-evaluate `claude-opus-5-5` with the eval once there are paying customers.
- **New schema:** `decision | action_item | open_question | risk`, with these fields:
  - `owner_name`
  - `due_date`
  - `rationale`
  - `evidence_quote`
  - `confidence`
  - `supersedes_hint`
- **Explanation and context stop being decisions.** They become the meeting's summary context.
- **Stricter rules:** only explicit commitments count. Near-duplicates inside one meeting are merged. Keep the few-shot feedback loop (`getApprovedExamples` / `getRejectedExamples`).
- **Evaluation harness** (`scripts/eval-extraction.js`) run on a small labeled set of real transcripts, used with consent. It measures precision and recall per type and runs before any prompt change.
- **Files:**
  - `src/services/claude.js`
  - `src/ingestion/pipeline.js`
  - `src/core/decisions/decision-service.js` (`VALID_TYPES`, new fields)

A3. **Real decision lifecycle.**
- Statuses: `proposed` (low confidence) → `active` → `done` / `superseded` / `reversed` / `dismissed`.
- Stored in `createDecision`, with a status history kept on the decision.
- One-click **Confirm / Edit / Dismiss** in the dashboard and in the capture email. A dismissal feeds the rejected examples used for learning.
- This replaces the fake `getStatusInfo()`.

A4. **Onboarding in under 5 minutes.**
- First-run wizard: Google sign-in → Connect Meet → "Import the last 30 days" (reuses `src/ingestion/meet-import.js`) → first decisions shown with evidence.
- Remove the Slack requirement at boot: make `SLACK_*` optional in `src/config/environment.js` and mount Bolt only when it's configured. This was Phase 1 of the old plan.
- Remove leftovers such as the `/test` route.

A5. **Billing.**
- Stripe, billed per workspace per seat, with a 14-day trial.
- Pricing hypothesis:
  - **Free:** up to 5 users, 20 meetings a month.
  - **Team:** about $10 per user per month.
  - **Business:** about $18 per user per month, adding analytics, admin install and outcome reviews.
- Benchmarks: Fellow $7/$15, Decisions $8/$15.
- New module: `src/integrations/stripe/`.

A6. **Operations.**
- Error monitoring (Sentry).
- AI usage and cost per workspace, with a monthly cap per plan.
- Alerts for low Anthropic credit and for failed ingestions.
- Database backups.
- A status line in Settings.

### Phase B: Follow-through, the core differentiator (about 5 weeks)

B1. **Action items linked to decisions.**
- New `action_items` collection in `src/core/actions/`: `{decision_id, text, owner_user_id, due_at, status, evidence, source}`.
- Each decision shows its follow-ups.

B2. **Owner resolution.**
- Match the Meet participant display name (`participantName` in `src/ingestion/sources/google-meet.js`) and the extracted `owner_name` to workspace members.
- Unmatched items stay unassigned, and a one-click "assign" is available.

B3. **Nudges.**
- **Personal email "Your open commitments":** sent weekly, plus due-date reminders. Uses the Resend helpers in `src/utils/n8n-client.js` and a new `src/jobs/followups.js`.
- **Stale alert:** fires when there's no mention and no update for N days.
- **Google Chat app** (phase B, second half): DMs with Done / Snooze / Reassign buttons.

B4. **Automatic progress detection. This is the moat.**
- When a new meeting is ingested, Corteza finds the open decisions and actions that may relate to it, using embeddings (`src/services/embeddings.js`).
- Claude then judges each one: *progress*, *done*, *reversed*, *conflict* or *unrelated*, with an evidence quote.
- It updates the status or asks the owner to confirm.
- New module: `src/ingestion/linker.js`, called at the end of `ingestTranscript`.

B5. **Pre-meeting brief.**
- Scope `calendar.events.readonly` (sensitive, not restricted).
- For recurring events, 30 minutes before start, send an email or Chat message:
  - "Last time you decided…"
  - open items with owner and due date
  - decisions due for review
- New files: `src/integrations/google/calendar-client.js` and `src/jobs/meeting-briefs.js`.

B6. **Push to where work lives.**
- Google Tasks (`tasks` scope).
- Existing Jira (`src/services/jira.js`).
- Later: Asana and Linear.

### Phase C: Better, faster decisions (about 6 weeks)

C1. **Conflict and re-litigation detection.**
- When a new decision contradicts or repeats an existing one, Corteza flags it: "This reverses #12 (Aug 3). Supersede it?"
- Each decision keeps a version chain.
- Shown in capture emails and in the dashboard.

C2. **Ask Corteza.**
- Turn semantic search (`src/services/semantic-search.js`, `/api/semantic-search`) into answers with citations. Examples: "Why did we choose X?", "What's pending for Ana?", "What did we decide about pricing this quarter?"
- Available in the dashboard and later in Chat.

C3. **Outcome reviews.**
- The owner can mark a decision as "important", or the AI marks high-impact ones.
- Corteza schedules a 30- or 90-day prompt: "Did it work?" The owner answers worked, partly or failed, and adds a lesson.
- Lessons are shown the next time a similar decision comes up.

C4. **Decision health analytics for leaders.**
- Metrics:
  - % of decisions with an owner
  - follow-through rate
  - time to close
  - reversed decisions
  - decisions that keep coming back
  - meetings with no outcomes (meeting ROI)
- Builds on `ai-analytics`, and the weekly digest v2 focuses on these numbers.

### Phase D: Distribution (in parallel from Phase B)

- **Google Workspace Marketplace listing** with **admin install for the whole domain**, so users don't each need to consent. This depends on A1.
- **Workspace add-on:** a side panel in Calendar and Gmail showing the decisions and open items for a meeting. Later, a Meet add-on.
- **Existing channels:** keep the Chrome extension. Keep Slack input (old Phase 4) at low priority unless a design partner needs it.

## Go-to-market

- **Ideal customer profile:** companies of 20–200 people on Google Workspace with Gemini notes turned on, and many recurring internal meetings. Examples: startups, scale-ups and agencies. The buyer is the COO, CEO or Head of Ops.
- **Design partners:** Ninja Excel first, then 3–5 more with a free pilot in exchange for weekly feedback. Onboard them through the trusted-app path while verification runs.
- **Metrics to watch:**
  - time to first decision (under 5 minutes)
  - extraction precision, measured by the dismiss rate
  - % of items with an owner
  - follow-through rate
  - weekly active reviewers
  - pilot-to-paid conversion

## Sequence

| Weeks | Work | Customer-visible outcome |
|---|---|---|
| 1 | A1 submitted (runs in the background for 6–12 weeks), A2 extraction v2 with its evaluation harness, A6 basics | Better, cleaner decisions |
| 2–3 | A3 lifecycle, A4 onboarding and Slack made optional | First design partners onboarded |
| 4 | A5 billing | Paid plans ready |
| 5–9 | Phase B (B1–B5) | "Corteza follows up for you" |
| 10–15 | Phase C, and Phase D Marketplace once verified | Public launch on the Marketplace |

**First step:** A2 (extraction v2 and its evaluation harness) plus the A1 verification checklist. Every later feature depends on the quality of the extracted data.

## Rules that stay in force

- New code goes in the target layout: `src/core`, `src/integrations`, `src/ingestion`, `src/jobs`.
- Every write goes through `createDecision` or a new `core/actions` service.
- Every PR updates `docs/ARCHITECTURE.md`, `CLAUDE.md` and `.env.example` when it changes architecture, data shape or env vars.

## Verification

- **Extraction:** `scripts/eval-extraction.js` reports precision and recall per type on the labeled set. The target is decision precision of at least 0.85 before v2 ships. The same set is re-run on every prompt or model change.
- **Tests:** each new service gets unit tests. Linking, nudges and lifecycle get integration tests (`test/integration/`, `setupTestDatabase()`). CI stays green.
- **Pilots:** Ninja Excel runs each phase for 1–2 weeks before it goes to other partners. We track the metrics above and review dismissals weekly to tune the prompt.
- **Verification milestone:** the Google restricted-scope approval letter and the CASA Letter of Assessment are received before the public Marketplace launch.

## Sources

- [Otter: decision tracking tools 2026](https://otter.ai/blog/best-decision-tracking-software)
- [Decisions for Microsoft Teams: pricing](https://www.meetingdecisions.com/pricing)
- [Fellow vs Fireflies](https://fellow.ai/blog/fellow-vs-fireflies-ai/)
- [Fellow pricing 2026](https://get-alfred.ai/blog/fellow-pricing)
- [Fireflies vs Read AI](https://fireflies.ai/blog/fireflies-vs-read-ai)
- [Loqbooq pricing](https://loqbooq.app/pricing)
- [Cloverpop platform](https://www.cloverpop.com/decision-intelligence-platform)
- [Reflect OS](https://www.reflect-os.com/)
- [Gemini "Take notes for me"](https://support.google.com/meet/answer/14754931)
- [In-person notes (Aug 2026)](https://workspaceupdates.googleblog.com/2026/08/take-notes-with-me-for-in-person-meetings-is-now-available.html)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [CASA guide](https://deepstrike.io/blog/google-casa-security-assessment-2025)
- [Marketplace OAuth configuration](https://developers.google.com/workspace/marketplace/configure-oauth-consent-screen)
- [Action item follow-through](https://fellow.ai/blog/how-to-track-action-items-steps-to-ensure-follow-through/)
