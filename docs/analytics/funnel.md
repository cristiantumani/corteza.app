# Funnel: from the website to an active team

The website (corteza.app, Lovable, `posthog-js`) and the app (`src/integrations/posthog/client.js`,
server side) send to the **same PostHog project**. One person is followed end to end:

1. On the website, a visitor is anonymous until they request early access. The site then calls
   `posthog.identify(email)` (lowercased), so their earlier page views join that person.
2. Approving them (`core/beta/approve.js`) sends `beta_approved` with the same email as distinct id.
3. Their first Google sign-in sends `$merge_dangerously` (`linkWebsiteVisitor`): the email person and
   the Corteza `user_id` become one person. Every app event after that uses the `user_id`.

## The funnel (PostHog → Product analytics → New insight → Funnels)

| Step | Event | Notes |
|---|---|---|
| 1 | `$pageview` | Current URL contains `corteza.app` (the website) |
| 2 | `$pageview` | Current URL contains `/early-access` |
| 3 | `early_access_form_submitted` | |
| 4 | `early_access_signup_success` | the request was saved |
| 5 | `beta_approved` | Cristian approved them |
| 6 | `user_signed_in` | first sign-in to the app |
| 7 | `google_meet_connected` | |
| 8 | `meeting_captured` | first meeting read: the team is active |

- Conversion window: 30 days (approval and first meeting can take days).
- Steps 1–4 alone (window 1 day) show where the website loses people; break down by
  `Referring domain` to compare channels.
- Retention (a separate insight): `meeting_captured` week over week shows who keeps using it.

Only people who requested access after this was deployed (Oct 29, 2026) can complete the whole
funnel; earlier testers show from step 5 or 6 on.

## What never goes to PostHog

Meeting content, outcome text, search questions or answers, AI context, transcripts. Events carry
ids, counts and types (see CLAUDE.md, "Analytics never carries meeting content").
