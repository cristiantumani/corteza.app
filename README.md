# 🎯 Corteza

**Your team's searchable memory.** A Slack bot that helps teams capture decisions, explanations, and context from meetings using AI-powered extraction and semantic search.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Slack](https://img.shields.io/badge/slack-bot-4A154B.svg)

---

## ✨ Features

### 📁 Spaces - Organize Your Team's Knowledge (NEW!)
- **Multiple Spaces:** Organize decisions by team, project, or privacy level
- **3 Visibility Levels:**
  - 🌍 **Public** - All workspace members can view and contribute
  - 👥 **Shared** - Only invited members can access
  - 🔒 **Private** - Your personal space for sensitive decisions
- **Smart Permissions:** Owner, Admin, Member, and Viewer roles per space
- **Direct Invitations:** Invite people to specific spaces via email
- **Integrated Everywhere:** Dashboard, Chrome Extension, Slack, Obsidian plugin
- **Migration-Ready:** Existing decisions automatically moved to default "General" space

### 🧠 Team Memory Logging
- **Slash Commands:** Log memories with `/decision` or `/memory` in Slack
- **Space Selection:** Choose which space to save each decision
- **3 Memory Types:**
  - ✅ **Decisions** - Choices and commitments made
  - 💡 **Explanations** - How things work, technical details
  - 📌 **Context** - Background info, constraints, timelines
- **File Upload:** Upload meeting transcripts - AI extracts all 3 types automatically
- **AI Analysis:** Claude AI analyzes transcripts and suggests structured items for approval

### 🔍 Semantic Search
- **Natural Language Queries:** Ask "show me AEM decisions" and find results even if they mention "Adobe Experience Manager"
- **Conversational AI:** Chat interface with Claude-powered responses
- **Relevance Scoring:** Results ranked by similarity (highly relevant 85%+, relevant 70%+)
- **Vector Search:** MongoDB Atlas Vector Search with OpenAI embeddings

### 📊 Dashboard & Analytics
- **Web Dashboard:** Browse, search, and filter all decisions
- **Statistics:** Decision velocity, type distribution, team insights
- **AI Analytics:** Track AI suggestion accuracy and team feedback
- **GDPR Compliance:** Export and delete workspace data

### 🔗 Integrations
- **Chrome Extension:** Log decisions from anywhere on the web with space selection
- **Obsidian Plugin:** Bidirectional sync with your personal knowledge base
- **Per-Workspace Jira:** Each workspace configures its own Jira instance via `/settings`
- **Slack OAuth:** Secure workspace authentication
- **Multi-Tenancy:** Complete workspace isolation

### 🔐 Permissions & Security
- **Two-Level Permissions:** Workspace-level (Admin/Member) + Space-level (Owner/Admin/Member/Viewer)
- **Auto-Promotion:** Slack Admins automatically become workspace Admins
- **Permission Management:** `/permissions` command for workspace access
- **Space Management:** Create, manage, and invite members to spaces in Settings
- **Workspace Isolation:** Complete separation between workspaces
- **Space Privacy:** Private spaces truly private - only invited members can access
- **Encrypted Storage:** Jira tokens encrypted at rest with AES-256

---

## 🚀 Quick Start

### For Beta Testers (Use Corteza)

**[📘 Beta Tester Guide](BETA_TESTER_GUIDE.md)** ← Install & use Corteza in 10 minutes!

1. Click install link → Add to your Slack workspace
2. Use `/decision` to log your first team memory
3. Type `/login` to access the dashboard
4. Upload meeting transcripts for AI extraction
5. Start building your team's knowledge base

**Free during beta period** | **10 minutes to get started**

---

### For Self-Hosting (Deploy Your Own)

**[📘 Self-Hosting Guide](SELF_HOSTING_GUIDE.md)** ← Deploy Corteza to your infrastructure

**What you'll need:**
- Slack workspace admin access
- ~45-60 minutes
- Credit card for API verification (free tiers available)

**What you'll deploy:**
1. Backend server on Railway (~$5/month)
2. MongoDB Atlas database (free tier)
3. AI services (Anthropic, OpenAI)
4. Full control over data and configuration

---

## 💬 Usage Examples

### Create and Manage Spaces
```
1. Go to Dashboard → Settings → Manage Spaces
2. Click "Create Space"
3. Choose name, visibility (Public/Shared/Private), and icon
4. Invite members directly (for Shared/Private spaces)
```

**Space Examples:**
- **Engineering Team** (Public) - All tech decisions visible to everyone
- **Product Roadmap** (Shared) - Product team collaboration
- **CEO Notes** (Private) - Sensitive leadership decisions

### Add to Team Memory
```
/decision We will use React for the frontend
```
or
```
/memory The API works by sending webhooks to our endpoint
```

Fill in the modal with:
- **Space** - Choose where to save this decision (NEW!)
- Content text
- Type (decision/explanation/context)
- Category (product/ux/technical)
- Additional comments
- Tags
- Related Jira epic (optional)

### Manage Permissions (Admins Only)
```
/permissions list                    # View all admins
/permissions grant @teammate         # Promote user to admin
/permissions revoke @teammate        # Remove admin access
```

### Configure Jira (Admins Only)
```
/settings                            # Opens Jira configuration modal
```
- Each workspace configures its own Jira instance
- Settings are encrypted and stored per-workspace
- No global Jira configuration needed

### Access Dashboard
```
/login                               # Get personalized dashboard link
```

### Search Team Memory
```
/decisions search authentication
```
Or use the dashboard chat:
- "Show me all decisions from December"
- "What explanations do we have about the API?"
- "Context about Adobe Experience Manager integration"

### Upload Meeting Transcripts
Upload a `.txt`, `.docx`, or `.pdf` file to any channel where the bot is present. AI will:
1. Analyze the transcript
2. Extract decisions, explanations, and context
3. Present them for review (approve/edit/reject)
4. Log approved items automatically

---

## 🏗️ Architecture

```
┌─────────────┐
│    Slack    │
│   (User)    │
└──────┬──────┘
       │
       │ Slash Commands,
       │ Events, OAuth
       │
       ▼
┌─────────────────────────────────┐
│      Node.js Backend            │
│   (Slack Bolt Framework)        │
│                                 │
│  ┌──────────┐  ┌─────────────┐ │
│  │  Routes  │  │  Services   │ │
│  │          │  │             │ │
│  │ • Slack  │  │ • Jira API  │ │
│  │ • API    │  │ • Embeddings│ │
│  │ • Auth   │  │ • Semantic  │ │
│  │ • GDPR   │  │   Search    │ │
│  └──────────┘  └─────────────┘ │
└────────┬────────────────────────┘
         │
         │ Database & AI APIs
         │
    ┌────┴────┬────────────┬──────────┐
    │         │            │          │
    ▼         ▼            ▼          ▼
┌────────┐ ┌─────┐  ┌──────────┐ ┌────────┐
│MongoDB │ │Jira │  │Anthropic │ │ OpenAI │
│ Atlas  │ │ API │  │ (Claude) │ │(Embed) │
└────────┘ └─────┘  └──────────┘ └────────┘
```

**Tech Stack:**
- **Backend:** Node.js, Express, Slack Bolt SDK
- **Database:** MongoDB Atlas with Vector Search
- **AI:** Claude 3.5 Sonnet (analysis), OpenAI text-embedding-3-small (search)
- **Deployment:** Railway (or any Node.js host)
- **Frontend:** Server-side rendered HTML with vanilla JS

---

## 📁 Project Structure

```
corteza/
├── src/
│   ├── config/
│   │   ├── database.js          # MongoDB connection & collections
│   │   └── environment.js       # Environment variable validation
│   ├── middleware/
│   │   ├── auth.js              # Slack OAuth middleware
│   │   └── validation.js        # Input validation & sanitization
│   ├── routes/
│   │   ├── slack.js             # Slash commands (/decision, /decisions)
│   │   ├── ai-decisions.js      # AI transcript analysis & approvals
│   │   ├── api.js               # REST API endpoints
│   │   ├── auth.js              # Slack OAuth flow
│   │   ├── gdpr.js              # Data export & deletion
│   │   └── semantic-search-api.js # Semantic search endpoints
│   ├── services/
│   │   ├── jira.js              # Jira API integration
│   │   ├── embeddings.js        # OpenAI embeddings generation
│   │   └── semantic-search.js   # Vector search & hybrid search
│   ├── views/
│   │   ├── dashboard.html       # Main decision dashboard
│   │   └── ai-analytics.html    # AI feedback analytics
│   └── index.js                 # App entry point
├── scripts/
│   ├── migrate-embeddings.js    # Batch generate embeddings
│   ├── check-embeddings.js      # Verify embeddings exist
│   ├── check-workspaces.js      # View workspace data
│   └── test-semantic-search.js  # Test vector search locally
├── INSTALLATION_GUIDE.md        # Step-by-step setup for beta testers
├── FEEDBACK_LOG.md              # User feedback tracking
└── package.json
```

---

## 🔒 Security & Privacy

- **Multi-Tenancy:** Complete workspace isolation - no data sharing between companies
- **OAuth Authentication:** Secure Slack workspace authentication
- **Input Validation:** All inputs sanitized to prevent injection attacks
- **GDPR Compliance:** Users can export and delete all workspace data
- **API Key Security:** Environment variables for sensitive credentials
- **Workspace Verification:** All operations verify user belongs to workspace

---

## 🛠️ Development

### Local Setup

```bash
# Clone the repository
git clone https://github.com/cristiantumani/corteza.app.git
cd corteza.app

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your credentials

# Run locally
npm start

# Or use nodemon for development
npm run dev
```

### Environment Variables

See [SELF_HOSTING_GUIDE.md](SELF_HOSTING_GUIDE.md) for detailed setup instructions.

Required variables:
- `SLACK_BOT_TOKEN` - Bot User OAuth Token (not needed if using OAuth)
- `SLACK_SIGNING_SECRET` - Signing secret from Slack app
- `SESSION_SECRET` - Session cookie encryption key
  - Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - Must be persistent across restarts
- `ENCRYPTION_KEY` - For encrypting per-workspace Jira tokens (**NEW**)
  - Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - Must be persistent across restarts
- `MONGODB_URI` - MongoDB Atlas connection string
- `ANTHROPIC_API_KEY` - Claude API key
- `OPENAI_API_KEY` - OpenAI API key (optional, disables semantic search if not set)

OAuth (multi-workspace) variables:
- `SLACK_CLIENT_ID` - OAuth client ID from Slack app
- `SLACK_CLIENT_SECRET` - OAuth client secret from Slack app
- `SLACK_STATE_SECRET` - **Required** for OAuth CSRF protection
  - Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - Must be persistent across restarts

Optional:
- `APP_BASE_URL` - Custom domain for dashboard (e.g., `app.yourcompany.com`)
- **Note:** Jira is now configured per-workspace via `/settings` command (no global config needed)

---

## 📊 Database Schema

### Collections

**decisions:**
```javascript
{
  workspace_id: "T0WKH1NGL",
  space_id: "sp_abc123xyz",       // NEW - Space assignment
  space_name: "Engineering Team", // NEW - Denormalized for display
  id: 1,                    // Sequential per workspace
  text: "Decision to use PostgreSQL",
  type: "technical",        // product | technical | ux
  epic_key: "PROJ-123",
  jira_data: { ... },
  tags: ["database", "architecture"],
  alternatives: ["MySQL", "MongoDB"],
  creator: "John Doe",
  timestamp: "2024-12-21T10:00:00Z",
  embedding: [0.123, ...]   // 1536-dim vector for semantic search
}
```

**workspace_spaces:** *(NEW - Space organization)*
```javascript
{
  space_id: "sp_abc123xyz",
  workspace_id: "T0WKH1NGL",
  name: "Engineering Team",
  description: "Engineering decisions",
  visibility: "public",           // public | shared | private
  created_by: "U123ABC",
  created_by_name: "John Doe",
  created_at: "2024-01-15T10:30:00Z",
  updated_at: "2024-01-15T10:30:00Z",
  is_default: true,              // Only one default per workspace
  archived: false,
  settings: {
    color: "#667eea",
    icon: "🏠"
  }
}
```

**space_members:** *(NEW - Space permissions)*
```javascript
{
  membership_id: "mem_xyz789",
  workspace_id: "T0WKH1NGL",
  space_id: "sp_abc123xyz",
  user_id: "U123ABC",
  user_name: "John Doe",
  role: "member",                 // owner | admin | member | viewer
  added_by: "U999ABC",
  added_by_name: "Jane Admin",
  added_at: "2024-01-15T10:30:00Z",
  removed_at: null                // Soft delete
}
```

**ai_suggestions:**
```javascript
{
  workspace_id: "T0WKH1NGL",
  suggestion_id: "ai_sugg_123",
  meeting_transcript_id: "transcript_123",
  decision_text: "Use React for frontend",
  alternatives: ["Vue", "Angular"],
  status: "pending",        // pending | approved | rejected | edited
  created_at: "2024-12-21T10:00:00Z"
}
```

**meeting_transcripts:**
```javascript
{
  workspace_id: "T0WKH1NGL",
  transcript_id: "transcript_123",
  file_id: "F123ABC",
  uploaded_by: "U123ABC",
  uploaded_at: "2024-12-21T10:00:00Z",
  suggestions_count: 3
}
```

**ai_feedback:**
```javascript
{
  workspace_id: "T0WKH1NGL",
  feedback_id: "feedback_123",
  suggestion_id: "ai_sugg_123",
  action: "approved",       // approved | rejected | edited
  original_suggestion: { ... },
  final_decision: { ... },
  created_at: "2024-12-21T10:00:00Z"
}
```

**workspace_admins:** *(NEW - Role-based permissions)*
```javascript
{
  workspace_id: "T0WKH1NGL",
  user_id: "U123ABC",
  user_name: "john.doe",
  email: "john@company.com",
  role: "admin",
  source: "slack_admin",     // slack_admin | assigned
  assigned_by: null,          // User ID who granted access
  is_slack_admin: true,       // From Slack API
  created_at: "2024-12-21T10:00:00Z",
  deactivated_at: null        // Soft delete
}
```

**workspace_settings:** *(NEW - Per-workspace Jira config)*
```javascript
{
  workspace_id: "T0WKH1NGL",
  jira: {
    enabled: true,
    url: "https://company.atlassian.net",
    email: "bot@company.com",
    api_token_encrypted: "...",  // AES-256 encrypted
    last_tested_at: "2024-12-21T10:00:00Z",
    configured_by: "U123ABC"
  },
  updated_at: "2024-12-21T10:00:00Z"
}
```

---

## 🤝 Contributing

We're currently in **beta testing phase**. Contributions, feedback, and bug reports are welcome!

### How to Contribute
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Reporting Issues
- Use the [GitHub Issues](https://github.com/cristiantumani/corteza.app/issues) page
- Include steps to reproduce
- Include error messages and logs
- Mention your environment (Node version, deployment platform)

---

## 📝 Roadmap

### Current Features ✅
- [x] **Spaces system** - Organize by team, project, or privacy level (Public/Shared/Private)
- [x] **Chrome Extension** - Log decisions from anywhere with space selection
- [x] **Obsidian Plugin** - Bidirectional sync with personal knowledge base
- [x] Decision logging via Slack slash commands (`/decision`, `/memory`)
- [x] AI-powered transcript analysis with Claude
- [x] Semantic search with vector embeddings
- [x] Web dashboard with chat interface
- [x] Per-workspace Jira configuration (`/settings`)
- [x] Multi-workspace support with OAuth
- [x] Two-level permissions (Workspace + Space)
- [x] Permission management (`/permissions`)
- [x] Direct space invitations via email
- [x] Encrypted Jira token storage
- [x] GDPR compliance tools (export/delete)

### Under Consideration (Based on User Feedback) 🤔
- [ ] Passive decision detection (bot monitors channels)
- [ ] Bulk import from Slack history
- [ ] Decision templates & frameworks
- [ ] Team alignment dashboard
- [ ] Decision reversal tracking
- [ ] Integration triggers (Jira ticket close, PR merge)

See [FEEDBACK_LOG.md](FEEDBACK_LOG.md) for detailed feedback from beta testers.

---

## 💰 Expected Costs (Monthly)

For a small team (~10 people, ~100 decisions/month):

- **MongoDB Atlas:** FREE (M0 tier)
- **Railway:** FREE tier (500 hours/month) or $5/month for hobby plan
- **OpenAI (embeddings):** ~$0.01-0.10/month
- **Anthropic (Claude):** ~$1-5/month depending on usage

**Total:** $0-10/month for small teams

---

## 🐛 Troubleshooting

### "Dispatch failed" when using slash commands
**Problem:** Slack can't reach your Railway app
**Solutions:**
- Verify Railway deployment is successful
- Check all Slack URLs are updated with Railway domain
- Verify Railway app is not sleeping

### "Semantic search disabled" message
**Problem:** OpenAI API key not configured
**Solutions:**
- Verify `OPENAI_API_KEY` is set in Railway (exact name, no typo)
- Check you've added billing to OpenAI account
- Redeploy after adding the variable

### Dashboard shows "Authentication required"
**Problem:** Slack OAuth not configured
**Solutions:**
- Follow OAuth setup in INSTALLATION_GUIDE.md
- Verify redirect URL is correct
- Check client ID and secret are set

### MongoDB connection errors
**Problem:** Can't connect to database
**Solutions:**
- Verify connection string is correct
- Check password encoding
- Verify IP allowlist includes "Allow from Anywhere"

### Vector search not working
**Problem:** Search index not ready
**Solutions:**
- Check index status is "READY" in MongoDB Atlas
- Verify index name is `vector_search_index`
- Wait 5 minutes after creating index

---

## 📜 License

MIT License - see LICENSE file for details

---

## 🙏 Acknowledgments

- Built with [Slack Bolt for JavaScript](https://slack.dev/bolt-js/)
- AI powered by [Anthropic Claude](https://www.anthropic.com/)
- Semantic search with [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- Vector search by [MongoDB Atlas](https://www.mongodb.com/atlas/database)

---

## 📞 Support

- **Documentation:** [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md)
- **Issues:** [GitHub Issues](https://github.com/cristiantumani/corteza.app/issues)
- **Feedback:** [FEEDBACK_LOG.md](FEEDBACK_LOG.md)

---

**Made with ❤️ for teams who want to learn from their decisions**
