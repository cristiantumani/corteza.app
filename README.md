# Decision Logger Bot

A Slack bot that helps Product Managers track and manage decisions made during the discovery, refinement, and development process. Integrates with Jira to automatically fetch epic details and add decision comments to issues.

## 📋 Overview

**The Problem:**
During product discovery and refinement, teams make important decisions across multiple tools (Figma, Jira, Miro, Slack). These decisions get scattered, forgotten, or disconnected from the user stories that implement them.

**The Solution:**
Decision Logger captures decisions where they happen (Slack), stores them in a centralized database with full Jira integration, and provides a beautiful web dashboard for visibility and analytics.

---

## 🚀 Features

### Core Features
- ✅ **Slack Commands**
  - `/decision [text]` - Opens a form to log a decision
  - `/decisions recent` - Shows the 10 most recent decisions
  - `/decisions search [keyword]` - Search decisions by text, tags, or epic
  - `/decisions epic [JIRA-123]` - Find all decisions related to a specific epic

- ✅ **Decision Metadata**
  - Decision type (Product, UX, Technical)
  - Epic/Story key (e.g., LOK-123)
  - Tags (comma-separated for easy filtering)
  - Alternatives considered
  - Creator and timestamp

- ✅ **Jira Integration** 🔥
  - Auto-fetch epic/story details from Jira (title, type, status)
  - Display clickable Jira links in Slack and dashboard
  - Optional: Add decision as a comment directly in Jira issue
  - Store Jira metadata with each decision

- ✅ **Web Dashboard**
  - Real-time statistics (total decisions, by type, this week)
  - Advanced filtering (search, type, epic)
  - Sortable table view with Jira links
  - Export to CSV
  - Auto-refresh every 30 seconds

- ✅ **Persistent Storage**
  - All decisions stored in MongoDB
  - Survives bot restarts
  - Full-text search capability

- ✅ **Cloud Deployment**
  - Runs 24/7 on Railway
  - No local setup needed
  - Automatic scaling

---

## 🛠️ Tech Stack

### Core Technologies
- **Runtime:** Node.js (v18+)
- **Framework:** Slack Bolt SDK (@slack/bolt)
- **Database:** MongoDB Atlas (Free tier)
- **Hosting:** Railway (Cloud platform)
- **Version Control:** Git + GitHub
- **Jira API:** Jira REST API v3

### Key Dependencies
```json
{
  "@slack/bolt": "^3.17.1",
  "mongodb": "^6.x",
  "dotenv": "^16.3.1"
}
```

---

## 📁 Project Structure

```
decision-logger-bot/
├── index.js                 # Main bot application with Jira integration
├── package.json             # Node.js dependencies
├── package-lock.json        # Locked dependency versions
├── .env                     # Environment variables (local only, not in git)
├── .gitignore              # Git ignore rules
└── README.md               # This file
```

---

## ⚙️ Configuration

### Environment Variables

The bot requires these environment variables:

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token from Slack | `xoxb-1234567890...` | Yes |
| `SLACK_SIGNING_SECRET` | Signing secret from Slack app settings | `abc123def456...` | Yes |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@...` | Yes |
| `PORT` | Port for the web server | `3000` | Yes |
| `JIRA_URL` | Your Jira Cloud URL | `https://yourcompany.atlassian.net` | Optional* |
| `JIRA_EMAIL` | Your Atlassian account email | `you@company.com` | Optional* |
| `JIRA_API_TOKEN` | Jira API token | `ATATT3xF...` | Optional* |

*Jira variables are optional but required for Jira integration features.

### Where to Find These Values

#### Slack Tokens
1. Go to https://api.slack.com/apps
2. Select your app
3. **Bot Token:** OAuth & Permissions → Bot User OAuth Token
4. **Signing Secret:** Basic Information → App Credentials → Signing Secret

#### MongoDB URI
1. Go to https://cloud.mongodb.com/
2. Select your cluster
3. Click "Connect" → "Drivers"
4. Copy the connection string

#### Jira Credentials
1. **Jira URL:** Your Jira Cloud URL (e.g., `https://yourcompany.atlassian.net`)
2. **Jira Email:** The email you use to log into Jira
3. **API Token:** 
   - Go to https://id.atlassian.com/manage-profile/security/api-tokens
   - Click "Create API token"
   - Label it "decision-logger-bot"
   - Copy the token (you won't see it again!)

---

## 🔐 Security Setup (IMPORTANT)

### Secrets Management

**⚠️ CRITICAL: Never commit the `.env` file to git!**

The `.env` file contains sensitive credentials that, if exposed, could compromise your entire infrastructure. Follow these security best practices:

### 1. Generate Secure State Secret (OAuth Mode)

If using OAuth multi-workspace mode, generate a cryptographically secure state secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add this to your `.env` or Railway environment variables as `SLACK_STATE_SECRET`.

### 2. Environment Variables Setup

**For Local Development:**
```bash
# Copy the template
cp .env.example .env

# Edit .env and fill in your actual values
# NEVER commit this file!
```

**For Production (Railway):**
1. Go to Railway dashboard → Your project → Variables tab
2. Add each environment variable individually:
   - `SLACK_SIGNING_SECRET` - From Slack app settings
   - `SLACK_CLIENT_ID` - From Slack OAuth settings
   - `SLACK_CLIENT_SECRET` - From Slack OAuth settings
   - `SLACK_STATE_SECRET` - Generated using crypto (see above)
   - `MONGODB_URI` - From MongoDB Atlas
   - `ANTHROPIC_API_KEY` - From Claude dashboard
   - `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` - Optional, for Jira integration

3. Railway will automatically redeploy with new variables

### 3. Credential Rotation Schedule

For production environments, rotate credentials regularly:

| Credential | Rotation Frequency | How to Rotate |
|------------|-------------------|---------------|
| `SLACK_STATE_SECRET` | Every 90 days | Generate new crypto random string |
| `SLACK_CLIENT_SECRET` | Every 90 days | Regenerate in Slack app settings |
| `MONGODB_URI` password | Every 90 days | Change in MongoDB Atlas |
| `JIRA_API_TOKEN` | Every 90 days | Revoke old, create new in Atlassian |
| `ANTHROPIC_API_KEY` | Every 90 days | Rotate in Claude dashboard |

### 4. Security Checklist Before Production

- [ ] `.env` file is in `.gitignore` (already done)
- [ ] No secrets committed to git history
- [ ] All environment variables set in Railway dashboard
- [ ] State verification enabled (`stateVerification: true`)
- [ ] Cryptographically secure state secret generated
- [ ] MongoDB IP allowlist configured (if using IP restrictions)
- [ ] Jira API token has minimal required permissions
- [ ] Claude API key usage limits set
- [ ] All team members aware of secrets management policy

### 5. What to Do If Secrets Are Exposed

If you accidentally commit secrets or they are otherwise exposed:

1. **Immediately revoke the exposed credentials:**
   - Slack: Regenerate client secret and bot token
   - MongoDB: Change database password
   - Jira: Revoke API token and create new one
   - Claude: Rotate API key

2. **Remove from git history** (if committed):
   ```bash
   # Use BFG Repo-Cleaner (recommended)
   git clone --mirror https://github.com/YOUR-REPO.git
   bfg --delete-files .env YOUR-REPO.git
   cd YOUR-REPO.git
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   git push --force
   ```

3. **Update all environments** with new credentials

4. **Monitor for suspicious activity** in Slack, MongoDB, Jira logs

### 6. Additional Security Measures

For enterprise deployments:

- **Use a secrets manager:** HashiCorp Vault, AWS Secrets Manager, or Railway's built-in secrets
- **Enable audit logging:** Track all access to credentials
- **Implement least privilege:** Only grant necessary permissions
- **Enable MFA:** On all accounts (Slack, MongoDB Atlas, Jira, Railway)
- **Regular security audits:** Review access logs monthly
- **Penetration testing:** Annual third-party security assessment

For more details, see [SECURITY_ROADMAP.md](./SECURITY_ROADMAP.md).

---

## 🔧 Local Development Setup

### Prerequisites
- Node.js v18 or higher
- npm (comes with Node.js)
- MongoDB Atlas account (free)
- Slack workspace with admin access
- Jira Cloud account (optional, for Jira integration)

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/cristiantumani/decision-logger-bot.git
   cd decision-logger-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create `.env` file**
   ```bash
   # Copy these to .env and fill in your actual values
   SLACK_BOT_TOKEN=xoxb-your-token-here
   SLACK_SIGNING_SECRET=your-secret-here
   MONGODB_URI=mongodb+srv://your-connection-string
   PORT=3000
   
   # Optional: Jira Integration
   JIRA_URL=https://yourcompany.atlassian.net
   JIRA_EMAIL=you@company.com
   JIRA_API_TOKEN=your-jira-token
   ```

4. **Run the bot locally**
   ```bash
   node index.js
   ```

5. **Expose local server (for testing)**
   ```bash
   # In a separate terminal
   cloudflared tunnel --url http://localhost:3000
   ```
   Copy the URL and update Slack app settings.

---

## 🚀 Deployment (Railway)

### Current Deployment
- **Platform:** Railway
- **URL:** https://decision-logger-bot-production.up.railway.app
- **Dashboard:** https://decision-logger-bot-production.up.railway.app/dashboard
- **Status:** Production
- **Region:** Auto-selected by Railway

### Deploy Your Own Instance

1. **Push code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR-USERNAME/decision-logger-bot.git
   git push -u origin main
   ```

2. **Deploy to Railway**
   - Go to https://railway.app/
   - Login with GitHub
   - New Project → Deploy from GitHub repo
   - Select your repository
   - Click "Deploy Now"

3. **Add environment variables in Railway**
   - Click on your deployment
   - Go to "Variables" tab
   - Add all required variables:
     - `SLACK_BOT_TOKEN`
     - `SLACK_SIGNING_SECRET`
     - `MONGODB_URI`
     - `PORT` (set to `3000`)
     - `JIRA_URL` (optional)
     - `JIRA_EMAIL` (optional)
     - `JIRA_API_TOKEN` (optional)
   - Railway will automatically redeploy

4. **Generate a domain**
   - Go to "Settings" tab
   - Under "Domains", click "Generate Domain"
   - Copy the generated URL

5. **Update Slack URLs**
   - Go to https://api.slack.com/apps → Your app
   - Update these URLs to your Railway domain + `/slack/events`:
     - Interactivity & Shortcuts → Request URL
     - Slash Commands → `/decision` → Request URL
     - Slash Commands → `/decisions` → Request URL

---

## 💾 Database Schema

### Decisions Collection

```javascript
{
  _id: ObjectId,                    // MongoDB auto-generated
  id: Number,                       // Sequential ID (1, 2, 3...)
  text: String,                     // Decision description
  type: String,                     // "product" | "ux" | "technical"
  epic_key: String | null,          // e.g., "LOK-123", "AP-456"
  jira_data: {                      // Auto-fetched from Jira (if configured)
    key: String,                    // "LOK-123"
    summary: String,                // "Implement AEM integration"
    type: String,                   // "Epic", "Story", etc.
    status: String,                 // "In Progress", "Done", etc.
    url: String                     // Full Jira URL
  } | null,
  tags: Array<String>,              // ["aem", "integration", "scope"]
  alternatives: String | null,      // Alternatives considered
  creator: String,                  // Slack user's real name
  user_id: String,                  // Slack user ID
  channel_id: String,               // Slack channel ID where logged
  timestamp: ISOString              // "2024-12-06T21:30:00.000Z"
}
```

### Indexes
- Text index on `text` and `tags` for full-text search
- Descending index on `timestamp` for recent queries
- Index on `epic_key` for epic-based filtering

---

## 📊 Usage Examples

### Logging a Decision with Jira Integration

```
/decision We will only sync AEM → Lokalise, not bidirectional
```

This opens a modal where you fill in:
- **Type:** Product
- **Epic:** `LOK-456` (auto-fetches title from Jira!)
- **Tags:** `aem, integration, scope`
- **Alternatives:** `Considered bidirectional sync but decided against due to resource constraints`
- **☑ Add this decision as a comment in Jira** (optional)

**Result:**
- Decision saved to MongoDB
- Jira epic title displayed in Slack: "LOK-456: AEM Integration Phase 1"
- Clickable link to Jira issue
- Optional: Comment added to Jira issue with decision details
- Visible in dashboard with Jira metadata

### Searching Decisions

```
/decisions search aem
```
Returns all decisions mentioning "aem" in text, tags, or epic

### Finding Decisions by Epic

```
/decisions epic LOK-456
```
Returns all decisions tagged with epic LOK-456

### Viewing Recent Decisions

```
/decisions recent
```
Shows the 10 most recent decisions

---

## 🎯 Dashboard Features

Access the dashboard at: `https://your-railway-url.up.railway.app/dashboard`

### Features:
- **Statistics Cards**
  - Total decisions
  - Breakdown by type (Product, UX, Technical)
  - Decisions logged this week

- **Advanced Filtering**
  - Search by text
  - Filter by decision type
  - Filter by epic key

- **Jira Integration**
  - Clickable epic links
  - Epic titles displayed under keys
  - Visual indication of Jira-linked decisions

- **Export Functionality**
  - Export all decisions to CSV
  - Includes Jira summary in export

- **Auto-Refresh**
  - Dashboard updates every 30 seconds
  - Real-time decision tracking

---

## 🔗 Jira Integration Details

### What Gets Auto-Fetched

When you enter a Jira issue key (e.g., `LOK-123`), the bot automatically fetches:
- Issue summary/title
- Issue type (Epic, Story, Bug, etc.)
- Current status
- Direct URL to the issue

### Adding Comments to Jira

When you check "Add this decision as a comment in Jira", the bot posts:

```
📝 Decision #42 logged by Cristian Tumani

Type: product
Decision: We will only sync AEM → Lokalise, not bidirectional

Alternatives considered: Considered bidirectional sync but decided against due to resource constraints

Logged via Decision Logger Bot
```

### Permissions Required

The Jira API token needs:
- Read access to issues (to fetch epic details)
- Write access to comments (to add decision notes)

### Troubleshooting Jira Integration

**Issue not found:**
- Verify the issue key is correct (e.g., `LOK-123`, not the full URL)
- Ensure your Jira account has access to the project
- Check that the issue exists in your Jira instance

**Comments not appearing:**
- Verify `JIRA_API_TOKEN` is set in Railway
- Check Railway logs for error messages
- Ensure your Jira account has permission to comment on issues

---

## 🔐 Security & Best Practices

### Environment Variables
- ✅ Never commit `.env` file to git
- ✅ Use `.gitignore` to exclude sensitive files
- ✅ Store secrets in Railway's environment variables
- ✅ Rotate tokens periodically (every 90 days recommended)

### MongoDB Security
- ✅ Use strong passwords
- ✅ Whitelist IP addresses or use 0.0.0.0/0 for cloud deployment
- ✅ Use connection string with SSL enabled
- ✅ Regular backups enabled on MongoDB Atlas

### Slack Security
- ✅ Request signing verification enabled
- ✅ Minimum required OAuth scopes
- ✅ Bot token (not user token)

### Jira Security
- ✅ API tokens instead of passwords
- ✅ Tokens scoped to specific user account
- ✅ Rotate tokens regularly
- ✅ Never share tokens in public repositories

---

## 🐛 Troubleshooting

### Common Issues

#### "dispatch_failed" error in Slack
- **Cause:** Slack can't reach your bot
- **Fix:** Check Railway logs, verify URLs in Slack settings match Railway domain

#### "signature mismatch" error
- **Cause:** Wrong `SLACK_SIGNING_SECRET`
- **Fix:** Copy correct secret from Slack → Update in Railway

#### Bot not responding
- **Cause:** Bot not running or wrong environment variables
- **Fix:** Check Railway logs for errors, verify all env vars are set

#### Decisions not persisting
- **Cause:** MongoDB connection failed
- **Fix:** Check `MONGODB_URI` is correct, verify MongoDB Atlas network access

#### Jira integration not working
- **Cause:** Missing or incorrect Jira credentials
- **Fix:** 
  1. Verify `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` are set in Railway
  2. Check Railway logs for "⚠️ Jira not configured" message
  3. Test Jira credentials manually by visiting the API URL
  4. Regenerate API token if necessary

#### Epic title not showing
- **Cause:** Jira credentials not configured or issue doesn't exist
- **Fix:** Check Railway logs for Jira fetch errors, verify issue key is correct

### Railway Logs

View logs: Railway Dashboard → Your Service → Deployments → View Logs

Look for:
- ✅ "Connected to MongoDB!"
- ✅ "Database ready!"
- ✅ "Bot running on port 3000!"
- ✅ "Fetching Jira: LOK-123"
- ✅ "Jira: [issue title]"
- ❌ Any error messages

---

## 📈 Roadmap

### Completed Features
- ✅ Slack bot with decision logging
- ✅ MongoDB persistent storage
- ✅ Web dashboard with filtering
- ✅ CSV export
- ✅ Jira integration (auto-fetch + comments)
- ✅ Cloud deployment on Railway

### Planned Features

#### Phase 3: Enhanced Jira Integration
- [ ] Bulk link decisions to epics
- [ ] Create Jira stories from decisions
- [ ] Show decisions in Jira panel (Jira app)
- [ ] Sync decision status with Jira status

#### Phase 4: Advanced Dashboard
- [ ] Decision timeline visualization
- [ ] Analytics charts (decisions over time, by creator)
- [ ] Decision impact tracking
- [ ] Custom filters and saved views

#### Phase 5: Notifications & Collaboration
- [ ] Weekly digest emails
- [ ] Slack notifications for epic updates
- [ ] Decision threads (updates/comments)
- [ ] @mentions and notifications
- [ ] Decision approval workflow

#### Phase 6: Integrations
- [ ] Figma integration (capture decisions from comments)
- [ ] Miro integration
- [ ] Confluence export
- [ ] Mobile app

---

## 👥 Team & Contact

**Created by:** Cristian Tumani  
**Repository:** https://github.com/cristiantumani/decision-logger-bot  
**Company:** Lokalise  
**Jira Instance:** https://lokalise.atlassian.net

---

## 📝 License

Private project - All rights reserved.

---

## 🙏 Acknowledgments

Built with:
- [Slack Bolt SDK](https://slack.dev/bolt-js/)
- [MongoDB](https://www.mongodb.com/)
- [Railway](https://railway.app/)
- [Node.js](https://nodejs.org/)
- [Jira REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)

---

## 📚 Additional Documentation

### Useful Links
- [Slack API Documentation](https://api.slack.com/)
- [MongoDB Atlas Documentation](https://docs.atlas.mongodb.com/)
- [Railway Documentation](https://docs.railway.app/)
- [Slack Bolt SDK Guide](https://slack.dev/bolt-js/tutorial/getting-started)
- [Jira REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)

### Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `/decision [text]` | Open form to log a decision | `/decision No bidirectional sync` |
| `/decisions recent` | Show 10 most recent decisions | `/decisions recent` |
| `/decisions search [keyword]` | Search by keyword | `/decisions search aem` |
| `/decisions epic [key]` | Find decisions by epic | `/decisions epic LOK-456` |

### Dashboard URL

```
https://decision-logger-bot-production.up.railway.app/dashboard
```

### API Endpoints

- `GET /api/decisions` - Get all decisions (with pagination & filters)
- `GET /api/stats` - Get decision statistics
- `GET /health` - Health check

---

## 🎓 Getting Started Guide

### For New Team Members

1. **Add the bot to your Slack channel:**
   ```
   /invite @Decision Logger
   ```

2. **Log your first decision:**
   ```
   /decision We decided to use React for the frontend
   ```

3. **Fill in the form:**
   - Type: Technical
   - Epic: (your Jira epic key)
   - Tags: react, frontend, architecture
   - Check "Add as Jira comment" if you want it documented in Jira

4. **View all decisions:**
   - Dashboard: https://decision-logger-bot-production.up.railway.app/dashboard
   - Or use `/decisions recent` in Slack

5. **Search for decisions:**
   ```
   /decisions search react
   /decisions epic YOUR-EPIC-KEY
   ```

### Best Practices

- ✅ Always tag decisions with relevant keywords
- ✅ Link decisions to Jira epics for traceability
- ✅ Include alternatives considered for context
- ✅ Use the Jira comment feature for important decisions
- ✅ Review the dashboard weekly to stay aligned
- ✅ Export to CSV for quarterly reviews

---

**Last Updated:** December 9, 2024  
**Version:** 2.0.0 (with Jira Integration)