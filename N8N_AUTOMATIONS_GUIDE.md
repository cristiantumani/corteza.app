# n8n Automation Workflows for Corteza

This guide covers the Google Drive transcript automation. The weekly digest and feedback workflows have moved into the app (see Automation 2).

---

## 🤖 Automation 1: Google Drive → AI Decision Extraction

**Value:** Zero-friction decision capture. Users drop meeting transcripts (including Google Meet transcripts and Gemini meeting notes) into a Google Drive folder, and Corteza extracts the decisions and queues them for review in the dashboard.

### Prerequisites

1. Google Drive folder for transcripts (create one: "Corteza Transcripts", or use Meet's "Meet Recordings" folder)
2. A Corteza API key: **Settings → API Keys → Create New API Key**
3. Optional: Slack workspace connection in n8n (for notifications)

### n8n Workflow Setup

#### Node 1: Google Drive Trigger
1. Add **Google Drive Trigger** node
2. Configure:
   - **Trigger On:** File Created
   - **Drive:** My Drive
   - **Folder:** Select your transcripts folder
   - **Polling Time:** 1 minute (or real-time if available)

#### Node 2: Download File Content
1. Add **Google Drive** node (action node, not trigger)
2. Configure:
   - **Operation:** Download
   - **File ID:** `{{ $json.id }}`
   - **Google File Conversion → Docs To Format:** `text/plain` (Meet transcripts and Gemini notes are Google Docs)
3. Add an **Extract From File** node (**Operation:** Extract From Text File) so the content is available as `{{ $json.data }}`

#### Node 3: Extract Decisions via API
1. Add **HTTP Request** node
2. Configure:
   - **Method:** POST
   - **URL:** `https://app.corteza.app/api/v1/extract`
   - **Authentication:** Generic Credential Type → **Header Auth**
     - **Name:** `Authorization`
     - **Value:** `Bearer corteza_YOUR_API_KEY`
   - **Body (JSON):**
     ```json
     {
       "text": "{{ $json.data }}",
       "fileName": "{{ $node["Google Drive Trigger"].json.name }}",
       "source": "google-drive"
     }
     ```
   - Optional: add `"space_id": "..."` to target a specific space. Without it, suggestions go to the workspace's default space.

The workspace and user come from the API key, so there is nothing else to configure. API keys don't expire unless you set an expiry, and you can revoke them in Settings.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "suggestions": [{ "suggestion_id": "...", "decision_text": "...", "decision_type": "decision", "confidence_score": 0.9 }],
  "transcript_id": "transcript_...",
  "space_id": "...",
  "message": "Queued 2 suggestions for review in the dashboard"
}
```

The suggestions are saved as pending. A banner on the dashboard shows them for approval, editing or rejection.

#### Node 4: Check if Decisions Found (optional)
1. Add **IF** node
2. Configure:
   - **Condition:** `{{ $json.count }}` is greater than `0`

#### Node 5: Notify Slack (optional)
1. Add **Slack** node (connect to IF "true" branch)
2. Configure:
   - **Operation:** Post Message
   - **Channel:** #decisions (or your preferred channel)
   - **Message:**
     ```
     🤖 *AI extracted {{ $json.count }} decision(s) from {{ $json.fileName }}*

     Review them in Corteza: https://app.corteza.app/dashboard
     ```

### Workflow Diagram
```
Google Drive Trigger → Download File → Extract From File → POST /api/v1/extract →
  IF (count > 0) → Notify Slack (optional)
```

### Testing

1. Upload a test transcript to your Google Drive folder:
   ```
   Meeting Notes - Product Planning

   We decided to move forward with the new search feature using Elasticsearch
   instead of our current solution. This will improve search performance by 10x.

   Alternative considered: PostgreSQL full-text search, but it doesn't scale well.

   John will lead the implementation starting next week.
   ```

2. Wait 1 minute for n8n to pick it up
3. Open the dashboard and check for the "waiting for review" banner
4. Check Railway logs for: `📝 API extraction:`

---

## 📊 Automation 2: Weekly Team Digest Email (moved into the app)

The weekly digest now runs inside Corteza (`src/jobs/weekly-digest.js`), so this n8n workflow is no longer needed. It gave n8n direct MongoDB credentials and only covered one hardcoded workspace. **Turn off the n8n workflow** once the in-app digest is enabled.

The in-app version:
- runs for every workspace and emails each member with an email address, via Resend
- only summarizes spaces the member can access, so private spaces stay private
- goes out Mondays at `DIGEST_HOUR_UTC` (default 09:00 UTC) and covers the previous Monday–Sunday. If the app was down, it catches up later that week
- skips members with no decisions to report, and sends once per workspace per week, even across restarts or multiple instances (`digest_runs` collection)
- includes an unsubscribe link and one-click `List-Unsubscribe` headers

**Enable it** with these environment variables:
```
WEEKLY_DIGEST_ENABLED=true
RESEND_API_KEY=...
BASE_URL=https://app.corteza.app
DIGEST_HOUR_UTC=9   # optional
```

User feedback from the dashboard is also handled in the app now. It is stored in the `feedback` collection and emailed to `FEEDBACK_EMAIL`, so the n8n `feedback` webhook workflow can be turned off too.

---

## 🔧 Common Issues

### Google Drive Automation

**Issue:** Authentication fails
**Fix:** Re-authenticate Google Drive connection in n8n. If Corteza returns 401, check the API key is active in Settings → API Keys and the header is `Authorization: Bearer <key>`

**Issue:** `Transcript too short`
**Fix:** Transcripts need at least 100 words

**Issue:** No executions triggered
**Fix:**
- Check folder permissions
- Verify folder ID is correct
- Check polling interval

**Issue:** 403 on API extract endpoint
**Fix:** The API key's user can't create decisions in the target space. Pass a `space_id` for a space they belong to, or add them to the space

---

## 🚀 Next Steps

Once these are working, consider adding:

1. **Slack Daily Summary** - Similar to weekly digest but daily
2. **Milestone Celebrations** - Trigger emails at 10, 50, 100 decisions
3. **Decision Reminders** - Notify when linked Jira epics close
4. **Auto-tagging** - Suggest tags for untagged decisions

---

## 📝 Notes

- The Google Drive automation authenticates with a Corteza API key (no session cookie needed)
- MongoDB queries use ISO date format for timestamp comparisons
- All workflows can be duplicated and customized per workspace

