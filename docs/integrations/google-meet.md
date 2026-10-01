# Google Meet: automatic decision capture

Corteza reads the transcripts and Gemini notes of your Google Meet meetings and saves the decisions in them automatically. Nobody has to review them first. Each decision is marked **✨ AI-captured**, links back to the meeting's transcript or notes, and can be edited or deleted like any other decision.

## For users

1. Sign in to Corteza with Google.
2. Go to **Settings → Google Meet → Connect Google Meet** and allow the requested access. Use the same Google account you signed in with.
3. In your meetings, turn on **transcription** (Activities → Transcripts) or **Gemini "Take notes for me"**.

A few minutes after a meeting ends and Google has finished the transcript, its decisions appear in the dashboard. The next weekday morning (8:00 in each person's time zone), the daily digest email sums up those meetings and what's on their plate today (no email per meeting).

**Settings** (per user):
- **Save decisions to:** a space you can post to. Defaults to the workspace's default space.
- **Skip 1:1 meetings:** on by default. Skips meetings with 2 or fewer participants.
- **Skip meetings whose title contains:** comma-separated keywords, e.g. `interview, personal, 1:1`.
- **Check for new meetings now:** runs a check immediately, handy for testing.
- **Disconnect:** revokes Corteza's Google access. Decisions already captured stay.

### Import past meetings

For meetings that happened before you connected (for example, all of August 2026):

1. In **Settings → Google Meet → Import past meetings**, pick a **from/to** period within the last 7 days (`MEET_IMPORT_MAX_DAYS`; 7 during the private beta, since every imported meeting is an AI extraction), then click **Find meetings**. Older meetings are refused by the server too (`too_old`).
2. Corteza lists your meetings in that period with their date, title, number of participants, whether Google has a **transcript** and/or **Gemini notes**, and whether they were **already imported**.
3. Tick the meetings you want (or **Select all available**), choose the space, and click **Import selected**. You can import up to 50 at a time.
4. A progress bar shows each meeting as it's processed, and the result shows how many decisions were captured.

A few details:
- Meetings already imported are listed but can't be selected, so nothing is captured twice.
- Meetings that were never recorded can't be selected either.
- Meetings the automatic capture skipped (for example 1:1s) can be imported, because you chose them yourself.
- Imports don't send summary emails.

**Which meetings are captured:** the Meet API gives each person the meetings they can access. Transcripts and Gemini notes are owned by the meeting organizer, so capture works best when the organizer has connected Google Meet. If several participants have connected, each meeting is still processed once.

## How it works (for developers)

```
jobs/meet-poller.js           every MEET_POLL_INTERVAL_MINUTES (default 5), per active connection (with a lease):
  integrations/google/meet-client.js   list conference records that ended in the last 6h
  ingestion/sources/google-meet.js     load participants, transcript entries (speaker: text),
                                       Gemini notes (Doc → text), title and link from the Doc
  skip rules                           1:1s, excluded titles, no transcript (recorded as skipped)
  ingestion/pipeline.js                claim in `ingestions` (unique per meeting) → Claude extraction
                                       → core/decisions/decision-service.createDecision (capture: 'ai')
```

- **Import past meetings:** `ingestion/meet-import.js`.
  - `findMeetings` lists conference records in a date range and summarises each one with `describeMeeting` (no transcript download), plus its status from `ingestions`.
  - `startImport` stores a job in `meet_imports` and runs it in the background; the UI polls `GET /api/integrations/google/imports/:id`.
  - Imports call `ingestTranscript(..., { manual: true })`, which re-processes skipped or failed meetings but never completed ones.
  - Jobs interrupted by a restart are resumed by the poller (`resumeStaleImports`).
- **Connection:** `integrations/google/connections.js` asks for consent separately from sign-in (incremental consent, `access_type=offline`), checks the connected account matches the signed-in user, and stores the refresh token encrypted (`utils/encryption.js`) in `google_connections`.
- **Late transcripts:** Meet generates transcripts a few minutes after a meeting ends. Meetings still generating are retried on later polls; after 6 hours without a transcript they're recorded as skipped (`no_transcript`).
- **Access refused:** if Google refuses one source (for example the Gemini notes), the meeting is still captured from the other one. If the transcript entries are refused, the transcript Doc is exported from Drive instead. If nothing can be read, the poller logs Google's reason and moves on to the next meeting (it's retried on later polls), and imports show the reason next to the meeting.
- **Failures:** a failed extraction is retried up to 3 times, at least 10 minutes apart. A revoked or expired Google grant (`invalid_grant`) marks the connection `revoked`, and Settings asks the user to reconnect.
- **Environment:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`; optional `MEET_CAPTURE_ENABLED=false` and `MEET_POLL_INTERVAL_MINUTES`.

## Google Cloud setup

- **APIs enabled:** Google Meet REST API, Google Drive API.
- **OAuth consent screen → Data access**, add:
  - `https://www.googleapis.com/auth/meetings.space.readonly`
  - `https://www.googleapis.com/auth/drive.meet.readonly`
  - `https://www.googleapis.com/auth/drive.readonly`: Gemini notes Docs aren't covered by `drive.meet.readonly` (Google answers "The user has not granted the app … read access to the file"). Corteza only opens the Docs the Meet API links to. Connections made before this scope was added see a "Reconnect" prompt in Settings; until then they capture from transcripts only.
- **OAuth client → Authorized redirect URIs:** `${BASE_URL}/integrations/google/callback` (in addition to the sign-in callback).
- **Testing mode:** only listed test users can connect. Publishing to all users requires Google's verification of these scopes, which can take several weeks.
