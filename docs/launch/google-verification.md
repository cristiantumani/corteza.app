# Google verification checklist (roadmap A1)

Corteza reads Meet transcripts and Gemini notes. The Google scopes that allows are **restricted**. Until Google verifies the app, it stays in **Testing** mode: only listed test users (100 at most) can connect. Selling to customers requires verification, and verification takes weeks, so start early.

## Scopes we request

| Scope | Class | Why |
|---|---|---|
| `openid`, `email`, `profile` | Non-sensitive | Sign in with Google |
| `https://www.googleapis.com/auth/meetings.space.readonly` | Restricted | List meetings (conference records), participants, transcript entries and Gemini notes metadata |
| `https://www.googleapis.com/auth/drive.meet.readonly` | Restricted | Read the transcript Docs that Meet creates |
| `https://www.googleapis.com/auth/drive.readonly` | Restricted | Read Gemini notes Docs, which `drive.meet.readonly` doesn't cover. Corteza only opens the Docs the Meet API links to a meeting |

**Before submitting,** check whether `drive.readonly` is still needed. Connect a test account without it, import a meeting that has Gemini notes, and look for `appNotAuthorizedToFile` in the logs. If Google has extended `drive.meet.readonly` to Gemini notes, drop `drive.readonly` from `MEET_SCOPES` in `src/integrations/google/connections.js`. A narrower scope makes verification and the consent screen easier.

**Optional, sensitive (not restricted):** `https://www.googleapis.com/auth/calendar.events.readonly` reads the person's own events for today when their morning summary is built, to list today's meetings with the open action items of the people in them (`core/briefs/meeting-prep.js`). Events are never stored. Include it in the verification request (justification and demo video: the "Prepare for today's meetings" section). Corteza works without it: people who untick it get no meeting prep.

A future roadmap item adds another sensitive scope: `tasks` for Google Tasks. Add it to the verification request only once the feature ships.

## Steps

1. **Brand verification**
   - Verified domain `corteza.app` (Search Console) set as an authorized domain.
   - App name, logo, support email, and links to the home page, privacy policy and terms on `corteza.app`.
2. **Privacy policy and terms.** Update `PRIVACY.md` and `TERMS.md` and publish them. They must say:
   - what Google data we read (meeting metadata, transcripts and notes, only to extract decisions)
   - that we don't store transcripts: only the extracted items and a short evidence quote are kept
   - that Google data isn't used to train models and isn't sold or transferred, in line with the Google API Services User Data Policy "Limited Use" requirements
   - retention, deletion (`/api/gdpr/delete-all`) and contact details
3. **In-app disclosure.** Explain on the Connect Google Meet screen, before the consent screen, why each permission is needed.
4. **Demo video** (unlisted YouTube link) showing:
   - the full OAuth consent flow, with the client ID visible in the URL
   - each restricted scope being used: listing meetings, importing a meeting with a transcript, and importing one with Gemini notes
   - where the data appears in the dashboard, and how to disconnect and delete
5. **Scope justification text** for each restricted scope. Reuse the "Why" column above.
6. **Security assessment (CASA).**
   - Restricted scopes require a CASA assessment by an authorized lab, usually Tier 2.
   - Expect roughly $500–1,000, 6–12 weeks end to end including fixes, and a renewal every 12 months.
   - Prepare the following before the assessment:
     - dependency audit (`npm audit`)
     - HTTPS only
     - encrypted tokens (`src/utils/encryption.js`)
     - session security
     - rate limiting
     - logging without personal data
     - an incident response contact
7. **Submit** from Google Cloud Console → Google Auth Platform → Verification center. Answer Google's emails quickly, because the review pauses while they wait.

## Pilots while verification is pending

- **Test users:** add each pilot user's email under Google Auth Platform → Audience → Test users (100 at most). Testing-mode refresh tokens can expire after 7 days, so users may need to reconnect weekly.
- **Trusted app (per customer domain), to be confirmed.** The pilot's Workspace admin can mark the Corteza OAuth client as **Trusted** in Admin console → Security → Access and data control → API controls → Manage third-party app access. Try this with Ninja Excel first. Record here whether it lifts the unverified-app warning and the user cap for that domain.

## After verification

- Publish the app (Audience → In production).
- **Workspace Marketplace listing** (roadmap D): lets an admin install Corteza for the whole domain, so users don't each see the consent screen.
- Put the yearly CASA renewal in the calendar.
