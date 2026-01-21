# Corteza - Quick Start for Beta Testers

**TL;DR Setup Guide** - Get Corteza running in ~30 minutes

Full guide: **[BETA_SETUP_GUIDE.md](BETA_SETUP_GUIDE.md)**

---

## ✅ Checklist

- [ ] Create Slack App with 6 commands
- [ ] Set up MongoDB Atlas (free tier)
- [ ] Get Anthropic API key ($5 credit)
- [ ] Get OpenAI API key (optional, ~$0.10/month)
- [ ] Deploy to Railway (free trial or $5/month)
- [ ] Configure OAuth and test

---

## 🚀 5-Step Setup

### 1. Create Slack App (10 min)

**https://api.slack.com/apps** → Create App → From scratch

**Add Scopes** (OAuth & Permissions):
```
channels:history, channels:read, chat:write, chat:write.public
commands, files:read, groups:history, im:history, mpim:history
users:read, users:read.email
```

**Add Slash Commands** (Request URL: use temporary URL, update later):
```
/decision    - Log a new decision
/memory      - Log to team memory
/decisions   - Search memories
/login       - Get dashboard link
/settings    - Configure Jira (admins)
/permissions - Manage permissions (admins)
```

**Enable**:
- Interactivity & Shortcuts
- Event Subscriptions (add `file_shared` event)

**Copy**:
- Bot User OAuth Token (`xoxb-...`)
- Client ID, Client Secret, Signing Secret

---

### 2. MongoDB Atlas (5 min)

**https://mongodb.com/cloud/atlas/register** → Create Free Cluster

**Setup:**
1. Create database user (save password!)
2. Allow access from anywhere (IP allowlist)
3. Copy connection string, replace `<password>` and `<dbname>` with `decision-logger`

**Vector Search Index:**
- Database: `decision-logger`
- Collection: `decisions`
- Index name: `vector_search_index`
- JSON:
```json
{
  "fields": [
    {"type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine"},
    {"type": "filter", "path": "workspace_id"},
    {"type": "filter", "path": "type"}
  ]
}
```

---

### 3. Get API Keys (5 min)

**Anthropic (Required):**
- https://console.anthropic.com → API Keys → Create
- Add $5 credits (lasts months for small team)

**OpenAI (Optional but recommended):**
- https://platform.openai.com/api-keys → Create
- Add billing method (~$0.10/month)

---

### 4. Deploy to Railway (10 min)

**https://railway.app** → Sign in with GitHub → New Project

**Fork repo:**
https://github.com/cristiantumani/corteza.app → Fork

**Deploy:**
1. Deploy from GitHub → Select your fork
2. Add Variables (click "Raw Editor"):

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...

# Security (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SESSION_SECRET=<generate>
SLACK_STATE_SECRET=<generate>
ENCRYPTION_KEY=<generate>

# Database
MONGODB_URI=mongodb+srv://dbuser:password@...

# AI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...

# App
PORT=3000
NODE_ENV=production
```

3. Settings → Networking → Generate Domain
4. Copy Railway URL (e.g., `xyz.up.railway.app`)

---

### 5. Update Slack URLs (5 min)

**In Slack App Settings:**

1. **OAuth & Permissions** → Redirect URLs:
   ```
   https://your-railway-url.up.railway.app/slack/oauth_redirect
   ```

2. **Update ALL Request URLs** to:
   ```
   https://your-railway-url.up.railway.app/slack/events
   ```
   - Slash Commands (all 6)
   - Interactivity & Shortcuts
   - Event Subscriptions (should verify ✓)

---

## ✅ Test It

**In Slack:**
```
/decision We're using Corteza for team memory
```

**Dashboard:**
```
/login
```
→ Click link → Authorize → See your dashboard!

**Permissions:**
```
/permissions list
```
→ You should be auto-promoted as admin

**Jira (Optional):**
```
/settings
```
→ Configure your Jira instance

---

## 🎯 What Your Team Gets

### Commands
```
/decision or /memory    Log decisions, explanations, context
/decisions              Search your knowledge base
/login                  Access web dashboard
/settings               Configure Jira (admins only)
/permissions            Manage admin roles
```

### Features
- ✅ AI-powered transcript extraction (upload files to Slack)
- ✅ Semantic search (ask questions in natural language)
- ✅ Jira integration (link decisions to epics)
- ✅ Permission system (admins can edit any, users edit own)
- ✅ Analytics dashboard (team insights)

---

## 🔐 Permissions

**Admins (auto-assigned to Slack Admins):**
- Configure Jira settings
- Edit/delete ANY decision
- Grant/revoke admin access

**Non-Admins:**
- View all decisions
- Create new decisions
- Edit/delete THEIR OWN decisions only

**Grant admin:**
```
/permissions grant @teammate
```

---

## 🐛 Common Issues

**"Dispatch failed"**
→ Check Railway deployed successfully, verify Slack URLs updated

**"Semantic search disabled"**
→ Add `OPENAI_API_KEY` to Railway, redeploy

**"Authentication required"**
→ Check OAuth credentials in Railway, verify redirect URL

**MongoDB connection error**
→ Check password in connection string, verify IP allowlist

---

## 💰 Expected Costs

Small team (~10 people, ~100 decisions/month):

| Service | Cost |
|---------|------|
| MongoDB | **Free** (M0 tier) |
| Railway | **$5/month** (Hobby) or Free trial |
| OpenAI | **~$0.05/month** |
| Anthropic | **~$2-5/month** |
| **Total** | **~$7-10/month** |

---

## 📚 Full Documentation

- **Complete Setup:** [BETA_SETUP_GUIDE.md](BETA_SETUP_GUIDE.md)
- **Features:** [README.md](README.md)
- **Recent Changes:** [CHANGELOG.md](CHANGELOG.md)
- **Troubleshooting:** See full guide

---

## 💬 Support

**Issues:**
- GitHub: https://github.com/cristiantumani/corteza.app/issues
- Email: cristiantumani@gmail.com

**Feedback:**
We're actively improving! Share what's working and what's not.

---

## 🎉 Success!

You should now have:
- ✅ Corteza running in Slack
- ✅ AI-powered decision logging
- ✅ Searchable knowledge base
- ✅ Admin permissions set up

**Next:** Share `/decision` with your team and start building your knowledge base!

---

**Made with ❤️ for teams who learn from their decisions**
