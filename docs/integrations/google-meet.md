# Google Meet: automatic decision capture

Corteza reads the transcripts and Gemini notes of your Google Meet meetings and saves the decisions in them automatically. Nobody has to review them first. Each decision is marked **✨ AI-captured**, links back to the meeting's transcript or notes, and can be edited or deleted like any other decision.

## For users

1. Sign in to Corteza with Google.
2. Go to **Settings → Google Meet → Connect Google Meet** and allow the requested access. Use the same Google account you signed in with.
3. In your meetings, turn on **transcription** (Activities → Transcripts) or **Gemini "Take notes for me"**.

A few minutes after a meeting ends and Google has finished the transcript, its decisions appear in the dashboard, and you get a summary email.

**Settings** (per user):
- **Save decisions to:** a space you can post to. Defaults to the workspace's default space.
- **Skip 1:1 meetings:** on by default. Skips meetings with 2 or fewer participants.
- **Skip meetings whose title contains:** comma-separated keywords, e.g. `interview, personal, 1:1`.
- **Check for new meetings now:** runs a check immediately, handy for testing.
- **Disconnect:** revokes Corteza's Google access. Decisions already captured stay.

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
  utils/n8n-client.sendMeetingCaptureEmail   summary to the connected user
```

- **Connection:** `integrations/google/connections.js` asks for consent separately from sign-in (incremental consent, `access_type=offline`), checks the connected account matches the signed-in user, and stores the refresh token encrypted (`utils/encryption.js`) in `google_connections`.
- **Late transcripts:** Meet generates transcripts a few minutes after a meeting ends. Meetings still generating are retried on later polls; after 6 hours without a transcript they're recorded as skipped (`no_transcript`).
- **Failures:** a failed extraction is retried up to 3 times, at least 10 minutes apart. A revoked or expired Google grant (`invalid_grant`) marks the connection `revoked`, and Settings asks the user to reconnect.
- **Environment:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`; optional `MEET_CAPTURE_ENABLED=false` and `MEET_POLL_INTERVAL_MINUTES`.

## Google Cloud setup

- **APIs enabled:** Google Meet REST API, Google Drive API.
- **OAuth consent screen → Data access**, add:
  - `https://www.googleapis.com/auth/meetings.space.readonly`
  - `https://www.googleapis.com/auth/drive.meet.readonly`
- **OAuth client → Authorized redirect URIs:** `${BASE_URL}/integrations/google/callback` (in addition to the sign-in callback).
- **Testing mode:** only listed test users can connect. Publishing to all users requires Google's verification of these scopes, which can take several weeks.
