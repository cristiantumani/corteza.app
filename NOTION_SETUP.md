# Notion Integration Setup Guide

This guide will help you set up the one-way sync from Decision Logger to Notion.

## Overview

When enabled, every decision logged in Slack will automatically create a corresponding page in your Notion database. This gives you a powerful alternative view of your decisions with Notion's rich database features.

## Prerequisites

- A Notion account (free or paid)
- Admin access to create integrations in your Notion workspace

---

## Step 1: Create a Notion Integration

1. Go to [notion.com/my-integrations](https://www.notion.com/my-integrations)
2. Click **"+ New integration"**
3. Fill in the details:
   - **Name**: `Decision Logger` (or any name you prefer)
   - **Logo**: (optional)
   - **Associated workspace**: Select your workspace
4. Click **"Submit"**
5. Copy the **"Internal Integration Secret"** (you'll need this for `NOTION_API_KEY`)

---

## Step 2: Create a Notion Database

1. Open Notion and create a new page
2. Type `/database` and select **"Table - Inline"**
3. Name your database: `Decisions` (or any name you prefer)
4. Add the following properties to your database:

### Required Properties:

| Property Name | Type | Description |
|--------------|------|-------------|
| **Name** | Title | Decision text (auto-created) |
| **Type** | Select | Product, UX, Technical |
| **Creator** | Text | Person who created the decision |
| **Date** | Date | When the decision was made |
| **Decision ID** | Number | Sequential ID from Slack |
| **Workspace ID** | Text | Slack workspace identifier |

### Optional Properties:

| Property Name | Type | Description |
|--------------|------|-------------|
| **Epic Key** | Text | Jira epic/story key |
| **Jira Link** | URL | Link to Jira issue |
| **Tags** | Multi-select | Tags for categorization |

**Note:** The Notion integration will automatically create these properties as it syncs decisions. You can customize them later!

---

## Step 3: Grant Integration Access to Database

1. Click on the **••• (three dots)** menu in the top-right of your database page
2. Scroll down and click **"+ Add connections"**
3. Search for your integration (e.g., "Decision Logger")
4. Click on it to grant access

**Important:** The integration must have access to the database page, or API calls will fail with a 404 error!

---

## Step 4: Get Your Database ID

1. Open your Notion database page in your browser
2. Copy the URL - it will look like:
   ```
   https://www.notion.so/123abc456def789?v=...
   ```
3. The database ID is the part between `.so/` and `?v=`:
   ```
   123abc456def789
   ```
   In this example, the database ID is: `123abc456def789`

**Pro Tip:** The database ID is always 32 characters long (no hyphens).

---

## Step 5: Add Environment Variables

Add these two variables to your `.env` file or Railway environment:

```bash
NOTION_API_KEY=secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_DATABASE_ID=123abc456def789
```

Replace:
- `NOTION_API_KEY` with your Internal Integration Secret from Step 1
- `NOTION_DATABASE_ID` with your database ID from Step 4

---

## Step 6: Deploy & Test

1. **Restart your application** (locally or redeploy to Railway)
2. On startup, you should see:
   ```
   ✅ Notion integration configured
   ✅ Notion integration enabled
   ```

3. **Test the integration** by logging a decision in Slack:
   ```
   /decision Test Notion sync
   ```

4. Check your Notion database - you should see a new page created!

---

## How It Works

### One-Way Sync
- **Slack → Notion**: ✅ Every decision logged in Slack is automatically synced to Notion
- **Notion → Slack**: ❌ Changes in Notion do NOT sync back to Slack (one-way only)

### What Gets Synced

All decision data is synced:
- ✅ Decision text (as page title)
- ✅ Type (Product/UX/Technical)
- ✅ Creator name
- ✅ Date created
- ✅ Decision ID
- ✅ Workspace ID
- ✅ Epic key (if provided)
- ✅ Jira link (if available)
- ✅ Tags (if provided)
- ✅ Additional comments (as page content)

### AI-Extracted Decisions

AI-extracted decisions from meeting transcripts are also synced to Notion when approved!

---

## Notion Database Features

Once your decisions are in Notion, you can:

### Views
- **Table View**: See all decisions in a spreadsheet-like table
- **Board View**: Kanban board grouped by Type or Epic
- **Calendar View**: Timeline view of decisions
- **Gallery View**: Card-based view with previews

### Filtering & Sorting
- Filter by Type, Creator, Epic, Tags, Date range
- Sort by date, ID, creator, etc.
- Save custom filtered views

### Collaboration
- **Comments**: Discuss decisions with your team
- **@Mentions**: Tag team members
- **Linked databases**: Connect to other Notion databases (projects, epics, team members)

### Rich Content
- Add additional context to decisions in Notion
- Embed images, files, links
- Create decision templates

---

## Troubleshooting

### "Notion integration disabled"
**Cause:** Environment variables not set or incomplete.
**Fix:** Ensure both `NOTION_API_KEY` and `NOTION_DATABASE_ID` are set.

### "Failed to sync decision to Notion"
**Cause:** Integration doesn't have access to the database.
**Fix:**
1. Go to your Notion database
2. Click ••• → Add connections
3. Select your integration

### "Could not find database"
**Cause:** Invalid database ID.
**Fix:**
1. Double-check your database ID from the URL
2. Make sure it's 32 characters (no hyphens, no query parameters)

### Decisions not appearing in Notion
**Cause:** Sync is non-blocking - if Notion fails, the decision still saves to MongoDB and Slack.
**Fix:** Check application logs for error messages starting with `⚠️  Notion sync failed`

---

## Advanced Configuration

### Custom Database Schema

You can customize your Notion database properties after the fact:
- Rename properties (e.g., "Name" → "Decision Summary")
- Change property types (e.g., "Creator" from Text → Person)
- Add new properties (e.g., "Status", "Priority", "Owner")
- Add formulas and rollups

The integration will continue to sync data to the original property names.

### Multiple Workspaces

If you have multiple Slack workspaces:
- Option 1: Use one Notion database with `Workspace ID` for filtering
- Option 2: Create separate Notion databases per workspace (requires separate integrations)

---

## Disabling Notion Integration

To disable the integration:
1. Remove `NOTION_API_KEY` and `NOTION_DATABASE_ID` from environment variables
2. Restart the application

You'll see: `ℹ️  Notion integration disabled`

All decisions will still be saved to MongoDB and shown in Slack - just not synced to Notion.

---

## Next Steps

Want more from Notion?
- Set up **automations** (e.g., notify Slack when a decision is updated in Notion)
- Create **templates** for different types of decisions
- Build **dashboards** with rollups and charts
- Export decisions from Notion to other tools

For questions or issues, please create an issue on GitHub!
