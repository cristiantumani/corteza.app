# 🚀 Corteza Beta Tester Guide

**Welcome, Beta Tester!** Thanks for helping us test Corteza - your team's AI-powered decision logger.

This guide will help you install Corteza to your Slack workspace and start using it right away.

**Time Required:** 10 minutes
**Cost:** Free during beta period

---

## 📋 What is Corteza?

Corteza helps teams capture and search important decisions, explanations, and context using AI.

**What you can do:**
- 🧠 Log decisions with `/decision` or `/memory` commands in Slack
- 📄 Upload meeting transcripts - AI extracts decisions automatically
- 🔍 Search your team's knowledge base with natural language
- 📊 View analytics on your team's decision-making
- 🔗 Link decisions to Jira epics (optional)

---

## ⚡ Quick Start

### Step 1: Install Corteza to Your Workspace (2 minutes)

1. **Click this link to install Corteza:**

   👉 **[Install Corteza to Slack](https://app.corteza.app/slack/install)** 👈

2. **Select your workspace** from the dropdown

3. **Click "Allow"** to grant permissions

   *Corteza needs these permissions to:*
   - Read/write messages (to log decisions and respond)
   - Read files (to extract decisions from transcripts)
   - Read user info (for dashboard authentication)

4. **You're done!** Corteza is now installed in your workspace

---

### Step 2: Log Your First Decision (2 minutes)

1. In any Slack channel or DM, type:
   ```
   /decision
   ```

2. A modal will appear: **"🧠 Add to Team Memory"**

3. Fill in the form:
   - **Content:** "We're beta testing Corteza to improve our team's knowledge sharing"
   - **Type:** Decision
   - **Category:** Product
   - **Tags:** beta, tools
   - **Additional comments:** First test decision!

4. Click **"Submit"**

5. You should see: ✅ **Logged to team memory as #1**

🎉 **Congrats!** You just logged your first team memory.

---

### Step 3: Access the Dashboard (2 minutes)

1. In Slack, type:
   ```
   /login
   ```

2. Click the **dashboard link** in the response

3. Click **"Login with Slack"** to authenticate

4. You'll see the **Corteza Dashboard** with:
   - Your team's decisions
   - Search bar
   - AI-powered chat
   - Analytics

---

### Step 4: Try Semantic Search (2 minutes)

1. In the dashboard, click the **purple chat bubble** (bottom right corner)

2. Ask a question in natural language:
   ```
   Show me all decisions about tools
   ```
   or
   ```
   What did we decide about beta testing?
   ```

3. The AI will search your knowledge base and respond with relevant decisions

---

### Step 5: Upload a Meeting Transcript (Optional, 2 minutes)

1. Create a test file called `meeting-notes.txt`:

```
Product Team Meeting - January 21, 2026

We decided to proceed with the new dashboard design because it's more modern
and user-friendly. We considered keeping the old design but the feedback was
overwhelmingly in favor of the new one.

The authentication flow works by redirecting users to Slack OAuth. After they
authorize, we create a session and store it in MongoDB. This is secure and
follows OAuth best practices.

Context: We need to launch the beta by end of month, so we're prioritizing
features that provide immediate value to users.
```

2. **Upload this file** to any Slack channel where Corteza is present

3. Wait 5-10 seconds

4. You'll see: **"🤖 Found 3 items in this transcript"**
   - 1 Decision (new dashboard design)
   - 1 Explanation (authentication flow)
   - 1 Context (launch timeline)

5. Review each suggestion:
   - Click **"Approve"** ✅ to log it
   - Click **"Edit"** ✏️ to modify before logging
   - Click **"Reject"** ❌ to skip it

6. Check your dashboard - approved items will appear immediately!

---

## 🎯 Available Commands

### For Everyone

| Command | Description | Example |
|---------|-------------|---------|
| `/decision` | Log a decision, explanation, or context | `/decision We're using React` |
| `/memory` | Alias for `/decision` | `/memory API uses JWT tokens` |
| `/decisions` | Search your knowledge base | `/decisions search authentication` |
| `/login` | Get your personalized dashboard link | `/login` |

### For Workspace Admins Only

| Command | Description | Example |
|---------|-------------|---------|
| `/settings` | Configure Jira integration | `/settings` |
| `/permissions` | Manage admin roles | `/permissions list` |

---

## 🔐 Understanding Permissions

Corteza has two roles: **Admin** and **Non-Admin**

### Admins
✅ Edit/delete ANY decision
✅ Configure Jira settings
✅ Grant admin access to others
✅ Revoke admin access

**Who are admins?**
- Slack Workspace Admins/Owners are automatically admins
- Admins can promote others with `/permissions grant @user`

### Non-Admins (Regular Users)
✅ View all decisions (read-only for others' decisions)
✅ Create new decisions
✅ Edit/delete THEIR OWN decisions only
✅ Search and use AI features

**Check who's an admin:**
```
/permissions list
```

**Promote someone to admin:**
```
/permissions grant @teammate
```

**Remove admin access:**
```
/permissions revoke @teammate
```

---

## 🔗 Optional: Configure Jira Integration

If your team uses Jira, you can link decisions to Jira epics.

**Requirements:**
- You must be a Workspace Admin
- You need your Jira URL, email, and API token

**Steps:**

1. In Slack, type:
   ```
   /settings
   ```

2. Fill in the Jira configuration modal:
   - **Jira URL:** `https://yourcompany.atlassian.net`
   - **Jira Email:** Your Jira email
   - **API Token:** Generate at https://id.atlassian.com/manage-profile/security/api-tokens

3. Click **"Save & Test"**

4. If successful, you'll see: ✅ **"Jira configuration saved and tested successfully!"**

5. Now when logging decisions, you can add a **Jira Epic Key** (e.g., `PROJ-123`)

**Note:** Each workspace configures its own Jira instance. Settings are encrypted and isolated per-workspace.

---

## 📊 Using the Dashboard

### Main Dashboard Features

**Browse & Filter:**
- Filter by type (decision/explanation/context)
- Filter by category (product/ux/technical)
- Filter by Jira epic
- Filter by date range
- Search by keywords

**View Details:**
- Click **"👁️ View"** to see full decision details
- See linked Jira epic info
- View tags and additional context

**Edit/Delete:**
- Admins can edit/delete any decision
- Regular users can only edit/delete their own
- "Read-only" label appears on decisions you can't modify

**Export:**
- Click **"📥 Export CSV"** to download all decisions
- GDPR-compliant data export available

### AI Chat Interface

Click the **purple chat bubble** in the bottom right to:
- Ask questions about your decisions
- Search using natural language
- Get AI-powered summaries
- Find related decisions

**Example queries:**
```
Show me all product decisions from last month
What explanations do we have about authentication?
Find context about our Q1 roadmap
```

### Analytics

View insights about your team's decision-making:
- Total decisions logged
- Decisions by type and category
- Most active team members
- Recent activity trends
- AI extraction accuracy

---

## 💡 Best Practices

### When to Use Each Type

**📌 Decision** - Choices and commitments
- "We will use PostgreSQL for the database"
- "We decided to launch beta in February"
- "We're hiring 2 engineers for the backend team"

**💡 Explanation** - How things work
- "The API authentication uses JWT tokens in the Authorization header"
- "Our deployment process involves GitHub Actions pushing to Railway"
- "User permissions are checked by comparing user_id with decision creator"

**📋 Context** - Background info, constraints, timelines
- "Budget approved is $50k for Q1"
- "Design must be accessible (WCAG AA)"
- "Launch deadline is end of Q2 due to board commitment"

### Tips for Better Team Memory

1. **Be Specific:** Write clear, actionable decisions
   - ✅ "We will use React 18 for the frontend"
   - ❌ "We talked about frontend stuff"

2. **Add Context:** Include WHY decisions were made
   - Use the "Additional comments" field
   - Mention alternatives considered

3. **Tag Consistently:** Use consistent tags across the team
   - `backend`, `frontend`, `infrastructure`
   - `q1-2026`, `q2-2026`
   - `urgent`, `blocked`, `approved`

4. **Link to Jira:** Connect decisions to epics for traceability
   - Helps track which decisions relate to which projects
   - Auto-fetches epic details for context

5. **Upload Transcripts:** Let AI do the work
   - Upload meeting notes as `.txt` or `.docx` files
   - Review AI suggestions before approving
   - Edit suggestions to improve accuracy

---

## 🐛 Troubleshooting

### Command doesn't respond

**Problem:** Corteza isn't responding to slash commands

**Solutions:**
1. Make sure Corteza is installed in your workspace
2. Try reinstalling: https://app.corteza.app/slack/install
3. Check if the bot was removed from the channel (re-invite it)

---

### Dashboard shows "Authentication required"

**Problem:** Can't access dashboard

**Solutions:**
1. Type `/login` in Slack to get a fresh login link
2. Make sure you clicked "Allow" when authorizing
3. Try logging out and logging in again

---

### "Read-only" label on my own decision

**Problem:** Can't edit a decision you created

**Solutions:**
1. Check if you're logged in as the same Slack user who created it
2. Wait a moment and refresh the page
3. Report to us if the issue persists

---

### Upload file doesn't trigger AI extraction

**Problem:** Uploaded transcript but AI didn't analyze it

**Solutions:**
1. Make sure Corteza bot is in the channel (invite with `/invite @Corteza`)
2. Use supported formats: `.txt`, `.docx`, or `.pdf`
3. File must be uploaded directly to Slack (not via external links)
4. Wait 10 seconds - AI processing takes a moment

---

### Can't configure Jira settings

**Problem:** `/settings` shows "permission denied"

**Solutions:**
1. Only Workspace Admins can configure settings
2. Ask a Workspace Admin to run `/settings`
3. Or ask an existing app Admin to grant you access: `/permissions grant @you`

---

## 📝 What to Test & Provide Feedback On

We're especially interested in feedback on:

### 🎯 Core Functionality
- [ ] Can you easily log decisions using `/decision`?
- [ ] Is the modal form intuitive?
- [ ] Does the dashboard load quickly?
- [ ] Is semantic search finding relevant decisions?

### 🤖 AI Features
- [ ] Does AI extract correct information from transcripts?
- [ ] Are AI suggestions accurate?
- [ ] Do you need to edit AI suggestions often?
- [ ] Is the AI chat helpful for searching?

### 🎨 User Experience
- [ ] Is the dashboard design clear and easy to use?
- [ ] Are the commands easy to remember?
- [ ] Is it clear what each type (decision/explanation/context) means?
- [ ] Are error messages helpful?

### 🔐 Permissions
- [ ] Do permissions work as expected?
- [ ] Can admins configure Jira successfully?
- [ ] Can non-admins edit their own decisions?
- [ ] Are you blocked from editing others' decisions?

### 🔗 Jira Integration (if using)
- [ ] Does Jira configuration work?
- [ ] Are epic links appearing correctly?
- [ ] Is Jira data fetched accurately?

---

## 💬 How to Provide Feedback

### Report Bugs
If something doesn't work:
1. Note what you were trying to do
2. Note what happened vs. what you expected
3. Include screenshots if possible
4. Email: cristiantumani@gmail.com
5. Or open an issue: https://github.com/cristiantumani/corteza.app/issues

### Share Ideas
If you have suggestions:
- What features would make this more useful?
- What's confusing or could be improved?
- What workflows are you trying to support?
- What integrations would you like?

### General Feedback
- What do you love? ❤️
- What's frustrating? 😤
- Would you pay for this? How much?
- Would you recommend it to other teams?

**Email any feedback to:** cristiantumani@gmail.com

---

## 🎉 You're Ready!

You now know how to:
- ✅ Install Corteza to your workspace
- ✅ Log decisions, explanations, and context
- ✅ Upload meeting transcripts for AI extraction
- ✅ Search your team's knowledge base
- ✅ Access the dashboard
- ✅ Configure Jira (if needed)
- ✅ Manage permissions (if admin)

### Next Steps

1. **Share with your team:**
   - Invite team members to start logging decisions
   - Add Corteza to relevant channels
   - Share this guide with your team

2. **Start building your knowledge base:**
   - Log important decisions from recent meetings
   - Upload past meeting transcripts
   - Use `/decisions` to search as you go

3. **Configure for your workflow:**
   - Set up Jira integration if needed
   - Grant admin access to key team members
   - Establish tagging conventions

4. **Provide feedback:**
   - Use Corteza for 2-4 weeks
   - Note what works and what doesn't
   - Share your experience with us

---

## 📞 Support & Questions

**Need help?**
- Email: cristiantumani@gmail.com
- GitHub Issues: https://github.com/cristiantumani/corteza.app/issues

**Follow development:**
- GitHub: https://github.com/cristiantumani/corteza.app
- Changelog: https://github.com/cristiantumani/corteza.app/blob/main/CHANGELOG.md

---

**Thank you for being a beta tester! 🙏**

Your feedback will help shape Corteza into a tool that truly serves teams who want to learn from their decisions.

---

**Made with ❤️ for teams who learn from their decisions**

*Last updated: January 21, 2026*
