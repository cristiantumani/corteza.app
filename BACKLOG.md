# Corteza Development Backlog

**Last Updated:** 2026-05-21
**Status:** Active Development

---

## 🚨 High Priority - Critical Issues

### 1. Space Member Addition Not Working
**Status:** Debugging
**Issue:** "User not found in workspace" error when adding member by email
**Steps to resolve:**
- [ ] Check Railway logs for debug output (added detailed logging)
- [ ] Verify invited user actually accepted workspace invite
- [ ] Confirm workspace_members table has correct email entries
- [ ] Test the flow end-to-end: Invite → Accept → Add to Space

**Debug questions to answer:**
- Did the invited user click the invite link and accept?
- Is the email in workspace_members collection?
- Is workspace_id matching correctly?

**Files involved:**
- `src/routes/spaces-api.js` (member lookup logic)
- `src/routes/invites-api.js` (workspace invite acceptance)

---

## 🎯 High Priority - New Features

### 2. Replace Magic Links with Password Authentication
**Status:** Not Started
**User Request:** "Magic links are annoying for returning users"

**Requirements:**
1. **First-time users:**
   - Enter email → Receive magic link
   - Click magic link → Log in
   - Prompted to set password (decide: required or optional?)
   - Next login: Use email + password

2. **Returning users:**
   - Login page: Email + Password fields
   - "Forgot password?" → Sends magic link as fallback
   - Regular credential-based login

3. **Existing users:**
   - Prompt to set password on next login?
   - Send email notification about password feature?

**Questions to clarify:**
- [ ] Should password setup be required or optional after first magic link?
- [ ] Should login page show both options (password + magic link)?
- [ ] How to handle existing magic-link-only users?

**Implementation tasks:**
- [ ] Add password field to users/workspace_members schema
- [ ] Create password hashing (bcrypt)
- [ ] Build password setup page/modal
- [ ] Update login page to support email+password
- [ ] Add "Forgot password" flow (sends magic link)
- [ ] Migration strategy for existing users

**Files to create/modify:**
- `src/routes/auth-password.js` (new)
- `src/views/set-password.html` (new)
- `src/views/login.html` (modify)
- `src/routes/email-auth.js` (modify)
- Database schema updates

---

## ✅ Recently Completed

- [x] Workspace-first architecture (workspaces are admin containers)
- [x] Spaces are private by default (like Google Docs)
- [x] Empty dashboard shows admin-focused view
- [x] No "All Accessible Spaces" option (must select specific space)
- [x] Remove default "General" space auto-creation
- [x] Email-based space member addition (instead of user_id)
- [x] Fixed smart quotes JavaScript error in invite.html
- [x] Handle null Slack clients for email-authenticated workspaces

---

## 📋 Medium Priority - Improvements

### 3. User Experience Polish
- [ ] Better onboarding flow for first-time workspace creators
- [ ] Tooltips/help text explaining workspace vs space concept
- [ ] "Getting Started" guide or wizard
- [ ] Better error messages throughout the app

### 4. Workspace Invite Flow
- [ ] Add status indicator: "Invite sent" → "Pending" → "Accepted"
- [ ] Show which users have accepted invites
- [ ] Resend invite functionality
- [ ] Expire old invites automatically

### 5. Space Management
- [ ] Bulk add members to spaces (CSV upload?)
- [ ] Copy/move decisions between spaces
- [ ] Archive spaces (soft delete)
- [ ] Space templates (pre-configured settings)

---

## 🐛 Known Issues / Technical Debt

### 6. Migration Script Cleanup
**Issue:** Old workspaces still have "General" space from migration
**Options:**
- Document how to manually delete via Settings
- Create cleanup script for old "General" spaces
- Leave as-is (existing workspaces keep their data)

**Decision needed:** What to do with existing "General" spaces?

### 7. Database Inconsistencies
- [ ] Review all email normalization (lowercase + trim)
- [ ] Ensure workspace_id consistency across collections
- [ ] Add database constraints/validation
- [ ] Index optimization for common queries

### 8. Debug Logging
**Current state:** Heavy debug logging added for space member lookup
**To do:**
- [ ] Review and clean up debug logs once issue resolved
- [ ] Implement proper logging levels (debug, info, warn, error)
- [ ] Add request ID tracking for better debugging

---

## 💡 Future Ideas (Low Priority)

### 9. Advanced Permissions
- [ ] Custom roles beyond (owner, admin, member, viewer)
- [ ] Granular permissions per space
- [ ] Audit log of who accessed what

### 10. Integrations
- [ ] Slack notifications when added to space
- [ ] Email digests of space activity
- [ ] API webhooks for external systems

### 11. Analytics & Insights
- [ ] Decision trends over time
- [ ] Most active spaces
- [ ] User engagement metrics
- [ ] Export reports

---

## 🔧 Technical Improvements

### 12. Code Quality
- [ ] Add TypeScript (gradual migration)
- [ ] Implement automated tests (unit + integration)
- [ ] Set up CI/CD pipeline
- [ ] Add code linting and formatting

### 13. Performance
- [ ] Implement caching layer (Redis?)
- [ ] Optimize database queries
- [ ] Add pagination for large lists
- [ ] Lazy loading for dashboard

### 14. Security
- [ ] Rate limiting on all endpoints (partially done)
- [ ] Input sanitization audit
- [ ] CSRF protection
- [ ] Security headers (helmet.js)
- [ ] Penetration testing

---

## 📝 Documentation Needs

### 15. User Documentation
- [ ] User guide: Workspaces vs Spaces
- [ ] How to invite team members
- [ ] How to organize decisions
- [ ] FAQ section

### 16. Developer Documentation
- [ ] Architecture overview
- [ ] Database schema documentation
- [ ] API documentation
- [ ] Deployment guide
- [ ] Contributing guidelines

---

## Decision Matrix

| Priority | Item | Effort | Impact | Start Date |
|----------|------|--------|--------|------------|
| 🚨 Critical | Space member addition bug | Small | High | 2026-05-21 |
| 🎯 High | Password authentication | Large | High | TBD |
| 📋 Medium | UX polish | Medium | Medium | TBD |
| 💡 Future | Advanced permissions | Large | Low | Backlog |

---

## Questions for Next Session

1. **Space member issue:** What do the Railway logs show?
2. **Password auth:** What's the preferred UX flow?
3. **Old "General" spaces:** Keep or clean up?
4. **Priority:** What should we tackle first tomorrow?

---

## Notes

- All recent changes deployed to Railway successfully
- Email-authenticated workspaces working correctly
- Workspace-first model implemented and tested
- Debug logging active for troubleshooting

**Good night! Pick up tomorrow with Railway log analysis.**
