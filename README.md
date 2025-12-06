# Decision Logger Bot

A Slack bot that helps Product Managers track and manage decisions made during the discovery, refinement, and development process. Never lose context on why decisions were made again.

## 📋 Overview

**The Problem:**
During product discovery and refinement, teams make important decisions across multiple tools (Figma, Jira, Miro, Slack). These decisions get scattered, forgotten, or disconnected from the user stories that implement them.

**The Solution:**
Decision Logger captures decisions where they happen (Slack) and stores them in a centralized, searchable database with context about why, when, and who made each decision.

---

## 🚀 Features

### Current Features (v1.0)
- ✅ **Slack Commands**
  - `/decision [text]` - Opens a form to log a decision
  - `/decisions recent` - Shows the 10 most recent decisions
  - `/decisions search [keyword]` - Search decisions by text, tags, or epic
  - `/decisions epic [JIRA-123]` - Find all decisions related to a specific epic

- ✅ **Decision Metadata**
  - Decision type (Product, UX, Technical)
  - Epic/Story key (e.g., JIRA-123)
  - Tags (comma-separated for easy filtering)
  - Alternatives considered
  - Creator and timestamp

- ✅ **Persistent Storage**
  - All decisions stored in MongoDB
  - Survives bot restarts
  - Full-text search capability

- ✅ **Cloud Deployment**
  - Runs 24/7 on Railway
  - No local setup needed after deployment
  - Automatic scaling

---

## 🛠️ Tech Stack

### Core Technologies
- **Runtime:** Node.js (v18+)
- **Framework:** Slack Bolt SDK (@slack/bolt)
- **Database:** MongoDB Atlas (Free tier)
- **Hosting:** Railway (Cloud platform)
- **Version Control:** Git + GitHub

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
├── index.js                 # Main bot application
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

| Variable | Description | Example |
|----------|-------------|---------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token from Slack | `xoxb-1234567890...` |
| `SLACK_SIGNING_SECRET` | Signing secret from Slack app settings | `abc123def456...` |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/...` |
| `PORT` | Port for the web server | `3000` |

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

---

## 🔧 Local Development Setup

### Prerequisites
- Node.js v18 or higher
- npm (comes with Node.js)
- MongoDB Atlas account (free)
- Slack workspace with admin access

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
   - Add environment variables in Railway dashboard
   - Generate a domain

3. **Update Slack URLs**
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
  epic_key: String | null,          // e.g., "JIRA-123", "LOK-456"
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

---

## 📊 Usage Examples

### Logging a Decision
```
/decision We will only sync AEM → Lokalise, not bidirectional
```
This opens a modal where you fill in:
- **Type:** Product
- **Epic:** LOK-456
- **Tags:** aem, integration, scope
- **Alternatives:** Considered bidirectional sync but decided against due to resource constraints

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

## 🔐 Security & Best Practices

### Environment Variables
- ✅ Never commit `.env` file to git
- ✅ Use `.gitignore` to exclude sensitive files
- ✅ Store secrets in Railway's environment variables
- ✅ Rotate tokens periodically

### MongoDB Security
- ✅ Use strong passwords
- ✅ Whitelist IP addresses (or use 0.0.0.0/0 for cloud deployment)
- ✅ Use connection string with SSL enabled
- ✅ Regular backups enabled on MongoDB Atlas

### Slack Security
- ✅ Request signing verification enabled
- ✅ Minimum required OAuth scopes
- ✅ Bot token (not user token)

---

## 🐛 Troubleshooting

### Common Issues

#### "dispatch_failed" error in Slack
- **Cause:** Slack can't reach your bot
- **Fix:** Check Railway logs, verify URLs in Slack settings

#### "signature mismatch" error
- **Cause:** Wrong `SLACK_SIGNING_SECRET`
- **Fix:** Copy correct secret from Slack → Update in Railway

#### Bot not responding
- **Cause:** Bot not running or wrong environment variables
- **Fix:** Check Railway logs for errors, verify all env vars are set

#### Decisions not persisting
- **Cause:** MongoDB connection failed
- **Fix:** Check `MONGODB_URI` is correct, check MongoDB Atlas network access

### Railway Logs
View logs: Railway Dashboard → Your Service → Deployments → View Logs

Look for:
- ✅ "Connected to MongoDB!"
- ✅ "Decision Logger bot is running on port 3000!"
- ❌ Any error messages

---

## 📈 Roadmap

### Planned Features

#### Phase 2: Web Dashboard (Next)
- [ ] Web interface to view all decisions
- [ ] Advanced filtering and search
- [ ] Export to CSV
- [ ] Decision analytics and visualizations

#### Phase 3: Jira Integration
- [ ] Link decisions to Jira issues
- [ ] Show related decisions in Jira
- [ ] Auto-fetch epic information

#### Phase 4: Enhanced Features
- [ ] Edit/delete decisions
- [ ] Decision threads (updates/comments)
- [ ] Weekly digest notifications
- [ ] Figma and Miro integrations

---

## 👥 Team & Contact

**Created by:** Cristian Tumani  
**Repository:** https://github.com/cristiantumani/decision-logger-bot  
**Slack Workspace:** [Your Workspace Name]

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

---

## 📚 Additional Documentation

### Useful Links
- [Slack API Documentation](https://api.slack.com/)
- [MongoDB Atlas Documentation](https://docs.atlas.mongodb.com/)
- [Railway Documentation](https://docs.railway.app/)
- [Slack Bolt SDK Guide](https://slack.dev/bolt-js/tutorial/getting-started)

### Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `/decision [text]` | Open form to log a decision | `/decision No bidirectional sync` |
| `/decisions recent` | Show 10 most recent decisions | `/decisions recent` |
| `/decisions search [keyword]` | Search by keyword | `/decisions search aem` |
| `/decisions epic [key]` | Find decisions by epic | `/decisions epic LOK-456` |

---

**Last Updated:** December 6, 2024  
**Version:** 1.0.0