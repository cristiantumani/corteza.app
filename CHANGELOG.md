# Changelog

All notable changes to Corteza will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Changed - Gemini notes and import messages
- **Gemini notes can be read:** Google Meet connect now also asks for Drive read access (`drive.readonly`), because `drive.meet.readonly` doesn't cover Gemini notes Docs. Existing connections see a "Reconnect" prompt in Settings
- **Import messages are plain language** ("Google doesn’t let Corteza read this meeting’s Gemini notes."); Google's technical reason and extraction errors are logged server-side only
- Drive export errors are logged as one readable line instead of raw JSON

### Fixed - Google Meet access errors
- A meeting whose transcript or notes Google refuses no longer blocks automatic capture of the user's other meetings
- Meetings are captured from whichever source is readable (transcript, transcript Doc, or Gemini notes)
- Import errors now say what Google refused and why, and show the meeting title; the reason is also logged
- Titles like "1:1 Ana / Bob: 2026/09/01 15:30 GMT-03:00" are cleaned to "1:1 Ana / Bob"

### Added - Import past Google Meet meetings
- **Settings → Google Meet → Import past meetings:** pick a month or date range (up to 92 days, with presets), see every meeting in that period with participants, whether a transcript or Gemini notes exist, and whether it was already imported
- **Choose what to import:** tick meetings (or "Select all available"), choose the space, and import up to 50 at a time. Runs in the background with a progress bar and per-meeting results
- **Manual imports override the automatic skip rules** (1:1s, title keywords); completed meetings are never imported twice; interrupted imports resume automatically
- New `ingestion/meet-import.js`, `meet_imports` collection, Meet client range listing and a lightweight `describeMeeting`

### Added - Automatic decision capture from Google Meet
- **Settings → Google Meet → Connect.** Separate consent for `meetings.space.readonly` and `drive.meet.readonly` with offline access. The refresh token is stored encrypted in `google_connections`, and the connected account must match the signed-in user
- **Poller** (`jobs/meet-poller.js`, every 5 min): finds meetings that ended, reads transcripts (speaker-labelled) and Gemini notes, and saves every extracted decision automatically, marked AI-captured with confidence, meeting title and a link to the transcript/notes
- **Privacy defaults:** 1:1 meetings skipped, title keyword exclusions, choice of destination space
- **Reliability:** each meeting is processed once (`ingestions`, unique per meeting) even with several connected participants; late transcripts retried for 6h; failed extractions retried up to 3 times; revoked Google access shown in Settings with a Reconnect link
- **Summary email** to the connected user with the captured decisions; "Check for new meetings now" button; recent meetings list in Settings
- **Dashboard:** "✨ AI-captured" badge and "Google Meet: <meeting>" link on decision cards
- **New modules:** `core/decisions/decision-service.js` (single write path with atomic per-workspace ids, `counters`), `ingestion/pipeline.js`, `ingestion/sources/google-meet.js`, `integrations/google/{connections,meet-client,routes}.js`
- **Docs:** `docs/integrations/google-meet.md`

### Added - Sign in with Google
- **Google is the only way to sign in.** "Continue with Google" on `/auth/login` (OpenID Connect with state, nonce and ID-token verification; the session ID is regenerated on login)
- **Domain workspaces:** a company's Google Workspace domain (the `hd` claim) is its Corteza workspace. The first person creates it and becomes admin; colleagues on the same domain join automatically. Consumer accounts (gmail.com) get a personal workspace
- **Existing users are linked by email.** An admin of an existing workspace claims their Google domain on first sign-in. `scripts/migrations/002-link-workspace-to-google.js` links workspaces created through Slack or magic links
- **Invites** go through Google (`/auth/google?invite=<id>`); invites addressed to an email only work for that Google account
- New `workspaces` and `users` collections; new code in `src/auth`, `src/core/{workspaces,users,invites}` and `src/integrations/google`
- Chrome extension 1.1.0: "Sign in with Google" replaces the email login form

### Removed
- Magic-link email login, passwords (login, reset, Settings "change password", invite sign-up), Slack `/login` sign-in (the command now links to the web sign-in), one-time login tokens, and the `bcrypt` dependency

### Fixed
- Completing onboarding overwrote the member's workspace `role` (admin/member) with the job title from the form. The job title is now stored as `role_title`; `scripts/migrations/003-repair-member-roles.js` repairs affected members
- The dashboard's admin flag (`/auth/me`) and admin-only settings endpoints only checked Slack admin status, so admins of workspaces without Slack were never treated as admins. They now check `workspace_admins` first

### 🔒 Security
- Magic links can no longer be used to join an existing workspace. Anyone could type another team's workspace name and get admin access; now joining an existing workspace needs an invite. Slack `/login` users join as members, not admins
- One-time login tokens are stored hashed in MongoDB (`login_tokens`, auto-expiring) instead of in memory, so they survive restarts and work across instances. Password-reset links can no longer be used to log in
- `GET /api/spaces` only lists spaces of the caller's own workspace
- Removed the committed extension signing key and build files; `*.pem`/`*.crx` are now gitignored

### Fixed
- Logging a decision failed with "No space selected" when a workspace had no spaces. Every workspace now gets a default "General" space automatically
- Decisions from Slack (`/decision`, AI approvals) were saved without a space and never showed in the dashboard. They now go to the default space; `scripts/migrations/001-backfill-default-spaces.js` fixes existing ones
- Admins could pick private spaces they can't post to. The Log Decision form now has a space picker listing only writable spaces (`can_create`, `?writable=true`), also used by the extension
- Password login crashed when a member had no `workspace_name`
- AI analytics queries for epics and rejection reasons ignored the `null` check (duplicate `$ne` keys)

### Removed
- Obsidian plugin, Obsidian import (`/api/v1/import/obsidian*`) and export (`/api/export/obsidian`), and the `archiver` dependency
- Old dashboard/settings pages (`/dashboard-old`, `/settings-old`, backups, minimal dashboard), `index.js.old/.backup`, one-off root scripts, unmounted test-login routes

### Changed
- Outdated docs moved to `docs/archive/`; new `CLAUDE.md` and `docs/ARCHITECTURE.md` describe the current system and the Google Workspace refocus plan
- Added `npm test` (node:test), `npm run lint` (ESLint) and GitHub Actions CI with a MongoDB service; `package-lock.json` regenerated so `npm ci` works
- `/api/extract-decisions` now only runs against the caller's own workspace, so another workspace's approved/rejected examples can no longer be pulled into the AI prompt
- Approving or rejecting an AI suggestion from the dashboard now checks that it belongs to the caller's workspace

### Added - Google Drive transcript import (Phase 0)
- `POST /api/v1/extract`: API-key endpoint for automations (e.g. Google Drive → n8n). Extracted decisions are saved as pending suggestions in the target space (or the workspace's default space)
- Dashboard banner listing pending AI suggestions for the current space, with review/approve/reject (`GET /api/ai/pending-suggestions`)
- File upload accepts `.md` and `.vtt`/`.srt` caption files (Google Meet, Zoom and Teams transcripts)

### Changed
- `docs/integrations/n8n-google-drive.md` (was `N8N_AUTOMATIONS_GUIDE.md`): Drive workflow now uses an API key instead of a copied session cookie, and exports Google Docs as text
- `docs/n8n-email-setup.md` marked deprecated (emails are sent via Resend)
- Upload no longer offers legacy `.doc`, which the parser never supported

---

## [0.4.0] - 2026-05-23

### 🎉 Added - Spaces System

**Major Feature: Organize decisions by team, project, or privacy level**

**New Features:**
- **Spaces within Workspaces:** Create unlimited spaces to organize decisions
- **3 Visibility Levels:**
  - 🌍 **Public** - All workspace members can view and contribute
  - 👥 **Shared** - Only invited members can access
  - 🔒 **Private** - Personal space for sensitive decisions
- **Granular Permissions:** Owner, Admin, Member, Viewer roles per space
- **Direct Space Invitations:** Invite people directly to spaces via email
- **Space-Aware Search:** Semantic search respects space permissions
- **Visual Indicators:** Color-coded badges, icons, privacy indicators
- **Default Spaces:** Backward compatible - existing decisions auto-migrated to "General" space

**Technical:**
- New collections: `workspace_spaces`, `space_members`
- Updated collections: `decisions` (added space_id, space_name)
- New API endpoints: `/api/spaces/*` for space management
- Enhanced permission system with workspace + space levels
- Migration script for existing workspaces

### 🌐 Added - Chrome Extension Space Integration

**Extension Now Supports Spaces:**
- **Visual Context Bar:** Purple gradient showing workspace and current space
- **Space Selector:** Dropdown with all accessible spaces
- **Space Icons:** Custom icons and privacy indicators (🔒)
- **Persistent Selection:** Remembers last selected space
- **Empty State:** Guidance when no spaces exist

**Technical:**
- Added `storage` permission to manifest.json
- Implemented `/api/spaces` endpoint integration
- Chrome storage API for space persistence
- Defensive error handling and null checks

### 🔧 Improved - Onboarding & Invitations

**Streamlined User Experience:**
- **One-Step Invitations:** Invite directly to spaces (no two-step process)
- **Eliminated Duplicate Onboarding:** Users only enter details once
- **Inline Space Creation:** Add members immediately after creating space
- **Enhanced Member Display:** Show names and emails instead of user IDs
- **Auto-Membership:** Invited users auto-added to both workspace and space

### 🐛 Fixed

**PDF Upload:**
- Fixed "pdfParse is not a function" error (pdf-parse v2.4.5 compatibility)
- Handle both CommonJS and ES module exports

**Chrome Extension:**
- Fixed "Cannot read properties of undefined (reading 'local')" - added storage permission
- Fixed "Open Dashboard" button not working - proper event listener
- Fixed event listener errors on null elements - defensive null checks

**Space Management:**
- Fixed admins unable to view space members - use `canModifySpace()` permission
- Fixed members showing as user IDs - enrich with workspace_members data
- Fixed duplicate onboarding for invited users - set onboarding_completed: true
- Fixed auto-membership for private spaces - creators must explicitly join

**Permissions:**
- Workspace admins can manage all spaces (even if not members)
- Space creators don't auto-join private spaces (true privacy)
- Clear permission hierarchy: workspace admins > space owners > admins > members

### 📚 Documentation

**New Files:**
- **RECENT_UPDATES.md** - Comprehensive list of all recent changes
- **SPACES_DEPLOYMENT.md** - Technical implementation guide

**Updated Files:**
- **README.md** - Added spaces section, updated features
- **browser-extension/README.md** - Added space selection guide
- **CHANGELOG.md** - This file

### 🔄 Database Changes

**New Collections:**
```javascript
workspace_spaces: {
  space_id, workspace_id, name, description,
  visibility, created_by, is_default, archived, settings
}

space_members: {
  membership_id, workspace_id, space_id,
  user_id, role, added_by, removed_at
}
```

**Updated Collections:**
```javascript
decisions: {
  // NEW fields
  space_id: "sp_abc123xyz",
  space_name: "Engineering Team"
}

workspace_invites: {
  // NEW fields
  space_id: "sp_abc123xyz",
  space_role: "member"
}
```

### 🚀 Migration

**Automatic Migration:**
- All existing decisions moved to default "General" space (public)
- Workspace owners assigned as space owners
- No action required from users
- Zero downtime migration

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
