# Demo video for Google verification (COR-5)

Google's reviewers watch this to check that every scope we ask for is used the way the justification says. Keep it **3–5 minutes**, in **English** (app language English: Settings → Language), recorded on screen with narration or on-screen captions. Upload it to YouTube as **Unlisted** and paste the link in the verification form.

Checklist and justifications: [`google-verification.md`](google-verification.md).

## Before recording

- Use a test account (ninjaexcel.com works) that has, in the last few days:
  - one meeting **with a transcript**,
  - one meeting **with Gemini notes only** (no transcript), so `drive.readonly` is shown being used (skip it if the live test let us drop that scope),
  - a meeting **today** in the calendar that also happened last week with the same Meet link, so meeting prep has history to show.
- **Disconnect Google first** (Settings → Google Meet → Disconnect) and remove Corteza at <https://myaccount.google.com/permissions>, so the full consent screen appears.
- Browser at 100% zoom, address bar visible (reviewers check the client ID in the consent URL), no other tabs or bookmarks with private data.
- Turn off email and chat notifications.

## Script

| # | Show | Say (or caption) |
|---|---|---|
| 1 | `https://app.corteza.app/auth/login` → **Continue with Google** → signed in to Home | "Corteza is a decision log for Google Workspace teams. It keeps the decisions, action items, open questions and risks from your Google Meet meetings. Users sign in with Google." |
| 2 | Point to the **Privacy · Terms** links on the login page or in the sidebar; open `/privacy` briefly and scroll to "Google API Services: Limited Use" | "Our privacy policy explains each Google permission and our Limited Use commitment." |
| 3 | Settings → Google Meet → **Connect Google** → the "Before you connect Google" page. Pause on it | "Before Google's consent screen, Corteza explains what each permission is for." |
| 4 | **Continue to Google** → the consent screen. **Zoom into the address bar** to show `client_id=…` and the scopes. Tick all boxes (calendar is optional) → **Continue** | "This is the OAuth consent screen for our client ID. Corteza asks for Meet meetings and transcripts, Meet files in Drive, Drive read access for Gemini notes, and, optionally, calendar events." |
| 5 | Back in Settings: "Connected as …". Scroll to **Import past meetings** → Find meetings | "**meetings.space.readonly**: Corteza lists the user's Google Meet conference records, with participants and whether they have a transcript or Gemini notes." |
| 6 | Select the **transcript** meeting → Import → wait until "Imported" | "**drive.meet.readonly**: Corteza reads the transcript Doc that Meet saved in the user's Drive, extracts the outcomes and discards the transcript." |
| 7 | Select the **Gemini notes only** meeting → Import → "Imported" | "**drive.readonly**: this meeting only has Gemini notes. Corteza opens only the notes Doc that the Meet API links to the meeting, never other Drive files." |
| 8 | Home → **All outcomes** → open one outcome: text, owner, the evidence quote, the meeting name | "Only the outcomes are stored, with a short quote as evidence, encrypted with a key for the user's workspace." |
| 9 | Action items page with the imported items | "Action items keep their owner and due date, so the team can follow up." |
| 10 | The **morning summary** email in Gmail (send it with `railway run node scripts/send-daily-digest.js --email <test account>`), scroll to today's meetings. Then Home → **Prepare your day**, open today's meeting | "**calendar.events.readonly**: the morning email and Home list today's meetings, each with what is still open from its earlier sessions. Events are read when needed, kept in memory for at most 10 minutes, and never saved." |
| 11 | Settings → Context for the AI → **Add from Google Drive** → the Picker → pick one doc | "**drive.file**: users can pick a document as context for the AI. Corteza can open only the files they pick." |
| 12 | Settings → Google Meet → **Disconnect** → confirm. Then <https://myaccount.google.com/permissions> shows Corteza is gone | "Users can disconnect at any time: Corteza revokes its access with Google and deletes the stored tokens. Data deletion requests go to cristian@corteza.app." |

## After recording

- Watch it once as a reviewer: is the client ID readable? Is each scope named on screen when it's used?
- Upload as **Unlisted**, title "Corteza – Google OAuth verification demo".
- Paste the link in Google Auth Platform → Verification center, and note it in `google-verification.md`.
- If Google asks for changes, re-record only the steps they mention.
