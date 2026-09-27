# Corteza - Security & Data Flow Documentation

**Last Updated:** December 22, 2024
**Version:** 1.1 (Beta - Security Hardened)

This document provides a comprehensive overview of data flows, external service integrations, data storage, and security considerations for Corteza.

---

## 📊 1. What Data Leaves Slack?

### **A. Slash Commands**
When users run `/decision` or `/decisions`:

**Data Sent to Corteza:**
- Command text (e.g., `/decision`, `/decisions search AEM`)
- User ID, username, display name
- Workspace ID, workspace name, team domain
- Channel ID where command was executed
- Timestamp

**Example payload:**
```json
{
  "command": "/decision",
  "text": "",
  "user_id": "U123ABC",
  "user_name": "john.doe",
  "team_id": "T0WKH1NGL",
  "team_domain": "lokalise",
  "channel_id": "C123XYZ"
}
```

### **B. Modal Form Submissions**
When users submit the `/decision` modal:

**Data Sent to Corteza:**
- Decision text (full text entered by user)
- Decision type (product/technical/UX)
- Tags (comma-separated list)
- Alternatives considered (optional text field)
- Epic key (optional, e.g., "LOK-123")
- Whether to add Jira comment (checkbox boolean)
- User info (user_id, username)
- Workspace info (workspace_id)
- Channel info (channel_id)
- Timestamp

### **C. File Uploads (Meeting Transcripts)**
When users upload `.txt`, `.docx`, or `.pdf` files to channels where the bot is present:

**Data Sent to Corteza:**
- **Full file contents** (entire transcript text)
- File metadata (file_id, filename, filetype, size)
- User who uploaded (user_id, username)
- Workspace info (workspace_id)
- Channel info (channel_id)
- Timestamp

**⚠️ Important:** The bot receives the **complete file content**, not just metadata.

### **D. Messages (Limited Scope)**
**Current Implementation:** The bot does NOT read regular channel messages.

**Exception:** The bot listens for `file_shared` events to detect transcript uploads, but does NOT read message text itself.

**OAuth Scopes:** ✅ **History-reading scopes removed** (as of Dec 22, 2024) - The app no longer requests permissions to read message history.

---

## 🌐 2. External Services & Data Sharing

### **A. MongoDB Atlas (Database)**

**What data is sent:**
- ✅ All decision records (decision text, type, tags, alternatives, epic key, creator, timestamps)
- ✅ Full meeting transcript files (raw text)
- ✅ AI-extracted suggestions (decision text, alternatives, tags, type)
- ✅ AI feedback records (approved/rejected/edited suggestions)
- ✅ User info (user_id, username, display name)
- ✅ Workspace info (workspace_id, workspace name)
- ✅ Vector embeddings (1536-dimensional arrays)

**Data location:**
- Configurable (currently: AWS, region set during MongoDB Atlas cluster creation)
- Beta instance: Likely US-based (confirm in MongoDB Atlas console)

**Encryption:**
- ✅ In transit: TLS 1.2+
- ✅ At rest: MongoDB Atlas default encryption
- ❌ Field-level encryption: Not implemented

**Access control:**
- Database credentials stored in Railway environment variables
- Single database user with full read/write access
- IP allowlist: ✅ **Restricted to Railway production server only** (34.145.2.57/32)

### **B. Anthropic (Claude API)**

**What data is sent:**
1. **Meeting transcript analysis:**
   - Full transcript text (can contain sensitive discussions, decisions, participant names, context)
   - Prompt: "Extract decisions from this transcript..."

2. **Semantic search responses:**
   - Search query (e.g., "show me AEM decisions")
   - Retrieved decision results (decision text, type, creator, dates, tags)
   - Prompt: "Generate a conversational response summarizing these decisions..."

**Model used:** `claude-3-5-sonnet-20240620`

**Data retention (Anthropic):**
- Per Anthropic's policy: API requests are NOT used to train models
- Data may be retained for 30 days for abuse prevention
- Reference: https://www.anthropic.com/legal/commercial-terms

**Encryption:**
- ✅ HTTPS/TLS in transit

### **C. OpenAI (Embeddings API)**

**What data is sent:**
1. **Decision embedding generation:**
   - Decision text (full text)
   - Decision type, tags, alternatives, epic key
   - Creator name
   - Context (combined into single embedding input)

2. **Search query embedding:**
   - User's natural language search query (e.g., "show me technical decisions about authentication")

**Model used:** `text-embedding-3-small` (1536 dimensions)

**Data retention (OpenAI):**
- Per OpenAI's policy (as of March 2023): API data is NOT used for training by default
- Data retained for 30 days for abuse/misuse monitoring
- Reference: https://openai.com/enterprise-privacy

**Encryption:**
- ✅ HTTPS/TLS in transit

**Generated embeddings:**
- Stored permanently in MongoDB
- 1536 floating-point numbers representing semantic meaning
- Cannot be directly reverse-engineered to original text, but can reveal semantic similarity

### **D. Railway (Hosting Provider)**

**What data passes through:**
- ✅ ALL data above (Railway hosts the Node.js application)
- ✅ Environment variables (API keys, secrets, connection strings)
- ✅ Application logs (may contain decision text, user info, errors)

**Data location:**
- Railway region: Configurable (check Railway dashboard)
- Likely US-based by default

**Encryption:**
- ✅ HTTPS/TLS for all traffic
- ✅ Environment variables encrypted at rest

**Access:**
- Railway dashboard accessible via GitHub OAuth
- Currently: Personal account (cristian.tumani)

**Logging:**
- Railway logs retained for 7 days (free tier) or 30 days (paid tier)
- Logs may contain sensitive data (decision text, user names, queries)

### **E. Jira Cloud (Optional)**

**What data is sent:**
- Epic key queries (e.g., "LOK-123") - sent to fetch epic metadata
- Decision summaries posted as comments:
  ```
  📝 Decision #42 logged by John Doe
  Type: product
  Decision: We will only sync AEM → Lokalise, not bidirectional
  Alternatives considered: Considered bidirectional sync but...
  Logged via corteza.app
  ```

**Authentication:** Jira API token (stored in Railway env vars)

**Data retention:** Indefinite (Jira comments persist until manually deleted)

---

## 💾 3. Long-Term Data Storage

### **What is Stored in MongoDB**

#### **A. Decisions Collection**
```javascript
{
  workspace_id: "T0WKH1NGL",
  id: 42,
  text: "Full decision text here...",
  type: "product",
  epic_key: "LOK-123",
  jira_data: { summary: "...", status: "In Progress", url: "..." },
  tags: ["aem", "integration"],
  alternatives: "Full text of alternatives considered...",
  creator: "John Doe",
  user_id: "U123ABC",
  channel_id: "C123XYZ",
  timestamp: "2024-12-22T10:00:00Z",
  embedding: [0.123, -0.456, ...] // 1536 numbers
}
```

**Retention:** Indefinite (until user deletes via GDPR tools or uninstalls app)

**Sensitive fields:**
- `text`: Full decision text (may contain business-sensitive information)
- `alternatives`: Full text of alternatives (may contain rejected strategies)
- `creator`, `user_id`: Personal identifiers
- `embedding`: Semantic representation (cannot be reversed to text, but reveals similarity)

#### **B. Meeting Transcripts Collection**
```javascript
{
  workspace_id: "T0WKH1NGL",
  transcript_id: "transcript_123",
  file_id: "F123ABC",
  file_content: "FULL RAW TRANSCRIPT TEXT HERE...", // ⚠️ Sensitive
  uploaded_by: "U123ABC",
  uploaded_at: "2024-12-22T10:00:00Z",
  suggestions_count: 3
}
```

**⚠️ CRITICAL:** Full raw transcript text is stored indefinitely.

**Contains:**
- Meeting discussions (may include confidential strategies, financials, personnel discussions)
- Participant names/roles
- Unfiltered conversation context

**Retention:** Indefinite (no automatic deletion)

#### **C. AI Suggestions Collection**
```javascript
{
  workspace_id: "T0WKH1NGL",
  suggestion_id: "ai_sugg_123",
  meeting_transcript_id: "transcript_123",
  decision_text: "Extracted decision text...",
  alternatives: "Extracted alternatives...",
  tags: ["tag1", "tag2"],
  type: "product",
  status: "approved", // pending | approved | rejected | edited
  created_at: "2024-12-22T10:00:00Z"
}
```

**Retention:** Indefinite

#### **D. AI Feedback Collection**
```javascript
{
  workspace_id: "T0WKH1NGL",
  feedback_id: "feedback_123",
  suggestion_id: "ai_sugg_123",
  action: "approved", // approved | rejected | edited
  original_suggestion: { ... },
  final_decision: { ... },
  created_at: "2024-12-22T10:00:00Z"
}
```

**Retention:** Indefinite

**Purpose:** Used to improve AI accuracy via few-shot learning

### **Storage Summary**

| Data Type | Storage Location | Retention Period | Contains PII? | Contains Business-Sensitive? |
|-----------|------------------|------------------|---------------|------------------------------|
| Decisions | MongoDB Atlas | Indefinite | ✅ Yes (names, user IDs) | ✅ Yes (decision text) |
| Transcripts | MongoDB Atlas | Indefinite | ✅ Yes (names in text) | ✅ Yes (full discussions) |
| AI Suggestions | MongoDB Atlas | Indefinite | ❌ No | ✅ Yes (decision text) |
| AI Feedback | MongoDB Atlas | Indefinite | ❌ No | ✅ Yes (decision text) |
| Embeddings | MongoDB Atlas | Indefinite | ❌ No | ⚠️ Partial (semantic similarity) |
| Application Logs | Railway | 7-30 days | ⚠️ Maybe (in errors) | ⚠️ Maybe (in errors) |

---

## 🔐 4. OAuth Scopes & Permissions

### **Requested Scopes**

✅ **Updated Dec 22, 2024** - Unused history-reading scopes removed for security.

```
channels:read        - View basic public channel info
chat:write           - Send messages as @corteza.app
commands             - Add slash commands (/decision, /decisions)
files:read           - Access files shared in channels
groups:read          - View basic private channel info
users:read           - View user information (names, emails)
```

**Removed scopes (no longer requested):**
```
channels:history     - ❌ REMOVED (was unused)
groups:history       - ❌ REMOVED (was unused)
im:history           - ❌ REMOVED (was unused)
mpim:history         - ❌ REMOVED (was unused)
```

### **Currently Used vs. Risk Assessment**

| Scope | Currently Used? | Risk Level |
|-------|----------------|------------|
| `commands` | ✅ Yes | ✅ Low - Required for slash commands |
| `chat:write` | ✅ Yes | ✅ Low - Required to post responses |
| `files:read` | ✅ Yes | ⚠️ Medium - Can read all uploaded files in channels where bot is present |
| `users:read` | ✅ Yes | ✅ Low - Only reads user display names |
| `channels:read` | ✅ Yes | ✅ Low - Only reads channel IDs |
| `groups:read` | ✅ Yes | ✅ Low - Only reads private channel IDs |

**✅ SECURITY IMPROVEMENT (Dec 22, 2024):** Dangerous message history scopes (`channels:history`, `groups:history`, `im:history`, `mpim:history`) have been removed. The app now follows the principle of least privilege.

### **Can It Be Limited to Specific Channels?**

**Current:** No - the app is installed workspace-wide.

**Options:**
1. **User-based installation:** Users install individually (limits to their accessible channels)
   - Requires: Changing from workspace-level to user-level installation
   - Trade-off: Each user needs to install separately

2. **Channel allowlist (code change):**
   - Add configuration: `ALLOWED_CHANNELS=C123,C456`
   - Bot ignores events from non-allowlisted channels
   - Scopes still granted workspace-wide, but bot self-restricts

**Status:** ✅ History scopes removed (Dec 22, 2024). Channel allowlist remains optional for future enhancement.

---

## 👤 5. Ownership & Infrastructure

### **Current Ownership**

**Application Code:**
- Owner: Cristian Tumani (personal project)
- Repository: https://github.com/cristiantumani/corteza.app
- License: Not specified (currently private repository)

**Infrastructure:**

| Service | Account Owner | Organization | Cost |
|---------|--------------|--------------|------|
| Railway (hosting) | Cristian Tumani (personal) | None | ~$5-10/month |
| MongoDB Atlas (database) | Cristian Tumani (personal) | None | Free tier (M0) |
| OpenAI API | Cristian Tumani (personal) | None | ~$0.01-0.10/month |
| Anthropic API | Cristian Tumani (personal) | None | ~$1-5/month |
| Slack App | Cristian Tumani (personal) | Lokalise workspace | N/A |

**API Keys & Secrets:**
- All stored in Railway environment variables
- Access: Cristian Tumani only (via Railway dashboard)

**Domain:**
- `corteza.app` - Owned by Cristian Tumani (Squarespace)
- `app.corteza.app` - CNAME to Railway

### **Transfer to Lokalise Organization**

**✅ Open to Transfer** - Yes, infrastructure can be moved to Lokalise org.

**Transfer Steps:**

#### **1. Slack App Ownership**
- **Current:** App created under Cristian's Slack account
- **Transfer:** Go to Slack App settings → Collaborators → Transfer ownership to Lokalise Slack admin

#### **2. GitHub Repository**
- **Option A:** Transfer repo to Lokalise GitHub org
  - Settings → Transfer ownership → `lokalise` org
- **Option B:** Fork to Lokalise org, update Railway to deploy from new repo

#### **3. Railway (Hosting)**
- **Option A:** Create new Railway project under Lokalise team account
  - Invite Lokalise team members
  - Redeploy from Lokalise GitHub repo
  - Migrate environment variables
- **Option B:** Add Lokalise team members as collaborators to existing project

#### **4. MongoDB Atlas (Database)**
**⚠️ DATA MIGRATION REQUIRED**
- **Option A:** Create new cluster under Lokalise MongoDB org
  - Export data from current cluster: `mongodump`
  - Import to new cluster: `mongorestore`
  - Update `MONGODB_URI` in Railway
- **Option B:** Add Lokalise email addresses as Atlas project members

#### **5. API Keys**
- **OpenAI:** Create new API key under Lokalise OpenAI account, update in Railway
- **Anthropic:** Create new API key under Lokalise Anthropic account, update in Railway
- **Jira:** Already using Lokalise Jira instance

#### **6. Domain**
- **Option A:** Transfer `corteza.app` domain to Lokalise (Squarespace domain transfer)
- **Option B:** Keep domain with Cristian, CNAME stays pointed to Railway
- **Option C:** Use Lokalise-owned domain (e.g., `decisions.lokalise.com`)

**Estimated Transfer Time:** 4-8 hours (mostly waiting for DNS propagation)

**Recommended Approach:**
1. Create Lokalise Railway team account
2. Fork repo to `lokalise/corteza` GitHub org
3. Deploy to Railway under Lokalise account
4. Create new MongoDB Atlas project under Lokalise org
5. Migrate data (mongodump/mongorestore)
6. Update all environment variables
7. Test thoroughly in parallel with existing instance
8. Switch DNS when ready (or use new domain)
9. Transfer Slack app ownership

---

## 🔒 Security Recommendations

### **Completed Security Improvements ✅**

1. **✅ COMPLETED (Dec 22, 2024) - Removed unused OAuth scopes:**
   - Removed: `channels:history`, `groups:history`, `im:history`, `mpim:history`
   - These scopes allowed reading message history but were unused
   - App now follows principle of least privilege

2. **✅ COMPLETED (Dec 22, 2024) - Implemented MongoDB IP allowlist:**
   - Removed: "Allow from Anywhere" (0.0.0.0/0)
   - Added: Railway production server IP only (34.145.2.57/32)
   - Database now only accessible from authorized application server

### **Immediate (Pre-GA)**

1. **Add audit logging:**
   - Log all data access (who viewed/searched/exported)
   - Store logs separately from application database

2. **Implement data retention policy:**
   - Auto-delete transcripts after 90 days (configurable)
   - Auto-delete embeddings when decisions are deleted

3. **Add encryption at rest for sensitive fields:**
   - Encrypt `text`, `alternatives`, `file_content` fields in MongoDB
   - Use MongoDB field-level encryption or application-level encryption

### **Medium-Term**

4. **Implement channel allowlist:**
   - Environment variable: `ALLOWED_CHANNELS=C123,C456`
   - Reject events from non-allowlisted channels

5. **Add role-based access control:**
   - Workspace admins can configure settings
   - Regular users can only log/view decisions

6. **Implement data anonymization for AI feedback:**
   - Store only decision structure, not actual text
   - Use hashed IDs instead of real user names

7. **Add data residency controls:**
   - Allow customers to choose MongoDB region (EU/US)
   - Document where data is stored

8. **Regular security audits:**
   - Penetration testing
   - Dependency vulnerability scanning (npm audit)
   - Code security review

### **Long-Term**

9. **SOC 2 compliance** (if required for enterprise customers)
10. **GDPR/CCPA compliance documentation**
11. **Data processing agreements (DPA)** for customers
12. **Bring Your Own Key (BYOK)** for encryption

---

## 📞 Contact

**For security concerns or questions:**
- **Technical Owner:** Cristian Tumani
- **Email:** cristiantumani@gmail.com
- **GitHub Issues:** https://github.com/cristiantumani/corteza.app/issues

---

**Last Reviewed:** December 22, 2024
**Next Review:** Before General Availability (GA) release
