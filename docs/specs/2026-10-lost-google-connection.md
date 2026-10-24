# When Google stops working, the person knows

**Status:** approved and built (Oct 24, 2026). Linear COR-56. Builds on the Google connection
(`src/integrations/google/connections.js`), the daily digest (`src/jobs/daily-digest.js`) and the
ops alerts (`src/jobs/ops-alerts.js`).

## Why

Beta testers stopped getting the morning summary, and nobody told them why.

When Google refuses Corteza's token (access removed, password changed, or, today, the **7-day
expiry of apps in Testing mode**), the poller marks the connection `revoked`. From then on:

- no meetings are captured, so the morning summary has nothing new and **isn't sent**;
- Home and Settings show "Reconnect", but only to someone who opens Corteza;
- only the founder gets an email (the ops alert, which now names who).

From the person's side, Corteza just went quiet. They don't open the app to find out why, so they
never reconnect.

## What changes

### 1. An email to the person, the day it happens

When a connection becomes `revoked`, the person gets one email in their language:

> **Corteza dejó de leer tus reuniones**
> Google cortó el acceso de Corteza a tus reuniones el lunes, 20 de octubre. Pasa cuando se quita el
> permiso o vence la conexión. Desde entonces no capturamos nada nuevo.
> Reconecta con un clic: Corteza vuelve a leer tus reuniones, también las que tuviste mientras tanto.
> **[Reconectar Google]**

- The button goes to `/integrations/google/connect` (the existing permission page, then Google).
- **At most two emails per lost connection:** the day it's lost and a reminder 3 days after that
  first email if it's still lost. Nothing more after that; Home keeps the notice.
- Sent from the ops alerts job's 15-minute run (`src/integrations/google/reconnect-notices.js`).
  State lives on the connection (`reconnect_email_sent_at`, `reconnect_reminder_sent_at`), claimed
  before sending and released if the send fails; reconnecting clears it, so a later loss emails
  again. Connections lost before this shipped get their first email on the first run.
- People who opted out of email (`daily_digest_opt_out`) still get it: it's about the service, not a
  summary. One line at the bottom says why they're getting it.

### 2. After reconnecting, what was missed comes back on its own

No import needed: the poller resumes from the last meeting it read before the loss (`poll_cursor`
isn't reset on reconnect), so the meetings held while disconnected are captured on the next poll.
The email says so.

### 3. The morning summary doesn't go silent

While a person's connection is lost, every morning summary they get opens with "Corteza hasn't been
reading your meetings since Monday, October 20. [Reconnect Google]". With nothing new it's still
sent, without the partner's line, on the first morning after the loss and then on Mondays
(`digest_notice_sent_at` on the connection), so it doesn't nag every day.

### 4. The root cause: the 7-day expiry (your action, no code)

Google expires tokens after 7 days only while the OAuth app is in **Testing**. Moving it to **In
production** before verification ends the weekly expiry. The trade-off: testers see Google's "this
app isn't verified" screen once when they connect, and the app stays capped at 100 users until
verification. For a private beta that's a good trade.

Steps in `docs/launch/google-verification.md` (to be added in the same PR): Google Cloud Console →
Google Auth Platform → Audience → Publish app. To confirm before doing it: that the restricted Meet
and Drive scopes still work for the listed testers in that state.

## Privacy

Emails carry no meeting content: the date access stopped and a link. Logs and PostHog get counts and
ids only (`google_reconnect_email_sent`, `google_reconnected`).

## Not now

- Telling a workspace admin that a colleague's connection was lost (colleagues' data stays private;
  the founder alert covers ops).
- Detecting missing permissions other than a revoked token (e.g. Calendar unticked): Settings
  already shows those.

## Tests

- Integration (`test/integration/reconnect-notices.test.js`): one email, a reminder 3 days later,
  nothing after; a failed send is retried; reconnecting clears the state and a new loss emails again;
  opted-out people still get it; the morning summary is sent with the notice on the first morning and
  Mondays, not on other days, and never to connected people with nothing new.
- Unit (`test/unit/reconnect-email.test.js`): the email in EN and ES carries the date and link only;
  the summary leads with the notice and has its own subject when there is nothing else.

## Decisions (Oct 24)

1. Reminder after 3 days, then stop.
2. Summary with the notice when nothing else is new: the first morning and Mondays.
3. Moving the OAuth app to In production is Cristian's call; the steps are in
   `docs/launch/google-verification.md`.
