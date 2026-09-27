# Recent Updates - Corteza Team Memory

**Last Updated:** May 23, 2026

This document tracks all major features, improvements, and bug fixes recently added to Corteza Team Memory.

---

## 🎉 Major Features

### 1. **Spaces System** (Released: May 2026)

The biggest feature addition - organize your team's decisions by project, team, or privacy level.

#### What are Spaces?

Spaces are containers within your workspace that help you organize decisions by:
- **Teams** (Engineering, Product, Marketing)
- **Projects** (Q2 Roadmap, Website Redesign)
- **Privacy levels** (Leadership decisions, Public knowledge)

#### Visibility Levels

- **Public** - All workspace members can view and contribute
- **Shared** - Only invited members can access and contribute
- **Private** - Only you (and invited members) can see these decisions

#### Key Features

✅ **Create unlimited spaces** - Organize by team, project, or any structure
✅ **Granular permissions** - Owner, Admin, Member, Viewer roles
✅ **Direct invitations** - Invite people to specific spaces via email
✅ **Smart filtering** - Filter decisions by space in dashboard
✅ **Space-aware search** - Semantic search respects space permissions
✅ **Visual indicators** - Color-coded badges, icons, privacy indicators
✅ **Default spaces** - Backward compatible with existing workflows

#### Where Spaces Work

- ✅ **Web Dashboard** - Full space management UI
- ✅ **Chrome Extension** - Select space when logging decisions
- ✅ **Slack Integration** - Choose space in `/decision` modal
- ✅ **Obsidian Plugin** - Set default space in settings
- ✅ **API** - All endpoints support space filtering

#### Documentation

- See `SPACES_DEPLOYMENT.md` for technical details
- See updated README.md for user guide

---

### 2. **Chrome Extension Space Integration** (Released: May 23, 2026)

The Chrome extension now fully supports the spaces system.

#### What's New

✅ **Visual Context Bar** - Purple gradient bar showing current workspace and space
✅ **Space Selector** - Dropdown with all accessible spaces
✅ **Space Icons** - See custom icons and privacy indicators (🔒)
✅ **Persistent Selection** - Remembers last selected space
✅ **Empty State** - Clear guidance when no spaces exist

#### User Experience

- Log in once → See all your spaces
- Select space → Saved for next time
- Create decision → Goes to selected space
- Switch spaces → One click in dropdown

#### Technical Details

- Uses `/api/spaces` endpoint
- Session-based authentication
- Chrome storage API for persistence
- Real-time space loading

---

### 3. **Direct Space Invitations** (Released: May 2026)

Invite people directly to spaces without two-step process.

#### How It Works

**Before:** Invite to workspace → Then add to space
**After:** Invite directly to space → Auto-added to both

#### Benefits

- Faster onboarding
- Less friction for new members
- Clear context - "You're invited to join the Product Growth space"
- Single signup flow

#### Where Available

- Dashboard Settings → Space Management → Invite by Email
- Space creation flow → Add members immediately
- Email invites → One-click signup

---

## 🔧 Improvements

### Dashboard & UI

- **Streamlined space creation** - Inline form with immediate member invitation
- **Enhanced member display** - Show names and emails instead of user IDs
- **Improved empty states** - Clear guidance when no spaces exist
- **Context indicators** - Always visible workspace/space context

### Permissions & Access

- **Workspace admin access** - Admins can manage all spaces (even if not members)
- **Space creator model** - Creators must explicitly add themselves (true privacy)
- **Permission inheritance** - Clear hierarchy (workspace admins > space owners > admins > members)

### Onboarding

- **Eliminated duplicate forms** - Single signup flow for invited users
- **Skip redundant onboarding** - Invited users go straight to dashboard
- **Pre-filled context** - Invites include workspace and space info

---

## 🐛 Bug Fixes

### PDF Upload AI Extraction

**Issue:** "pdfParse is not a function" error when uploading PDFs
**Root Cause:** pdf-parse v2.4.5 changed export format
**Fix:** Handle both CommonJS and ES module exports
**Status:** ✅ Fixed

### Chrome Extension Errors

**Issue 1:** "Cannot read properties of undefined (reading 'local')"
**Fix:** Added 'storage' permission to manifest.json
**Status:** ✅ Fixed

**Issue 2:** "Open Dashboard" button not working
**Fix:** Replaced inline onclick with proper event listener
**Status:** ✅ Fixed

**Issue 3:** Event listener errors on null elements
**Fix:** Added defensive null checks
**Status:** ✅ Fixed

### Space Member Management

**Issue:** Admins couldn't view space members
**Root Cause:** Wrong permission check (canAccessSpace vs canModifySpace)
**Fix:** Use canModifySpace for management operations
**Status:** ✅ Fixed

**Issue:** Members showing as "U5EA8CEE7" instead of names
**Root Cause:** space_members collection doesn't store email
**Fix:** Enrich with data from workspace_members
**Status:** ✅ Fixed

### Duplicate Onboarding

**Issue:** Users invited to spaces asked for password/name twice
**Root Cause:** Invite signup marked onboarding incomplete
**Fix:** Set onboarding_completed: true, redirect to dashboard
**Status:** ✅ Fixed

### Space Creator Auto-Membership

**Issue:** Admins auto-added to private spaces they created
**Root Cause:** Auto-add logic in space creation
**Fix:** Removed auto-add, creators must explicitly join
**Status:** ✅ Fixed

---

## 📊 Technical Improvements

### Database

- New collections: `workspace_spaces`, `space_members`
- Enhanced indexes for performance
- Denormalized space_name in decisions for faster queries
- Migration script for backward compatibility

### API Endpoints

**New endpoints:**
- `GET /api/spaces` - List accessible spaces
- `POST /api/spaces` - Create space
- `GET /api/spaces/:space_id` - Get space details
- `PUT /api/spaces/:space_id` - Update space
- `DELETE /api/spaces/:space_id` - Archive space
- `GET /api/spaces/:space_id/members` - List members
- `POST /api/spaces/:space_id/members` - Add member
- `DELETE /api/spaces/:space_id/members/:uid` - Remove member
- `PUT /api/spaces/:space_id/members/:uid` - Update role

**Updated endpoints:**
- `GET /api/decisions` - Now supports space_id filter
- `POST /api/memory/create` - Requires space_id
- `POST /api/invites` - Supports space_id and space_role

### Permission System

New permission functions:
- `getUserAccessibleSpaces()` - Get all spaces user can see
- `canAccessSpace()` - Check if user can view space content
- `canModifySpace()` - Check if user can manage space settings
- `canCreateInSpace()` - Check if user can create decisions in space
- `addSpaceMember()` - Add user to space
- `removeSpaceMember()` - Remove user from space

### Chrome Extension

- Added storage permission
- Implemented space loading from API
- Added persistent space selection
- Enhanced error handling and logging
- Improved UI with context indicators

---

## 📝 Documentation Updates

### Updated Files

- ✅ README.md - Added spaces section
- ✅ browser-extension/README.md - Added space selection guide
- ✅ CHANGELOG.md - Version history
- ✅ SPACES_DEPLOYMENT.md - Technical implementation
- 🔄 QUICK_START_BETA.md - Needs update
- 🔄 BETA_TESTER_GUIDE.md - Needs update
- 🔄 Website content - Needs update

### New Documentation Needed

- [ ] Spaces User Guide - Detailed how-to for end users
- [ ] Space Management Best Practices - Organizational patterns
- [ ] Migration Guide - For existing workspaces
- [ ] API Documentation - Updated with space endpoints
- [ ] Video Tutorials - Space creation, management, and usage

---

## 🚀 What's Next

### Short Term (In Progress)

- [ ] Update website with spaces announcement
- [ ] Create video tutorials
- [ ] Update marketing materials
- [ ] Notify existing users about spaces
- [ ] Create migration guide for existing workspaces

### Medium Term (Planned)

- [ ] Space templates (Engineering, Product, Marketing presets)
- [ ] Bulk member management
- [ ] Space analytics dashboard
- [ ] Export/import spaces
- [ ] Space-level integrations (GitHub, Jira per space)

### Long Term (Roadmap)

- [ ] Sub-spaces (nested organization)
- [ ] Space cloning/duplication
- [ ] Advanced permission models
- [ ] Guest access (non-workspace members)
- [ ] Space marketplace (templates, best practices)

---

## 📞 Need Help?

- **Documentation:** See README.md and SPACES_DEPLOYMENT.md
- **Bug Reports:** GitHub Issues
- **Feature Requests:** BACKLOG.md
- **Questions:** Email support or Slack channel

---

*This document is continuously updated as new features are released.*
