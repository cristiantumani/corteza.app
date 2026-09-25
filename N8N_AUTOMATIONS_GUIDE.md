# n8n Automation Workflows for Corteza

This guide covers the Google Drive transcript automation. The weekly digest and feedback workflows have moved into the app (see Automation 2).

---

## 🤖 Automation 1: Google Drive → AI Decision Extraction

**Value:** Zero-friction decision capture. Users just drop meeting transcripts into a Google Drive folder and decisions are automatically extracted and posted to Slack.

### Prerequisites

1. Google Drive folder for transcripts (create one: "Corteza Transcripts")
2. Slack workspace connection in n8n
3. Your Corteza app deployed with `/api/extract-decisions` endpoint

### n8n Workflow Setup

#### Node 1: Google Drive Trigger
1. Add **Google Drive Trigger** node
2. Configure:
   - **Trigger On:** File Created
   - **Drive:** My Drive
   - **Folder:** Select your "Corteza Transcripts" folder
   - **Watch For:** Text files (`.txt`, `.md`, `.docx`)
   - **Polling Time:** 1 minute (or real-time if available)

#### Node 2: Download File Content
1. Add **Google Drive** node (action node, not trigger)
2. Configure:
   - **Operation:** Download
   - **File ID:** `{{ $json.id }}`
   - **Output Format:** Text

#### Node 3: Extract Decisions via API
1. Add **HTTP Request** node
2. Configure:
   - **Method:** POST
   - **URL:** `https://app.corteza.app/api/extract-decisions`
   - **Authentication:** Generic Credential Type
     - **Header Name:** `Cookie`
     - **Header Value:** `connect.sid=YOUR_SESSION_COOKIE`
   - **Headers:**
     ```json
     {
       "Content-Type": "application/json"
     }
     ```
   - **Body (JSON):**
     ```json
     {
       "text": "{{ $json.data }}",
       "fileName": "{{ $node["Google Drive Trigger"].json.name }}",
       "workspace_id": "T0WKH1NGL",
       "user_id": "U03CTCX0P7Y",
       "user_name": "cristian.tumani"
     }
     ```

**How to get session cookie:**
1. Go to `https://app.corteza.app/dashboard`
2. Open DevTools (F12) → Application tab → Cookies
3. Copy the `connect.sid` value

#### Node 4: Check if Decisions Found
1. Add **IF** node
2. Configure:
   - **Condition:** `{{ $json.count }}` is greater than `0`

#### Node 5a: Post to Slack (if decisions found)
1. Add **Slack** node (connect to IF "true" branch)
2. Configure:
   - **Operation:** Post Message
   - **Channel:** #decisions (or your preferred channel)
   - **Message:**
     ```
     🤖 *AI extracted {{ $json.count }} decision(s) from meeting transcript*

     📄 File: {{ $json.fileName }}
     👤 Uploaded by: {{ $json.user_name }}

     *Decisions found:*
     {{#each $json.decisions}}
     {{add @index 1}}. *{{this.decision}}* (Type: {{this.type}}, Category: {{this.category}})
        _Context: {{this.alternatives}}_
     {{/each}}

     ✅ Review and approve these in Slack to add to your decision log.
     ```

#### Node 5b: No Decisions Found (if false)
1. Add **Slack** node (connect to IF "false" branch)
2. Configure:
   - **Channel:** #decisions
   - **Message:**
     ```
     📄 New transcript uploaded: {{ $json.fileName }}

     ℹ️  No decisions detected. The file might not contain decision-making discussions.
     ```

### Workflow Diagram
```
Google Drive Trigger → Download File → API Extract →
  IF (count > 0) ──┬→ Post decisions to Slack
                   └→ Post "no decisions" to Slack
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
3. Check Slack for the extracted decisions
4. Check Railway logs for: `🤖 AI extraction endpoint called`

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
**Fix:** Re-authenticate Google Drive connection in n8n

**Issue:** No executions triggered
**Fix:**
- Check folder permissions
- Verify folder ID is correct
- Check polling interval

**Issue:** 401 on API extract endpoint
**Fix:** Update session cookie (expires after 7 days)

---

## 🚀 Next Steps

Once these are working, consider adding:

1. **Slack Daily Summary** - Similar to weekly digest but daily
2. **Milestone Celebrations** - Trigger emails at 10, 50, 100 decisions
3. **Decision Reminders** - Notify when linked Jira epics close
4. **Auto-tagging** - Suggest tags for untagged decisions

---

## 📝 Notes

- The Google Drive automation requires a valid session cookie that expires after 7 days
- Consider creating a service account for long-term automation
- MongoDB queries use ISO date format for timestamp comparisons
- All workflows can be duplicated and customized per workspace

