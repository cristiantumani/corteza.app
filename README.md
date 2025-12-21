# 🎯 Corteza

**Never lose track of important decisions again.** A Slack bot that helps teams log, search, and learn from their product, technical, and UX decisions using AI-powered semantic search.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Slack](https://img.shields.io/badge/slack-bot-4A154B.svg)

---

## ✨ Features

### 📝 Decision Logging
- **Slash Commands:** Quick decision logging with `/decision` command in Slack
- **Rich Context:** Capture decision type (product/technical/UX), alternatives considered, tags, and Jira epics
- **File Upload:** Upload meeting transcripts - AI extracts decisions automatically
- **AI Analysis:** Claude AI analyzes transcripts and suggests structured decisions

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
- **Jira:** Link decisions to epics, auto-create tickets
- **Slack OAuth:** Secure workspace authentication
- **Multi-Tenancy:** Complete workspace isolation

---

## 🚀 Quick Start for Beta Testers

### **[📘 Complete Installation Guide](INSTALLATION_GUIDE.md)** ← Start here!

**What you'll need:**
- Slack workspace admin access
- ~45 minutes
- Credit card for API verification (free tiers available)

**Quick Overview:**
1. Create Slack App (10 min)
2. Set up MongoDB Atlas (10 min)
3. Get API keys (OpenAI, Anthropic, Jira) (10 min)
4. Deploy to Railway (10 min)
5. Test & configure (5 min)

---

## 💬 Usage Examples

### Log a Decision
```
/decision
```
Fill in the modal with:
- Decision text
- Type (product/technical/UX)
- Alternatives considered
- Tags
- Related Jira epic (optional)

### Search Decisions
```
/decisions
```
Or use the dashboard chat:
- "Show me all technical decisions from December"
- "What did we decide about authentication?"
- "Decisions related to Adobe Experience Manager"

### Upload Meeting Notes
Upload a `.txt` file with meeting transcript to any channel where the bot is present. AI will:
1. Analyze the transcript
2. Extract decisions
3. Present them for approval
4. Log approved decisions automatically

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

See [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) for detailed setup instructions.

Required variables:
- `SLACK_BOT_TOKEN` - Bot User OAuth Token
- `SLACK_SIGNING_SECRET` - Signing secret from Slack app
- `MONGODB_URI` - MongoDB Atlas connection string
- `ANTHROPIC_API_KEY` - Claude API key
- `OPENAI_API_KEY` - OpenAI API key

Optional:
- `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` - For Jira integration
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` - For OAuth

---

## 📊 Database Schema

### Collections

**decisions:**
```javascript
{
  workspace_id: "T0WKH1NGL",
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
- [x] Decision logging via Slack slash commands
- [x] AI-powered transcript analysis
- [x] Semantic search with vector embeddings
- [x] Web dashboard with chat interface
- [x] Jira integration
- [x] Multi-workspace support
- [x] GDPR compliance tools

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
