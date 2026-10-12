# Know when Corteza breaks: errors, alerts, backups and status

**Status:** approved and built (Oct 12, 2026). Linear COR-16 (roadmap A6).

## Why

Today a failure in production is invisible until a pilot user notices it:

- An exception in a route or a background job (Meet poller, morning summary, imports) only reaches
  Railway's logs, which nobody reads.
- When the Anthropic credit ran out, captures silently failed until someone asked why nothing showed up.
- A meeting that fails three times stays failed, with no one told.
- MongoDB Atlas' free tier has **no backups**: one bad migration or a deleted collection loses every
  customer's data.
- People can't tell whether Corteza is working ("did it read yesterday's meeting?").

Before more pilot teams come in (COR-6), Cristian needs to hear about problems first, and the data
needs a way back.

## 1. Errors go to Sentry

- `@sentry/node`, on only when `SENTRY_DSN` is set (off in tests and local runs). Sentry's free plan
  (5,000 errors a month) is enough for the beta.
- Captured: unhandled errors in Express routes, unhandled promise rejections, and the `catch` blocks
  of every background job (`meet-poller`, `daily-digest`, `weekly-digest`, imports, batch extraction,
  re-engagement) through one helper, `reportError(error, { job, workspace_id })`.
- **No meeting content and no personal data reaches Sentry** (CLAUDE.md rules on logs and analytics):
  - `sendDefaultPii: false`; `beforeSend` removes the request body, cookies, headers, query string
    and `user` (only the internal `user_id` and `workspace_id` stay, as tags);
  - no breadcrumbs from `console` or HTTP (they can carry URLs with titles) and no performance
    tracing or profiling;
  - error messages from our own code already follow the logs rule; the Anthropic and Google SDK error
    messages carry status and type, not content.
- Sentry is a new **subprocessor**: the privacy policy (EN and ES, new date) lists it, with what it
  receives (error type, stack trace, internal ids) and that it is hosted in the EU (`de.sentry.io`).

## 2. Alerts by email

A small job (`src/jobs/ops-alerts.js`, every 15 minutes) emails `OPS_ALERT_EMAIL` (Resend, as the
other emails) when something needs Cristian. Each alert type is sent at most once every 6 hours while
it lasts, and once more when it's resolved ("Captures are working again"). Alerts hold counts, ids and
error types, never titles or text.

| Alert | When |
|---|---|
| **Claude is out of credit / rejected the key** | an Anthropic call fails with a billing or auth error (`credit balance is too low`, 401, 403). Sent right away (not on the 15-minute tick) |
| **Captures are failing** | 3 or more meetings in `failed` in the last hour, or any meeting that used up its 3 attempts |
| **The Meet poller stopped** | no poller run finished in the last 20 minutes (it runs every 5) |
| **Morning summaries failed** | one or more morning summaries failed to send today (count of failures) |
| **Google connections lost** | Google connections revoked or expired in the last 24 hours (count; at most once a day) |

The job state (last sent per type) lives in a small `ops_state` collection. `/health` stays as it is
(Railway needs it to answer without the database).

## 3. Nightly backups

- A GitHub Action (`.github/workflows/backup.yml`) runs every night: `mongodump --archive --gzip` of
  the production database, encrypted with `age` to a public key whose private key only Cristian keeps
  (offline, in his password manager), then uploaded as a workflow artifact kept **30 days**.
- Secrets in the repo: `BACKUP_MONGODB_URI` (a read-only Atlas user created for this) and
  `BACKUP_AGE_RECIPIENT` (the public key, not a secret but kept there).
- Meeting content is already encrypted per workspace in the database; the archive is encrypted again
  as a whole, so the artifact is useless without the private key.
- `docs/ops/restore.md`: how to download an artifact, decrypt it and `mongorestore` it into a new
  database, tested once before this ships.
- If the action fails, GitHub emails the repo owner (default), so a missing backup is noticed.
- Why not Atlas backups: they need a paid cluster (M10, ~USD 57/month). When there is revenue, move
  to Atlas' own and drop this.

## 4. A status line in Settings

Under Settings → Google Meet, one line about **the person's own** capture, replacing today's "Last
checked":

- "Working · last checked 3 min ago · last meeting read yesterday at 16:20"
- "Paused: Google needs you to reconnect" (with the Reconnect button, as today)
- "Something went wrong reading 1 meeting today. We were notified." when one of their meetings failed
  for good

Admins see the same about their own capture only (colleagues' captures are theirs; CLAUDE.md:
colleagues never see each other's data). No workspace-wide status page.

## Not now

- An uptime monitor outside Railway (Better Stack, UptimeRobot). Later, with a public status page.
- Performance monitoring and tracing.
- Alerts by Slack or SMS.
- Paid backups (above).

## Env vars

`SENTRY_DSN`, `SENTRY_ENVIRONMENT` (default `production`), `OPS_ALERT_EMAIL`. GitHub secrets:
`BACKUP_MONGODB_URI`, `BACKUP_AGE_RECIPIENT`.

## What Cristian does (once)

1. Create a Sentry project (Node, EU region) and put its DSN in Railway as `SENTRY_DSN`.
2. Set `OPS_ALERT_EMAIL` in Railway.
3. Create a read-only Atlas user, put its URI in GitHub as `BACKUP_MONGODB_URI`.
4. Create an `age` key pair (`age-keygen`), keep the private key offline, put the public key in GitHub
   as `BACKUP_AGE_RECIPIENT`.
5. Run the restore guide once with the first backup.

## Tests

- Unit: `beforeSend` scrubbing (body, cookies, headers, query and user removed; ids kept as tags); the
  Anthropic error classifier (billing/auth vs everything else); alert throttling (once per 6 h, a
  resolved message).
- Integration: the alert checks against a test database (failed ingestions in the last hour, a meeting
  out of attempts, a stale poller run, summaries sent vs due); the Settings status for one person
  never counts a colleague's meetings.
- The backup workflow: a dry run against the test MongoDB in CI (dump, encrypt, decrypt, restore,
  compare counts).
