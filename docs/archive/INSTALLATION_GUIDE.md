# Corteza - Installation Guide for Beta Testers

Welcome! This guide will walk you through installing Corteza in your Slack workspace.

**Time Required:** ~30-45 minutes
**Cost:** Free tier available for all services (MongoDB, Railway, OpenAI, Anthropic)

---

## 📋 What You'll Need

Before starting, ensure you have:
- ✅ **Slack workspace admin access** (to install apps)
- ✅ **Email address** (for creating accounts)
- ✅ **Credit card** (for API verification - free tiers available, minimal/no charges expected)

---

## 🚀 Step-by-Step Installation

### Step 1: Create a Slack App (10 minutes)

1. **Go to Slack API:** https://api.slack.com/apps
2. **Click "Create New App"** → Select "From scratch"
3. **Name your app:** `corteza.app` (or any name you prefer)
4. **Select your workspace** from the dropdown
5. **Click "Create App"**

#### Configure Basic Information

1. Navigate to **"OAuth & Permissions"** in the left sidebar
2. Scroll to **"Scopes"** section
3. Add these **Bot Token Scopes:**
   ```
   channels:history
   channels:read
   chat:write
   commands
   files:read
   groups:history
   groups:read
   im:history
   mpim:history
   users:read
   ```

4. Scroll to top and click **"Install to Workspace"**
5. Click **"Allow"**
6. **Copy the "Bot User OAuth Token"** (starts with `xoxb-`) - you'll need this later

#### Add Slash Commands

1. Go to **"Slash Commands"** in left sidebar
2. Click **"Create New Command"**
3. Add these commands one by one:

   **Command 1:**
   - Command: `/decision`
   - Request URL: `https://your-app-url.up.railway.app/slack/events` (we'll update this later)
   - Short Description: `Log a new decision`
   - Click "Save"

   **Command 2:**
   - Command: `/decisions`
   - Request URL: `https://your-app-url.up.railway.app/slack/events`
   - Short Description: `Search and view decisions`
   - Click "Save"

#### Configure Interactivity

1. Go to **"Interactivity & Shortcuts"** in left sidebar
2. Toggle **"Interactivity"** to **ON**
3. Request URL: `https://your-app-url.up.railway.app/slack/events` (we'll update later)
4. Click **"Save Changes"**

#### Enable Events

1. Go to **"Event Subscriptions"** in left sidebar
2. Toggle **"Enable Events"** to **ON**
3. Request URL: `https://your-app-url.up.railway.app/slack/events` (we'll update later)
4. Expand **"Subscribe to bot events"** and add:
   ```
   file_shared
   message.channels
   message.groups
   message.im
   message.mpim
   ```
5. Click **"Save Changes"**

#### Get Signing Secret

1. Go to **"Basic Information"** in left sidebar
2. Scroll to **"App Credentials"**
3. **Copy the "Signing Secret"** - you'll need this later

---

### Step 2: Set Up MongoDB Atlas (10 minutes)

1. **Go to:** https://www.mongodb.com/cloud/atlas/register
2. **Sign up** for a free account
3. **Create a cluster:**
   - Select **FREE** tier (M0)
   - Choose a cloud provider (AWS recommended)
   - Choose region closest to you
   - Cluster name: `corteza` (or any name)
   - Click **"Create"**

4. **Set up database access:**
   - Click **"Database Access"** in left sidebar
   - Click **"Add New Database User"**
   - Authentication: **Password**
   - Username: `dbuser` (or your choice)
   - Password: Click "Autogenerate Secure Password" and **copy it**
   - User Privileges: **Atlas admin**
   - Click **"Add User"**

5. **Set up network access:**
   - Click **"Network Access"** in left sidebar
   - Click **"Add IP Address"**
   - Click **"Allow Access from Anywhere"** (for simplicity)
   - Click **"Confirm"**

6. **Get connection string:**
   - Click **"Database"** in left sidebar
   - Click **"Connect"** on your cluster
   - Select **"Connect your application"**
   - Copy the connection string (looks like: `mongodb+srv://...`)
   - Replace `<password>` with your actual database password
   - Replace `<dbname>` with `decision-logger`
   - **Save this connection string** - you'll need it later

7. **Set up Vector Search Index (for semantic search):**
   - Click on your cluster name
   - Go to **"Search"** tab → **"Create Search Index"**
   - Select **"JSON Editor"**
   - Index Name: `vector_search_index`
   - Database: `decision-logger`
   - Collection: `decisions`
   - Paste this JSON:
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
       },
       {
         "type": "filter",
         "path": "timestamp"
       }
     ]
   }
   ```
   - Click **"Create Search Index"**
   - Wait for status to show **"READY"** (can take 2-5 minutes)

---

### Step 3: Get API Keys (10 minutes)

#### Jira API Token (Optional - for Jira integration)

1. **Go to:** https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **"Create API token"**
3. Label: `corteza.app`
4. Click **"Create"**
5. **Copy the token** - you'll need:
   - Your Jira URL (e.g., `https://yourcompany.atlassian.net`)
   - Your Jira email
   - This API token

#### Anthropic API Key (For Claude AI)

1. **Go to:** https://console.anthropic.com/
2. **Sign up** for an account
3. Go to **"API Keys"**
4. Click **"Create Key"**
5. Name: `corteza.app`
6. **Copy the key** (starts with `sk-ant-`)
7. **Add credits:** You'll need to add at least $5 in credits to use the API

#### OpenAI API Key (For semantic search)

1. **Go to:** https://platform.openai.com/signup
2. **Sign up** for an account
3. Go to **"API Keys"**: https://platform.openai.com/api-keys
4. Click **"Create new secret key"**
5. Name: `corteza.app`
6. **Copy the key** (starts with `sk-proj-`)
7. **Add billing:** Add payment method in Billing section (minimal costs - embeddings are ~$0.0001 per decision)

---

### Step 4: Deploy to Railway (10 minutes)

1. **Go to:** https://railway.app/
2. **Sign up** with GitHub
3. Click **"New Project"**
4. Select **"Deploy from GitHub repo"**
5. Click **"Configure GitHub App"**
6. **Fork the repository first:**
   - Go to: https://github.com/cristiantumani/corteza.app
   - Click **"Fork"** in the top right
   - Select your account

7. **Back in Railway:**
   - Select your forked repository
   - Railway will automatically detect it's a Node.js app
   - Click **"Deploy"**

8. **Add environment variables:**
   - Click on your deployed service
   - Go to **"Variables"** tab
   - Click **"New Variable"** and add these one by one:

   ```bash
   # Slack Configuration
   SLACK_BOT_TOKEN=xoxb-your-bot-token-here
   SLACK_SIGNING_SECRET=your-signing-secret-here

   # MongoDB
   MONGODB_URI=mongodb+srv://dbuser:password@cluster.mongodb.net/corteza

   # Port
   PORT=3000

   # Jira (Optional - leave blank if not using)
   JIRA_URL=https://yourcompany.atlassian.net
   JIRA_EMAIL=your-email@company.com
   JIRA_API_TOKEN=your-jira-token

   # Claude AI
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   CLAUDE_MODEL=claude-3-5-sonnet-20240620
   CLAUDE_MAX_TOKENS=4096

   # OpenAI (for semantic search)
   OPENAI_API_KEY=sk-proj-your-key-here

   # Custom Domain (IMPORTANT - add after setting up custom domain)
   APP_BASE_URL=your-custom-domain.com
   # Example: APP_BASE_URL=app.corteza.app
   # Leave blank initially, add after Step 6 (Custom Domain Setup)
   ```

9. **Generate public URL:**
   - Go to **"Settings"** tab
   - Scroll to **"Networking"**
   - Click **"Generate Domain"**
   - **Copy the URL** (e.g., `https://your-app.up.railway.app`)

10. **Update Slack URLs:**
    - Go back to your Slack app settings: https://api.slack.com/apps
    - Update these URLs with your Railway domain:
      - **Slash Commands** → Edit `/decision` and `/decisions` → Replace Request URL
      - **Interactivity & Shortcuts** → Replace Request URL
      - **Event Subscriptions** → Replace Request URL
    - Click **"Save Changes"** for each

11. **Redeploy in Railway:**
    - The app should automatically redeploy when you save environment variables
    - Check **"Deployments"** tab - wait for it to show **"SUCCESS"**

---

### Step 5: Configure Slack OAuth (Required for Dashboard - 5 minutes)

The dashboard requires OAuth for user authentication.

1. **In Slack App Settings** → **OAuth & Permissions**
2. **Add Redirect URLs:**
   ```
   https://your-app.up.railway.app/auth/slack/callback
   https://your-app.up.railway.app/slack/oauth_redirect
   ```
   (Replace `your-app.up.railway.app` with your Railway domain from Step 4)

3. **Get OAuth Credentials:**
   - Go to **"Basic Information"** in left sidebar
   - Scroll to **"App Credentials"**
   - **Copy "Client ID"** and **"Client Secret"**

4. **Generate State Secret:**
   Run this command locally:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the output (it will be a long hex string)

5. **Add to Railway Variables:**
   Go back to Railway → **Variables** tab → Add these:
   ```bash
   SLACK_CLIENT_ID=your-client-id
   SLACK_CLIENT_SECRET=your-client-secret
   SLACK_STATE_SECRET=the-hex-string-you-generated
   ```

6. **Wait for redeploy** (Railway auto-redeploys when variables change)

---

### Step 6: Test Your Installation (5 minutes)

1. **Open Slack** and go to any channel
2. **Type:** `/decision` or `/memory`
3. You should see a modal pop up: "🧠 Add to Team Memory"
4. **Fill it out and submit** (choose type: decision/explanation/context)
5. **Type:** `/decisions` to see your logged memory

#### Test the Dashboard

1. **Open:** `https://your-app.up.railway.app/dashboard`
2. You'll be redirected to Slack OAuth login
3. Authorize the app
4. You should see your dashboard with the memory you just logged

#### Test Semantic Search

1. In the dashboard, click the **purple chat bubble** in bottom right
2. Ask: "Show me all decisions" or "What explanations do we have?"
3. You should get a conversational response from the AI

#### Test AI Transcript Extraction

1. Upload a meeting transcript file (`.txt`, `.docx`, or `.pdf`) to Slack
2. AI will analyze and extract decisions, explanations, and context
3. Review and approve/reject each suggestion
4. Approved items will be logged to team memory

---

## 🎯 What's Next?

### Invite Your Team
1. Go to Slack workspace settings
2. Add Corteza to relevant channels
3. Team members can start using `/decision` or `/memory` immediately
4. Upload meeting transcripts to automatically extract decisions, explanations, and context

### Set Up Custom Domain (Optional but Recommended)

Using a custom domain makes your dashboard URLs professional (e.g., `app.yourdomain.com` instead of `your-app.up.railway.app`).

**Requirements:**
- Own a domain (e.g., from Namecheap, GoDaddy, Squarespace)
- Access to DNS settings

**Steps:**

1. **Add DNS Record** (at your domain registrar):
   ```
   Type: CNAME
   Host: app (or your preferred subdomain)
   Value: [your-railway-domain].up.railway.app
   ```

2. **Add Custom Domain in Railway:**
   - Settings → Networking → Custom Domains
   - Click "Add Custom Domain"
   - Enter: `app.yourdomain.com`
   - Select port: `3000`
   - Wait for SSL certificate (2-5 minutes)

3. **Update Environment Variable:**
   - Railway → Variables → Add:
   ```bash
   APP_BASE_URL=app.yourdomain.com
   ```

4. **Update All Slack URLs:**
   - Go to https://api.slack.com/apps → Your app
   - Replace all `your-app.up.railway.app` URLs with `app.yourdomain.com`:
     - OAuth & Permissions → Redirect URLs
     - Interactivity & Shortcuts → Request URL
     - Event Subscriptions → Request URL
     - Slash Commands → Request URLs

5. **Test:**
   - Run `/decisions` in Slack
   - Click login link - should use your custom domain
   - Dashboard URL should be `https://app.yourdomain.com/dashboard`

---

## 🐛 Troubleshooting

### "Dispatch failed" when using slash commands

**Problem:** Slack can't reach your Railway app

**Solutions:**
- Verify Railway deployment is successful (check Deployments tab)
- Check that all Slack URLs are updated with your Railway domain
- Verify Railway app is not sleeping (free tier sleeps after inactivity)

### "Semantic search disabled" message

**Problem:** OpenAI API key not configured

**Solutions:**
- Verify `OPENAI_API_KEY` is set in Railway variables (exact name, no typo)
- Check you've added billing to your OpenAI account
- Redeploy after adding the variable

### Dashboard shows "Authentication required"

**Problem:** Slack OAuth not configured

**Solutions:**
- Follow Step 5 (Configure Slack OAuth) if you skipped it
- Verify redirect URLs are correct in Slack settings
- Check `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_STATE_SECRET` are set in Railway
- Make sure Railway redeployed after adding OAuth variables

### MongoDB connection errors

**Problem:** Can't connect to database

**Solutions:**
- Verify MongoDB connection string is correct
- Check password has no special characters that need encoding
- Verify IP allowlist includes "Allow from Anywhere" (or add Railway IPs)
- Check cluster is running (not paused)

### Vector search not working

**Problem:** Search index not ready or misconfigured

**Solutions:**
- Check vector search index status is "READY" in MongoDB Atlas
- Verify index name is exactly `vector_search_index`
- Ensure collection is `decisions` and database is `decision-logger`
- Wait 5 minutes after creating index for it to be fully active

---

## 💰 Expected Costs (Monthly)

For a small team (~10 people, ~100 decisions/month):

- **MongoDB Atlas:** FREE (M0 tier)
- **Railway:** FREE tier (500 hours/month) or $5/month for hobby plan
- **OpenAI (embeddings):** ~$0.01-0.10/month
- **Anthropic (Claude):** ~$1-5/month depending on usage

**Total:** $0-10/month for small teams

---

## 📞 Support

If you run into issues:
- Check the troubleshooting section above
- Review Railway deployment logs for errors
- Open an issue: https://github.com/cristiantumani/corteza.app/issues

---

## 🎉 Success!

You should now have:
- ✅ Decision Logger bot installed in Slack
- ✅ Database connected and running
- ✅ Dashboard accessible
- ✅ AI-powered semantic search working
- ✅ Team can start logging decisions

**Next:** Share `/decision` command with your team and start building your decision database!

---

## 🌐 Learn More

- **Website:** https://corteza.app
- **GitHub:** https://github.com/cristiantumani/corteza.app
