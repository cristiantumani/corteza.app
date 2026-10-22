# When Google stops working, the person knows

**Status:** draft for approval (Oct 22, 2026). Linear COR-56. Builds on the Google connection
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
> Google cortó el acceso de Corteza a tus reuniones (pasa cuando se quita el permiso o vence la
> conexión). Desde el lunes 20 no capturamos nada nuevo.
> **[Reconectar Google]** (un clic, vuelve a Corteza)
> Lo que se perdió mientras tanto lo puedes importar después desde Configuración → Google Meet.

- The button goes to `/integrations/google/connect` (the existing permission page, then Google).
- **At most two emails per lost connection:** the day it's lost and a reminder 3 days later if it's
  still lost. Nothing more after that; Home keeps the notice.
- Sent by the ops alerts job (every 15 min), which already finds revoked connections. State lives on
  the connection (`reconnect_email_sent_at`, `reconnect_reminder_sent_at`), and reconnecting clears
  it, so a later loss emails again.
- People who opted out of email (`daily_digest_opt_out`) still get it: it's about the service, not a
  summary. One line at the bottom says why they're getting it.

### 2. After reconnecting, offer what was missed

Right after a reconnect, the Google Meet section in Settings shows "You were disconnected from
Mon 20 to Thu 23: **Import those meetings**", which opens Import past meetings with that period
preselected. Nothing is imported without a click.

### 3. The morning summary doesn't go silent

If a person's connection is lost, their morning summary is sent even with nothing new, with one line
at the top: "Corteza isn't reading your meetings since Mon 20. [Reconnect]". Only on the first
morning after the loss and then on Mondays, so it doesn't nag every day; the reconnect emails cover
the rest.

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

- Integration: a revoked connection gets one email, a reminder after 3 days, nothing after; reconnect
  clears the state and a new loss emails again; opted-out people still get it; another person's
  connection is never mixed in.
- Integration: the morning summary with a lost connection is sent with the status line (first morning
  and Mondays only).
- Unit: the email in EN and ES, no content beyond the date and link.
- Preview: the email and the Settings "Import those meetings" notice (desktop and mobile, EN and ES).

## Open questions

1. A reminder after **3 days**, then stop: OK?
2. Send the summary with the status line on **the first morning and Mondays**: OK, or every day
   while disconnected?
3. Section 4: do you move the app to **In production** now (the warning screen for testers), or wait
   for verification?
