# Google verification checklist (roadmap A1, Linear COR-5)

Corteza reads Meet transcripts and Gemini notes. The Google scopes that allows are **restricted**. Until Google verifies the app, it stays in **Testing** mode: only listed test users (100 at most) can connect. Selling to customers requires verification, and verification takes weeks, so start early.

The free steps (this page) come first; the paid security assessment (CASA, step 7) comes after Google asks for it.

## Scopes we request

| Scope | Class | Requested where | Why |
|---|---|---|---|
| `openid`, `email`, `profile` | Non-sensitive | Sign-in | Sign in with Google; the `hd` claim picks the workspace |
| `https://www.googleapis.com/auth/meetings.space.readonly` | Restricted | Connect Google (`MEET_SCOPES`) | List meetings (conference records), participants, transcript entries and Gemini notes metadata |
| `https://www.googleapis.com/auth/drive.meet.readonly` | Restricted | Connect Google | Read the transcript Docs that Meet creates |
| `https://www.googleapis.com/auth/drive.readonly` | Restricted | Connect Google | Read Gemini notes Docs, which `drive.meet.readonly` doesn't cover (tested, below). Corteza only opens the Docs the Meet API links to a meeting |
| `https://www.googleapis.com/auth/calendar.events.readonly` | Sensitive | Connect Google (optional, can be unticked) | Today's events, read when the morning summary is built: each meeting with what is still open from its earlier sessions (`core/briefs/meeting-prep.js`). Never stored |
| `https://www.googleapis.com/auth/drive.file` | Non-sensitive | Settings → Context for the AI, through Google's Picker | Only the files the person picks, as company or personal context for the AI (`integrations/google/drive-files.js`) |

All scopes go in Google Auth Platform → Data access, even the ones asked for later (`drive.file`).

A future roadmap item adds another sensitive scope: `tasks` for Google Tasks. Add it only once the feature ships.

## Can we drop `drive.readonly`? (live test, 15 minutes)

`drive.readonly` is the scope reviewers push back on most ("See and download all your Google Drive files"). Without it, verification is easier and the consent screen less scary. Test whether Google now lets `drive.meet.readonly` open Gemini notes:

1. Use an account with a recent meeting that has **Gemini notes** ("Take notes for me"), ideally one with notes but no transcript.
2. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground). In step 1, type these two scopes (one per line) and click **Authorize APIs**:
   `https://www.googleapis.com/auth/meetings.space.readonly`
   `https://www.googleapis.com/auth/drive.meet.readonly`
3. **Exchange authorization code for tokens.**
4. Step 3, GET `https://meet.googleapis.com/v2/conferenceRecords?pageSize=5`. Copy the `name` of the meeting (`conferenceRecords/…`).
5. GET `https://meet.googleapis.com/v2/conferenceRecords/<id>/smartNotes`. Copy `docsDestination.document` (the Doc id).
6. GET `https://www.googleapis.com/drive/v3/files/<doc id>/export?mimeType=text/plain`.
   - **200 with the notes text:** `drive.readonly` can go. Remove it from `MEET_SCOPES` in `src/integrations/google/connections.js`, its row from the disclosure page (`src/views/google-connect.html`, `connectGoogle.drive.*`) and the privacy policy, and from Data access. Existing connections keep working (they have more than needed).
   - **403 / 404 (`appNotAuthorizedToFile`, "has not granted the app … read access"):** keep it, and use the justification below.

**Result (Oct 9, 2026): keep `drive.readonly`.** With only `meetings.space.readonly` + `drive.meet.readonly`, `smartNotes` returns the notes Doc id, but `files/<id>/export` answers `403 appNotAuthorizedToFile` ("The user has not granted the app … read access to the file"). Re-run this test before each yearly CASA renewal: if Google extends `drive.meet.readonly` to Gemini notes, drop the scope.

## Steps

1. **Brand verification** (Google Auth Platform → Branding)
   - **Verify the domain** in [Google Search Console](https://search.google.com/search-console): add `corteza.app` as a *Domain* property and add the TXT record it gives you at the DNS provider. Use the same Google account that owns the Cloud project (or add it as an owner).
   - Authorized domains: `corteza.app`.
   - App name: **Corteza**. Logo: 120×120 px PNG, the same mark as `public/favicon.svg` (Google checks it matches the brand on the home page).
   - User support email and developer contact: `cristian@corteza.app`.
   - App home page: `https://corteza.app`. It must describe what Corteza does and link to the privacy policy.
   - Privacy policy: `https://app.corteza.app/privacy`. Terms of service: `https://app.corteza.app/terms`.
   - The home page at `corteza.app` (separate site) needs a visible **Privacy** link to `https://app.corteza.app/privacy` (and Terms). Add it to its footer.
2. **Privacy policy and terms.** Done: `src/views/legal/` served at `/privacy` and `/terms` (`src/http/legal.js`), English and Spanish, linked from the login page and the sidebar. The policy names every scope and what it's used for, says transcripts aren't stored, has the Limited Use statement, the AI-training statement, providers, retention and deletion, and the contact.
3. **In-app disclosure.** Done: every "Connect Google" link opens `/integrations/google/connect`, which explains each permission (in Google's own words) before the consent screen; **Continue to Google** starts consent (`?continue=1`).
4. **Demo video** (unlisted YouTube link): script in [`demo-video-script.md`](demo-video-script.md).
5. **Scope justifications** (below, ready to paste into Data access).
6. **Submit** from Google Auth Platform → Verification center. Answer Google's emails quickly: the review pauses while they wait.
7. **Security assessment (CASA)**, when Google asks for it after reviewing the scopes.
   - Restricted scopes require a CASA assessment by an authorized lab, usually Tier 2.
   - Expect roughly $500–1,000, 6–12 weeks end to end including fixes, and a renewal every 12 months.
   - Already in place: `npm audit` in CI, HTTPS only, encrypted Google tokens (`src/utils/encryption.js`), per-workspace field encryption (`src/core/crypto/`), session security, rate limiting, logs without meeting content. Still to prepare: an incident response contact and process.

## Scope justifications (paste into Data access)

**`meetings.space.readonly`**
> Corteza is a decision log for Google Workspace teams. After a user connects Google in Settings, Corteza lists the user's Google Meet conference records and reads each meeting's participants, transcript entries and Gemini "Take notes for me" metadata, to find the decisions, action items, open questions and risks agreed in the meeting and save them to the user's private log. Users can also import their past meetings from a list. Only the extracted outcomes are stored; transcripts are discarded after processing. No narrower scope gives access to conference records and transcripts.

**`drive.meet.readonly`**
> Google Meet saves meeting transcripts as Google Docs in the organizer's Drive. Corteza reads the transcript Doc linked to a conference record to extract the meeting's decisions and action items. The scope only covers files Google Meet creates; Corteza opens only the Docs the Meet API links to a meeting.

**`drive.readonly`** (still needed: tested Oct 9, 2026, see above)
> Gemini "Take notes for me" saves meeting notes as a Google Doc. Many meetings have notes but no transcript, and those notes Docs are not readable with drive.meet.readonly (tested on Oct 9, 2026: with drive.meet.readonly the Drive API returns 403 appNotAuthorizedToFile, "The user has not granted the app read access to the file"). Corteza uses drive.readonly only to export the notes Doc that the Meet API's smartNotes resource links to a conference record (files.export to text). It never lists, searches or opens other Drive files, and never stores the notes text: only the outcomes extracted from it. drive.file is not an option because the notes Doc is created by Google Meet, not picked by the user or created by Corteza.

**`calendar.events.readonly`** (optional for the user)
> Corteza's morning summary email prepares the user for today's meetings: for each event in the user's primary calendar today, it shows what is still open (action items, questions, risks) from that meeting's earlier sessions, matched by the event's Google Meet link. Events are read when the summary is built and are not stored. The user can untick this permission and Corteza works without it.

**`drive.file`**
> In Settings → Context for the AI, users can pick documents from Google Drive with the Google Picker (for example a company glossary) so the AI understands their company's terms. Corteza only opens the files the user picks.

## Pilots while verification is pending

- **Test users:** add each pilot user's email under Google Auth Platform → Audience → Test users (100 at most). Testing-mode refresh tokens can expire after 7 days, so users may need to reconnect weekly.
- **Trusted app (per customer domain), to be confirmed.** The pilot's Workspace admin can mark the Corteza OAuth client as **Trusted** in Admin console → Security → Access and data control → API controls → Manage third-party app access. Try this with Ninja Excel first. Record here whether it lifts the unverified-app warning and the user cap for that domain.

## After verification

- Publish the app (Audience → In production).
- **Workspace Marketplace listing** (roadmap D): lets an admin install Corteza for the whole domain, so users don't each see the consent screen.
- Put the yearly CASA renewal in the calendar.
- When a scope, a provider or a use of data changes, update the privacy policy (`src/views/legal/`, both languages, with a new date) and the disclosure page in the same PR.
