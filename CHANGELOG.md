# Changelog

All notable changes to Corteza will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.3.0] - 2026-01-21

### 🎉 Added - Role-Based Permission System

**New Features:**
- **Admin/Non-Admin Roles:** Simple 2-tier permission system
- **Auto-Promotion:** Slack Workspace Admins automatically become app Admins
- **Permission Management:** New `/permissions` command
  - `/permissions list` - View all workspace admins
  - `/permissions grant @user` - Promote users to admin
  - `/permissions revoke @user` - Demote admins
- **Permission Enforcement:**
  - Admins can edit/delete ANY decision
  - Non-admins can only edit/delete THEIR OWN decisions
  - Dashboard UI reflects permissions (hides buttons appropriately)
  - Settings access restricted to admins only

**Technical:**
- New `workspace_admins` collection in MongoDB
- Permission checks in API endpoints (edit/delete)
- Frontend permission enforcement in dashboard
- Audit trail for permission changes

### 🔒 Added - Per-Workspace Jira Configuration

**New Features:**
- **`/settings` Command:** Admins can configure Jira per-workspace
- **Encrypted Storage:** Jira API tokens encrypted with AES-256-GCM
- **Connection Testing:** Test Jira credentials before saving
- **Workspace Isolation:** Each workspace has its own Jira config
- **No Global Config:** Removed global Jira environment variables

**Technical:**
- New `workspace_settings` collection in MongoDB
- Encryption utilities for sensitive data
- Admin-only access to settings endpoints
- Graceful fallback for migration

### 🛠️ Changed

**Commands:**
- **`/decision`** and **`/memory`** now support category field (product/ux/technical)
- **`/login`** command added for easy dashboard access
- All slash commands now verify workspace membership

**Environment Variables:**
- Added `ENCRYPTION_KEY` (required for Jira token encryption)
- Added `SESSION_SECRET` (required for cookie security)
- Added `SLACK_STATE_SECRET` (required for OAuth CSRF protection)
- Removed global `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (now per-workspace)

**Dashboard:**
- Edit/Delete buttons now respect user permissions
- "Read-only" label shown for decisions user can't modify
- Edit modal hidden for non-modifiable decisions

### 📚 Improved

**Documentation:**
- New **[BETA_TESTER_GUIDE.md](BETA_TESTER_GUIDE.md)** for users (install & use in 10 min)
- New **[SELF_HOSTING_GUIDE.md](SELF_HOSTING_GUIDE.md)** for self-hosting (deploy in 45-60 min)
- New **[CHANGELOG.md](CHANGELOG.md)** for version history
- Updated README with latest features
- Clearer step-by-step instructions
- Troubleshooting section expanded
- Added permission system documentation

**Security:**
- Jira tokens encrypted at rest
- Admin-only access to sensitive operations
- Session secrets required for production
- Enhanced input validation

---

## [0.2.0] - 2026-01-15

### 🎨 Added - Modern Dashboard Design

**UI Improvements:**
- Modern gradient backgrounds
- Bold, animated stat cards
- Glassmorphism effects
- Hero banner with workspace info
- Improved mobile responsiveness

### ⚡ Improved - Claude API Optimization

**Performance:**
- Reduced token usage by 40%
- Implemented few-shot learning with workspace examples
- Added caching for repeated requests
- Optimized prompt engineering

**Cost Savings:**
- Average cost per decision reduced from $0.05 to $0.03
- Better context management
- Smarter semantic search queries

---

## [0.1.0] - 2025-12-20

### 🎉 Initial Beta Release

**Core Features:**
- Slack slash commands (`/decision`, `/decisions`)
- AI-powered transcript extraction with Claude
- MongoDB Atlas storage
- Basic web dashboard
- Semantic search with OpenAI embeddings
- Multi-workspace OAuth support
- GDPR compliance (export/delete)

**Integrations:**
- Slack Bot with OAuth
- MongoDB Atlas with vector search
- Anthropic Claude API
- OpenAI Embeddings API
- Jira API (global config)

---

## Migration Guide

### From 0.2.0 to 0.3.0

**Required Actions:**

1. **Add New Environment Variables to Railway:**
   ```bash
   ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   SESSION_SECRET=<generate if not set>
   SLACK_STATE_SECRET=<generate if not set>
   ```

2. **Add New Slash Commands to Slack App:**
   - `/settings` - Configure Jira (admins only)
   - `/permissions` - Manage permissions (admins only)
   - `/login` - Get dashboard login link

3. **Add New Bot Scope:**
   - Go to Slack App → OAuth & Permissions
   - Add scope: `users:read.email`
   - Reinstall app to workspace

4. **Migrate Jira Configuration (if using):**
   - If you had global Jira config, you can now remove those env vars
   - Have workspace admins run `/settings` to configure Jira per-workspace
   - Old global config will be used as fallback during transition

**Optional Actions:**

1. **Grant Admin Access:**
   - Slack Workspace Admins are auto-promoted
   - Use `/permissions grant @user` to promote others

2. **Test Permissions:**
   - Log in as non-admin user
   - Verify they can't edit others' decisions
   - Verify admins can edit any decision

**Breaking Changes:**
- None - all changes are backward compatible
- Global Jira config still works but is deprecated in favor of per-workspace config

---

## Upcoming Features

### In Development 🚧
- [ ] Decision templates
- [ ] Bulk import from Slack history
- [ ] Enhanced analytics dashboard
- [ ] Decision reversal tracking
- [ ] Viewer role (read-only access)

### Under Consideration 💭
- [ ] Passive decision detection (monitor channels)
- [ ] Integration triggers (Jira, GitHub)
- [ ] Decision impact tracking
- [ ] Team alignment scores
- [ ] Notion integration

---

## Support

**Questions or Issues?**
- 📖 [Beta Setup Guide](BETA_SETUP_GUIDE.md)
- 🐛 [Report Issues](https://github.com/cristiantumani/corteza.app/issues)
- 📧 Email: cristiantumani@gmail.com

**Feedback:**
We're actively improving based on beta tester feedback. Please share:
- What features do you love?
- What's confusing or broken?
- What would make this more useful for your team?

---

Made with ❤️ for teams who learn from their decisions
