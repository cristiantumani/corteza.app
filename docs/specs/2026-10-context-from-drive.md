# Company context from Google Drive

**Status:** approved (Oct 7, 2026: option A, Google Picker with `drive.file`).

## Why

Settings → Context for the AI takes reference documents (a glossary, an org chart, a product
list) that Corteza reads with every meeting. Today they can only be uploaded from the admin's
computer. Our customers run on Google Workspace, so those documents live in Drive: an admin
should pick them from Drive in two clicks, and update them when the Doc changes.

## What the admin sees

Under **Reference documents** (admins only, as today):

- **Add a document** (from the computer, unchanged).
- **Add from Google Drive** opens Google's own file picker (the Picker), in the page's
  language. It lists Docs, Sheets, Slides, PDF, Word (DOCX), TXT, MD and CSV, including
  shared drives. One file at a time.
- A document that came from Drive shows a small Drive icon and **Update from Drive**, which
  reads the file again and replaces its text in place (same limits).
- If the button can't work (Picker not configured on the server), it isn't shown.

## How it works

1. The page loads Google Identity Services and the Picker script, only on Settings, only
   for admins, and only when the server has the Picker configured.
2. On click, Google asks the admin (once) to let Corteza **see the files they pick**: the
   `drive.file` scope. It's non-sensitive (no extra Google verification), and gives Corteza
   access only to files the person chooses in the Picker, never the rest of their Drive.
   The token lives in the browser for about an hour and is never stored by Corteza.
3. The Picker returns the file id; the page sends `{ file_id, access_token }` to the server.
4. The server reads the file with that token (Drive API v3) and keeps only the text:
   - Google Docs and Slides: exported as plain text.
   - Google Sheets: exported as CSV (Drive exports the first sheet).
   - PDF, DOCX, TXT, MD, CSV: downloaded (up to 5 MB, the same as an upload) and read with
     `extractTextFromFile`.
   - Anything else is refused with a clear message.
5. The text goes through `addCompanyDocument`, so the limits stay the same (5 documents,
   20,000 characters each, 40,000 in total) and the text is encrypted like the rest of the
   context. The document keeps `source: { type: 'google_drive', file_id, mime_type, modified_time }`.
6. **Update from Drive** asks for a token the same way (silent when already granted) and
   calls the refresh endpoint, which reads the file again and replaces `text`, `chars`,
   `truncated` and `source.modified_time`. If this admin can't open the file (`drive.file`
   access is per person: another admin picked it), the server answers 404 and the page asks
   to pick it again from Drive.

## API

| Method | Path | Body | Who |
|---|---|---|---|
| GET | `/api/ai-context` | adds `drive: { client_id, api_key, app_id }` when configured and the person is an admin, else `null` | any member |
| POST | `/api/ai-context/company/documents/drive` | `{ file_id, access_token }` | admins |
| POST | `/api/ai-context/company/documents/:docId/refresh` | `{ access_token }` | admins |

`file_id` must look like a Drive id (letters, digits, `-`, `_`), and the token is a string of
at most 4,096 characters. The Drive URL is fixed (`www.googleapis.com/drive/v3/files/{id}`),
so nothing in the request can point the server elsewhere.

## Privacy and security

- Corteza never stores or logs the access token. Logs carry the workspace id, the user id,
  the Drive MIME type and the text length, never the file name or its text.
- Only the extracted text is kept (as with uploads); the file itself is not stored.
- The Content Security Policy is opened **only on the Settings page** and only when the Picker
  is configured: scripts from `apis.google.com` and `accounts.google.com`, frames from
  `docs.google.com`, `drive.google.com` and `accounts.google.com`, the GIS stylesheet, and
  `Referrer-Policy: strict-origin-when-cross-origin` there (the Picker's API key is restricted
  by referrer, so it needs to see our origin). Every other page keeps the strict policy.

## Configuration

| Env var | What |
|---|---|
| `GOOGLE_PICKER_API_KEY` | Browser API key, restricted to the Picker API and to `${BASE_URL}/*` |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | The Cloud project number (the Picker's app id), same project as `GOOGLE_CLIENT_ID` |

Setup in Google Cloud (same project as the sign-in OAuth client):

1. APIs & Services → Library: enable **Google Picker API** and **Google Drive API**.
2. Credentials → Create credentials → API key. Restrict it: *Application restrictions* → Websites
   → `https://app.corteza.app/*`; *API restrictions* → Google Picker API.
3. Credentials → the OAuth client (Web application) → *Authorized JavaScript origins*: add
   `https://app.corteza.app` (the token popup needs it; redirect URIs stay as they are).
4. OAuth consent screen → Data access: add `.../auth/drive.file` (non-sensitive).
5. Railway: set `GOOGLE_PICKER_API_KEY` and `GOOGLE_CLOUD_PROJECT_NUMBER` (Project settings →
   Project number), then redeploy.

## Out of scope

- Keeping Drive documents in sync automatically (would need a stored refresh token).
- Picking several files at once, folders, or personal-context documents from Drive.
- Searching Drive from Corteza's own UI (option B, needs the restricted `drive.readonly`).

## Tests

- Unit: reading a Drive file with a stubbed `fetch` (Doc export, Sheet as CSV, PDF/DOCX via
  the extractors, too large, unsupported type, 401/404 from Drive), and the CSP builder.
- Integration: the drive and refresh endpoints (admin only, input checks, saved `source`,
  refresh replaces text in place and respects the limits).
