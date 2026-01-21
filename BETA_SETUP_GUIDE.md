# 🚀 Corteza Beta Setup Guide

**Welcome, Beta Tester!** This guide will walk you through setting up Corteza in your Slack workspace.

**Time Required:** 45-60 minutes
**Cost:** Free tier available for all services
**Skill Level:** No coding required

---

## 📋 What You'll Need

- ✅ **Slack Workspace Admin Access** - To install apps and configure settings
- ✅ **Email Address** - For creating service accounts
- ✅ **Credit Card** - For API verification (free tiers available, minimal/no charges)
- ✅ **Domain (Optional)** - For custom dashboard URL (e.g., `app.yourcompany.com`)

---

## 🎯 What You're Building

By the end of this guide, your team will have:

- 🧠 **AI-powered decision logging** via Slack commands
- 📊 **Searchable knowledge base** with semantic search
- 🤖 **Automatic extraction** from meeting transcripts
- 🔗 **Jira integration** (optional, per-workspace)
- 🔐 **Role-based permissions** (Admin/Non-Admin)
- 📈 **Analytics dashboard** with team insights

---

## 🏗️ Setup Overview

```
Step 1: Create Slack App          [15 min]
Step 2: Set Up MongoDB Atlas       [10 min]
Step 3: Get API Keys               [10 min]
Step 4: Deploy to Railway          [10 min]
Step 5: Configure Slack OAuth      [5 min]
Step 6: Test Everything            [5 min]
```

---

## Step 1: Create Slack App (15 minutes)

### 1.1 Create the App

1. Go to **https://api.slack.com/apps**
2. Click **"Create New App"** → Select **"From scratch"**
3. **App Name:** `Corteza` (or your preferred name)
4. **Workspace:** Select your workspace
5. Click **"Create App"**

---

### 1.2 Configure OAuth Scopes

1. Go to **"OAuth & Permissions"** in the left sidebar
2. Scroll to **"Scopes"** section
3. Click **"Add an OAuth Scope"** and add these **Bot Token Scopes:**

```
channels:history
channels:read
chat:write
chat:write.public
commands
files:read
groups:history
im:history
mpim:history
users:read
users:read.email    ← Required for dashboard authentication
```

4. Scroll to **"Redirect URLs"** section
5. Click **"Add New Redirect URL"** and add:
```
https://temporary-url.com/slack/oauth_redirect
```
   *(We'll update this with your Railway URL later)*

6. Click **"Save URLs"**

7. Scroll to top and click **"Install to Workspace"**
8. Click **"Allow"**
9. **Copy the "Bot User OAuth Token"** (starts with `xoxb-`) - Save this

---

### 1.3 Get App Credentials

1. Go to **"Basic Information"** in left sidebar
2. Scroll to **"App Credentials"**
3. **Copy and save** these three values:
   - **Client ID** (e.g., `1234567890.1234567890`)
   - **Client Secret** (click "Show" to reveal)
   - **Signing Secret** (click "Show" to reveal)

---

### 1.4 Add Slash Commands

1. Go to **"Slash Commands"** in left sidebar
2. Click **"Create New Command"** for each command below:

**Command 1: /decision**
```
Command: /decision
Request URL: https://temporary-url.com/slack/events
Short Description: Log a new decision or explanation
Usage Hint: [what was decided]
```

**Command 2: /memory**
```
Command: /memory
Request URL: https://temporary-url.com/slack/events
Short Description: Log to team memory (alias for /decision)
Usage Hint: [information to remember]
```

**Command 3: /decisions**
```
Command: /decisions
Request URL: https://temporary-url.com/slack/events
Short Description: Search and view team memories
Usage Hint: search [query]
```

**Command 4: /login**
```
Command: /login
Request URL: https://temporary-url.com/slack/events
Short Description: Get dashboard login link
Usage Hint: (no parameters)
```

**Command 5: /settings**
```
Command: /settings
Request URL: https://temporary-url.com/slack/events
Short Description: Configure Jira integration (admins only)
Usage Hint: (no parameters)
```

**Command 6: /permissions**
```
Command: /permissions
Request URL: https://temporary-url.com/slack/events
Short Description: Manage admin permissions (admins only)
Usage Hint: list | grant @user | revoke @user
```

Click **"Save"** after creating each command.

---

### 1.5 Enable Interactivity

1. Go to **"Interactivity & Shortcuts"** in left sidebar
2. Toggle **"Interactivity"** to **ON**
3. **Request URL:** `https://temporary-url.com/slack/events`
4. Click **"Save Changes"**

---

### 1.6 Subscribe to Events

1. Go to **"Event Subscriptions"** in left sidebar
2. Toggle **"Enable Events"** to **ON**
3. **Request URL:** `https://temporary-url.com/slack/events`
   *(Don't worry about verification failure yet - we'll fix this later)*
4. Scroll to **"Subscribe to bot events"** and add:

```
file_shared
```

5. Click **"Save Changes"**

---

## Step 2: Set Up MongoDB Atlas (10 minutes)

### 2.1 Create Account & Cluster

1. Go to **https://www.mongodb.com/cloud/atlas/register**
2. Sign up with email or Google
3. Click **"Create"** to create a new cluster
4. Select **FREE** tier (M0 Sandbox)
5. **Cloud Provider:** AWS (recommended)
6. **Region:** Choose closest to your team
7. **Cluster Name:** `corteza-prod`
8. Click **"Create Deployment"**

---

### 2.2 Configure Database Access

1. You'll see a "Security Quickstart" modal
2. **Authentication Method:** Username and Password
3. **Username:** `dbuser`
4. **Password:** Click **"Autogenerate Secure Password"**
   - **COPY THE PASSWORD** - You'll need this!
5. Click **"Create Database User"**

---

### 2.3 Configure Network Access

1. In the same modal, go to **"Choose a connection method"**
2. Click **"Add entries to your IP Access List"**
3. Click **"Allow Access from Anywhere"**
   - Description: `Railway & Dev`
4. Click **"Add Entry"**
5. Click **"Finish and Close"**

---

### 2.4 Get Connection String

1. Click **"Database"** in left sidebar
2. Click **"Connect"** button on your cluster
3. Select **"Drivers"**
4. **Driver:** Node.js
5. **Version:** Latest
6. **Copy the connection string** (looks like: `mongodb+srv://dbuser:<password>@...`)
7. **IMPORTANT:** Replace `<password>` with your actual database password (from step 2.2)
8. Replace `<dbname>` with `decision-logger`
9. Save this full connection string

**Example:**
```
mongodb+srv://dbuser:MySecurePassword123@corteza-prod.abcde.mongodb.net/decision-logger?retryWrites=true&w=majority
```

---

### 2.5 Create Vector Search Index (for Semantic Search)

1. Click on your cluster name
2. Go to **"Search"** tab
3. Click **"Create Search Index"**
4. Select **"JSON Editor"**
5. **Index Name:** `vector_search_index`
6. **Database:** `decision-logger`
7. **Collection:** `decisions`
8. Paste this JSON:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "workspace_id"
    },
    {
      "type": "filter",
      "path": "type"
    }
  ]
}
```

9. Click **"Create Search Index"**
10. Wait for status to show **"Active"** (2-5 minutes)

---

## Step 3: Get API Keys (10 minutes)

### 3.1 Anthropic API Key (Claude AI - Required)

1. Go to **https://console.anthropic.com/**
2. Sign up for an account
3. Go to **"API Keys"** in the dashboard
4. Click **"Create Key"**
5. **Name:** `corteza-production`
6. **Copy the key** (starts with `sk-ant-`)
7. **Add credits:** Go to Billing → Add at least **$5** in credits
   - This should last months for a small team

---

### 3.2 OpenAI API Key (Embeddings - Optional but Recommended)

1. Go to **https://platform.openai.com/signup**
2. Sign up for an account
3. Go to **https://platform.openai.com/api-keys**
4. Click **"Create new secret key"**
5. **Name:** `corteza-embeddings`
6. **Copy the key** (starts with `sk-proj-` or `sk-`)
7. **Add billing:**
   - Go to Settings → Billing
   - Add payment method
   - Cost is minimal (~$0.01-0.10/month for embeddings)

**Note:** If you skip OpenAI, semantic search will be disabled (basic search still works).

---

### 3.3 Jira API Token (Optional - Per-Workspace)

**NEW:** Jira is now configured per-workspace using `/settings` command. You don't need to set it up during installation!

**When to set it up:**
- After installation is complete
- When you want to link decisions to Jira epics
- Using `/settings` command in Slack (admins only)

**If you want to prepare credentials:**
1. Go to **https://id.atlassian.com/manage-profile/security/api-tokens**
2. Click **"Create API token"**
3. **Label:** `corteza-jira`
4. Copy and save:
   - Your Jira URL (e.g., `https://yourcompany.atlassian.net`)
   - Your Jira email
   - The API token

---

## Step 4: Deploy to Railway (10 minutes)

### 4.1 Create Railway Account

1. Go to **https://railway.app/**
2. Click **"Start a New Project"**
3. Sign in with **GitHub**
4. Authorize Railway

---

### 4.2 Fork the Repository

1. Go to **https://github.com/cristiantumani/corteza.app**
2. Click **"Fork"** in the top right
3. Select your account
4. Wait for fork to complete

---

### 4.3 Deploy from GitHub

1. In Railway, click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Click **"Configure GitHub App"**
4. Select your account/organization
5. Choose **"Only select repositories"**
6. Select your forked `corteza.app` repository
7. Click **"Install & Authorize"**
8. Back in Railway, select your `corteza.app` repository
9. Click **"Deploy Now"**

Railway will automatically:
- Detect it's a Node.js app
- Install dependencies
- Start the deployment

---

### 4.4 Generate Environment Secrets

**Generate these on your local machine** (Mac/Linux terminal or Windows PowerShell):

```bash
# SESSION_SECRET (for cookie encryption)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# SLACK_STATE_SECRET (for OAuth CSRF protection)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ENCRYPTION_KEY (for Jira token encryption)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Save all three outputs** - you'll need them in the next step.

---

### 4.5 Add Environment Variables

1. Click on your deployed service in Railway
2. Go to **"Variables"** tab
3. Click **"New Variable"** or **"Raw Editor"**
4. **Paste this template** and fill in your actual values:

```bash
# ===============================================
# SLACK CONFIGURATION
# ===============================================
SLACK_BOT_TOKEN=xoxb-YOUR-BOT-TOKEN-HERE
SLACK_SIGNING_SECRET=YOUR-SIGNING-SECRET-HERE
SLACK_CLIENT_ID=YOUR-CLIENT-ID-HERE
SLACK_CLIENT_SECRET=YOUR-CLIENT-SECRET-HERE

# ===============================================
# SECURITY SECRETS (Generated in step 4.4)
# ===============================================
SESSION_SECRET=your-generated-session-secret-here
SLACK_STATE_SECRET=your-generated-state-secret-here
ENCRYPTION_KEY=your-generated-encryption-key-here

# ===============================================
# DATABASE
# ===============================================
MONGODB_URI=mongodb+srv://dbuser:YourPassword@corteza-prod.xxxxx.mongodb.net/decision-logger?retryWrites=true&w=majority

# ===============================================
# AI SERVICES
# ===============================================
ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE
OPENAI_API_KEY=sk-proj-YOUR-KEY-HERE

# ===============================================
# APPLICATION SETTINGS
# ===============================================
PORT=3000
NODE_ENV=production

# ===============================================
# OPTIONAL: Custom Domain (Add after Step 6)
# ===============================================
# APP_BASE_URL=app.yourcompany.com
```

5. Click **"Add"** or save the variables
6. Railway will automatically redeploy

---

### 4.6 Generate Public URL

1. Still in Railway, go to **"Settings"** tab
2. Scroll to **"Networking"** section
3. Click **"Generate Domain"**
4. **Copy your Railway URL** (e.g., `decision-logger-production-abcd.up.railway.app`)

**Save this URL** - you'll need it in the next step!

---

### 4.7 Update Slack App URLs

Now go back to Slack and update all temporary URLs with your Railway URL.

1. Go to **https://api.slack.com/apps** → Select your app

2. **OAuth & Permissions** → Redirect URLs:
   - Remove the temporary URL
   - Add: `https://YOUR-RAILWAY-URL.up.railway.app/slack/oauth_redirect`
   - Click **"Save URLs"**

3. **Slash Commands** → Edit each command:
   - Update Request URL to: `https://YOUR-RAILWAY-URL.up.railway.app/slack/events`
   - Click **"Save"** for each

4. **Interactivity & Shortcuts**:
   - Update Request URL to: `https://YOUR-RAILWAY-URL.up.railway.app/slack/events`
   - Click **"Save Changes"**

5. **Event Subscriptions**:
   - Update Request URL to: `https://YOUR-RAILWAY-URL.up.railway.app/slack/events`
   - You should see **"Verified ✓"** next to the URL
   - Click **"Save Changes"**

---

## Step 5: Verify Deployment (2 minutes)

### 5.1 Check Railway Logs

1. In Railway → **"Deployments"** tab
2. Click on the latest deployment
3. Check the logs - you should see:

```
✅ Using OAuth mode (multi-workspace support)
✅ Environment variables validated
✅ Installation store connected to MongoDB
⚡️ Bot running on port 3000!
✅ Connected to MongoDB!
```

If you see errors, check:
- All environment variables are set correctly
- MongoDB connection string has the right password
- No typos in variable names

---

## Step 6: Test Everything (5 minutes)

### 6.1 Test Slash Commands

1. Open Slack
2. Go to any channel or DM
3. Type: `/decision`
4. You should see a modal: **"🧠 Add to Team Memory"**
5. Fill it out:
   - **Content:** "We decided to use Corteza for team memory"
   - **Type:** Decision
   - **Category:** Product
   - **Tags:** onboarding, tool
6. Click **"Submit"**
7. You should see: "✅ Logged to team memory as #1"

---

### 6.2 Test Dashboard Login

1. In Slack, type: `/login`
2. Click the dashboard link in the response
3. Click **"Login with Slack"**
4. Authorize the app
5. You should see the **Corteza Dashboard** with your decision

---

### 6.3 Test Permission System

1. In Slack, type: `/permissions list`
2. You should see yourself listed as admin (auto-promoted as Workspace Admin)
3. Try: `/permissions help` to see available commands

---

### 6.4 Test Semantic Search (if OpenAI configured)

1. In the dashboard, click the **purple chat bubble** (bottom right)
2. Type: "Show me all decisions"
3. You should get an AI-powered response

---

### 6.5 Test AI Transcript Extraction

1. Create a test transcript file (`meeting-notes.txt`):

```
Meeting Notes - Jan 21, 2026

Today we decided to use React for the frontend because of its large ecosystem
and our team's familiarity with it. We considered Vue as an alternative but
chose React for its better TypeScript support.

The API authentication will work by sending JWT tokens in the Authorization
header. This follows industry best practices and integrates well with our
existing auth system.

Context: We're building a new customer portal that needs to be launched by Q2.
The project timeline is tight so we're prioritizing speed of development.
```

2. Upload this file to any Slack channel where Corteza is present
3. Wait 5-10 seconds
4. You should see a message: **"🤖 Found 3 items in this transcript"**
5. Review and approve the suggestions
6. Check dashboard - approved items should appear

---

## 🎉 Success! What's Next?

### Set Up Your Team

**1. Configure Jira (Optional):**
```
/settings
```
- Fill in your Jira URL, email, and API token
- Test the connection
- Now decisions can be linked to Jira epics!

**2. Grant Admin Access:**
```
/permissions grant @teammate
```
- Workspace Admins are auto-promoted
- You can manually promote others as needed

**3. Invite Your Team:**
- Add Corteza to relevant Slack channels
- Share these commands:
  - `/decision` - Log a new decision
  - `/memory` - Log any team knowledge
  - `/decisions` - Search the knowledge base
  - `/login` - Access the dashboard

**4. Start Logging:**
- Use `/decision` after important discussions
- Upload meeting transcripts for AI extraction
- Link decisions to Jira epics (if configured)
- Use dashboard for searching and analytics

---

## 🔐 Understanding Permissions

Corteza has a simple 2-tier permission system:

### Admins Can:
- ✅ Configure Jira settings (`/settings`)
- ✅ Edit/delete ANY decision
- ✅ Grant admin access to others (`/permissions grant`)
- ✅ Revoke admin access (`/permissions revoke`)
- ✅ View all analytics

### Non-Admins Can:
- ✅ View all decisions (read-only for others')
- ✅ Create new decisions
- ✅ Edit/delete THEIR OWN decisions only
- ✅ Use semantic search
- ✅ Review AI suggestions

### Auto-Promotion:
- Slack Workspace Admins/Owners are automatically promoted to app Admins
- This happens on their first interaction with the app

---

## 🐛 Troubleshooting

### "Dispatch failed" error

**Problem:** Slack can't reach Railway
**Fix:**
- Check Railway deployment is successful
- Verify all Slack URLs are updated
- Check Railway logs for errors

### "Semantic search disabled" message

**Problem:** OpenAI not configured
**Fix:**
- Add `OPENAI_API_KEY` to Railway variables
- Verify you've added billing to OpenAI account
- Redeploy in Railway

### Dashboard shows "Authentication required"

**Problem:** OAuth not configured
**Fix:**
- Check `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_STATE_SECRET`
- Verify OAuth redirect URL is correct
- Check Railway redeployed after adding variables

### Vector search not working

**Problem:** MongoDB index not ready
**Fix:**
- Check index status is "Active" in MongoDB Atlas
- Verify index name is `vector_search_index`
- Wait 5 minutes after creating index

### MongoDB connection errors

**Problem:** Can't connect to database
**Fix:**
- Verify password in connection string is correct
- Check IP allowlist includes "Allow from Anywhere"
- Ensure database name is `decision-logger`

### "/permissions" shows permission denied

**Problem:** Not recognized as admin
**Fix:**
- Verify you're a Workspace Admin/Owner in Slack
- Try running any command first to trigger auto-promotion
- Check Railway logs for errors

---

## 💰 Expected Monthly Costs

For a team of ~10 people logging ~100 decisions/month:

| Service | Plan | Cost |
|---------|------|------|
| MongoDB Atlas | M0 Free Tier | **$0** |
| Railway | Hobby | **$5** |
| OpenAI (embeddings) | Pay-as-you-go | **~$0.05** |
| Anthropic (Claude) | Pay-as-you-go | **~$2-5** |
| **Total** | | **~$7-10/month** |

**Free tier options:**
- Railway: 500 execution hours/month free (about 3 weeks)
- OpenAI: First $5 in credits free for new accounts
- MongoDB: M0 tier is free forever

---

## 🎯 Optional: Set Up Custom Domain

Make your dashboard professional: `app.yourcompany.com` instead of Railway URL.

### Requirements:
- Own a domain (Namecheap, GoDaddy, Cloudflare, etc.)
- Access to DNS settings

### Steps:

**1. Add DNS Record:**
Go to your domain registrar:
```
Type: CNAME
Name: app (or your preferred subdomain)
Value: decision-logger-production-abcd.up.railway.app
TTL: 3600
```

**2. Add Custom Domain in Railway:**
- Settings → Networking
- Click "Custom Domain"
- Enter: `app.yourcompany.com`
- Wait for SSL certificate (2-10 minutes)

**3. Update Environment Variable:**
```bash
APP_BASE_URL=app.yourcompany.com
```

**4. Update Slack URLs:**
- Replace all Railway URLs with your custom domain
- OAuth redirect, slash commands, events, interactivity

**5. Test:**
- `/login` should use your custom domain
- Dashboard should be at `https://app.yourcompany.com/dashboard`

---

## 📊 Monitoring Your Deployment

### Railway Dashboard
- **Deployments:** Check build status and logs
- **Metrics:** CPU, memory, network usage
- **Logs:** Real-time application logs

### MongoDB Atlas
- **Metrics:** Database operations, storage
- **Performance Advisor:** Query optimization suggestions
- **Alerts:** Set up alerts for issues

### Slack App Health
- Check **Event Subscriptions** for delivery success rate
- Monitor slash command usage in Slack analytics

---

## 📚 Quick Reference

### Slack Commands
```
/decision         Log a new decision/explanation/context
/memory           Alias for /decision
/decisions        Search and view team memories
/login            Get dashboard login link
/settings         Configure Jira (admins only)
/permissions      Manage admin access (admins only)
```

### Permission Commands
```
/permissions list           View all admins
/permissions grant @user    Promote user to admin
/permissions revoke @user   Remove admin access
/permissions help           Show help
```

### Dashboard Features
- **Browse:** View all decisions with filters
- **Search:** Semantic search with AI
- **Chat:** Ask questions about your knowledge base
- **Analytics:** Team insights and AI metrics
- **Export:** GDPR-compliant data export

---

## 💬 Feedback & Support

We're actively improving Corteza based on beta tester feedback!

**Report Issues:**
- GitHub: https://github.com/cristiantumani/corteza.app/issues
- Email: cristiantumani@gmail.com

**Share Feedback:**
- What features do you love?
- What's confusing or broken?
- What would make this more useful?

---

## ✅ Setup Complete!

You should now have:
- ✅ Corteza installed in Slack
- ✅ Database connected and running
- ✅ AI-powered features working
- ✅ Dashboard accessible
- ✅ Permission system active
- ✅ Team can start logging decisions

**Next steps:**
1. Share `/decision` command with your team
2. Upload a meeting transcript to test AI extraction
3. Configure Jira if needed (`/settings`)
4. Grant admin access to key team members

**Welcome to Corteza! 🎉**

---

**Made with ❤️ for teams who learn from their decisions**
