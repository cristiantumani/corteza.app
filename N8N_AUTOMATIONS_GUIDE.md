# n8n Automation Workflows for Corteza

This guide covers two powerful automations that enhance the Corteza user experience.

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

## 📊 Automation 2: Weekly Team Digest Email

**Value:** Automatic weekly summary of team's decision-making activity. Keeps teams engaged and aware of their productivity.

### n8n Workflow Setup

#### Node 1: Schedule Trigger
1. Add **Schedule Trigger** node
2. Configure:
   - **Trigger Interval:** Cron
   - **Cron Expression:** `0 9 * * 1` (Every Monday at 9 AM)
   - **Timezone:** Your timezone

#### Node 2: Query Last Week's Decisions
1. Add **MongoDB** node
2. Configure:
   - **Operation:** Find
   - **Collection:** decisions
   - **Query:**
     ```json
     {
       "workspace_id": "T0WKH1NGL",
       "timestamp": {
         "$gte": "{{ $now.minus({days: 7}).toISO() }}"
       }
     }
     ```
   - **Options:**
     ```json
     {
       "sort": { "timestamp": -1 }
     }
     ```

#### Node 3: Calculate Stats
1. Add **Code** node
2. Code:
   ```javascript
   const decisions = $input.all();
   const thisWeek = decisions.length;

   // Previous week (for comparison)
   const weekAgo = new Date();
   weekAgo.setDate(weekAgo.getDate() - 14);
   const lastWeek = decisions.filter(d =>
     new Date(d.json.timestamp) < weekAgo
   ).length;

   const change = thisWeek - lastWeek;
   const changePercent = lastWeek > 0 ? Math.round((change / lastWeek) * 100) : 0;

   // Count by type
   const byType = decisions.reduce((acc, d) => {
     const type = d.json.type || 'unknown';
     acc[type] = (acc[type] || 0) + 1;
     return acc;
   }, {});

   // Count by category
   const byCategory = decisions.reduce((acc, d) => {
     const cat = d.json.category || 'uncategorized';
     acc[cat] = (acc[cat] || 0) + 1;
     return acc;
   }, {});

   // Top contributors
   const contributors = decisions.reduce((acc, d) => {
     const creator = d.json.creator || 'Unknown';
     acc[creator] = (acc[creator] || 0) + 1;
     return acc;
   }, {});

   const topContributors = Object.entries(contributors)
     .sort((a, b) => b[1] - a[1])
     .slice(0, 5)
     .map(([name, count]) => ({ name, count }));

   // Most active day
   const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
   const byDay = decisions.reduce((acc, d) => {
     const day = new Date(d.json.timestamp).getDay();
     acc[day] = (acc[day] || 0) + 1;
     return acc;
   }, {});

   const mostActiveDay = Object.entries(byDay)
     .sort((a, b) => b[1] - a[1])[0];

   // Top tags
   const allTags = decisions.flatMap(d => d.json.tags || []);
   const tagCounts = allTags.reduce((acc, tag) => {
     acc[tag] = (acc[tag] || 0) + 1;
     return acc;
   }, {});

   const topTags = Object.entries(tagCounts)
     .sort((a, b) => b[1] - a[1])
     .slice(0, 10);

   return {
     thisWeek,
     lastWeek,
     change,
     changePercent,
     changeEmoji: change > 0 ? '⬆️' : change < 0 ? '⬇️' : '➡️',
     byType,
     byCategory,
     topContributors,
     mostActiveDay: mostActiveDay ? dayNames[mostActiveDay[0]] : 'N/A',
     topTags
   };
   ```

#### Node 4: Format HTML Email
1. Add **Code** node
2. Code:
   ```javascript
   const stats = $input.first().json;

   const html = `
   <!DOCTYPE html>
   <html>
   <head>
     <style>
       body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
       .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
       .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 40px 30px; text-align: center; }
       .header h1 { margin: 0; font-size: 28px; }
       .header p { margin: 10px 0 0 0; opacity: 0.9; }
       .content { padding: 30px; }
       .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 20px 0; }
       .stat-card { background: #f8fafc; padding: 20px; border-radius: 8px; text-align: center; }
       .stat-number { font-size: 36px; font-weight: bold; color: #6366f1; }
       .stat-label { font-size: 14px; color: #64748b; margin-top: 5px; }
       .section { margin: 30px 0; }
       .section h2 { font-size: 18px; color: #1e293b; margin-bottom: 15px; }
       .contributor { display: flex; justify-content: space-between; padding: 10px; background: #f8fafc; margin: 5px 0; border-radius: 6px; }
       .tag { display: inline-block; background: #e0e7ff; color: #4338ca; padding: 5px 12px; border-radius: 20px; margin: 5px; font-size: 13px; }
       .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 13px; color: #64748b; }
     </style>
   </head>
   <body>
     <div class="container">
       <div class="header">
         <h1>📊 Weekly Digest</h1>
         <p>Your team's decision-making activity</p>
       </div>

       <div class="content">
         <div class="stat-grid">
           <div class="stat-card">
             <div class="stat-number">${stats.thisWeek}</div>
             <div class="stat-label">Decisions This Week</div>
           </div>
           <div class="stat-card">
             <div class="stat-number">${stats.changeEmoji} ${Math.abs(stats.change)}</div>
             <div class="stat-label">vs Last Week (${stats.changePercent > 0 ? '+' : ''}${stats.changePercent}%)</div>
           </div>
         </div>

         <div class="section">
           <h2>📈 By Type</h2>
           ${Object.entries(stats.byType).map(([type, count]) =>
             `<div class="contributor"><span>${type}</span><strong>${count}</strong></div>`
           ).join('')}
         </div>

         <div class="section">
           <h2>🏆 Top Contributors</h2>
           ${stats.topContributors.map((c, i) =>
             `<div class="contributor"><span>${i + 1}. ${c.name}</span><strong>${c.count} decisions</strong></div>`
           ).join('')}
         </div>

         <div class="section">
           <h2>📅 Most Active Day</h2>
           <div class="stat-card">
             <div class="stat-number">${stats.mostActiveDay}</div>
           </div>
         </div>

         <div class="section">
           <h2>🏷️ Top Tags</h2>
           <div>
             ${stats.topTags.map(([tag, count]) =>
               `<span class="tag">${tag} (${count})</span>`
             ).join('')}
           </div>
         </div>
       </div>

       <div class="footer">
         <p>🤖 Powered by Corteza | <a href="https://app.corteza.app/dashboard">View Dashboard</a></p>
       </div>
     </div>
   </body>
   </html>
   `;

   return {
     html,
     subject: `📊 Weekly Digest: ${stats.thisWeek} decisions this week ${stats.changeEmoji}`,
     stats
   };
   ```

#### Node 5: Send Email to Team
1. Add **Gmail** node
2. Configure:
   - **Operation:** Send Email
   - **To:** `cristiantumani@gmail.com` (or team email list)
   - **Subject:** `{{ $json.subject }}`
   - **Message (HTML):** `{{ $json.html }}`

### Workflow Diagram
```
Schedule (Monday 9 AM) → Query MongoDB → Calculate Stats →
  Format HTML → Send Gmail
```

### Testing

1. **Test the workflow manually:**
   - Click "Execute Workflow" in n8n
   - Check your email for the digest

2. **Verify stats are accurate:**
   - Compare with your dashboard numbers
   - Check MongoDB directly if needed

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

### Weekly Digest

**Issue:** No data returned
**Fix:**
- Check workspace_id in MongoDB query
- Verify MongoDB connection credentials

**Issue:** Email not sent
**Fix:**
- Check Gmail OAuth connection
- Verify email address is correct

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

