# Session Plan: Browser Extension for Team Memory Logging

**Date:** 2026-02-07
**Epic:** Multi-Entry Point Team Memory Logging
**Feature:** Browser Extension (Chrome/Edge)
**Estimated Duration:** 6-8 hours (split into 2 sessions recommended)
**Credits Budgeted:** 80,000-100,000 tokens

---

## Session Goal

Implement a Chrome/Edge browser extension that allows users to log team memory (decisions, explanations, context, learnings, risks, assumptions) from anywhere on the web. Users can trigger the extension via icon click or keyboard shortcut, fill in a compact form, and submit directly to Corteza backend.

**Success Criteria:**
- [ ] Extension installable in Chrome/Edge browsers
- [ ] Popup form allows memory logging with all 6 types
- [ ] Authentication works (reuses existing session or API key)
- [ ] Memories successfully saved to Corteza with `source: "browser-extension"`
- [ ] Extension icon shows logged-in status
- [ ] Keyboard shortcut works (Ctrl+Shift+M / Cmd+Shift+M)
- [ ] No security vulnerabilities introduced
- [ ] Works on any webpage (doesn't interfere with page content)

**Out of Scope (Deferred):**
- Firefox extension (Phase 2)
- Safari extension (Phase 3)
- Context menu integration (future enhancement)
- Highlighting text on page to auto-fill form (future enhancement)
- Offline support (future enhancement)
- Extension settings page (future enhancement)

---

## Current State Analysis

### Existing Entry Points
1. **Slack** (`/memory` command) → `source: "slack"`
2. **Dashboard** (Log Memory button) → `source: "dashboard"`
3. **API** (Coda Pack, integrations) → `source: "api"`

### API Endpoint (Already Exists)
**Endpoint:** `POST /api/memory/create`

**Request:**
```json
{
  "text": "We decided to use PostgreSQL for the main database",
  "type": "decision",
  "category": "technical",
  "tags": "database, architecture",
  "epic_key": "PROJ-123",
  "alternatives": "MySQL, MongoDB",
  "source": "browser-extension"
}
```

**Authentication:** Session-based (cookie) OR API key (Bearer token)

**Response:**
```json
{
  "success": true,
  "memory": {
    "id": 456,
    "text": "...",
    "timestamp": "2026-02-07T10:00:00Z"
  },
  "message": "Memory saved successfully"
}
```

### Memory Types (6 types)
- `decision` - Choices and commitments made
- `explanation` - How things work, technical details
- `context` - Background info, constraints, timelines
- `learning` - Lessons learned, insights
- `risk` - Potential risks and concerns
- `assumption` - Assumptions made

---

## Task Breakdown & Prioritization

### ✅ Critical (Must Complete - Session 1)

#### 1. Create Extension Directory Structure
**Complexity:** Simple (S) - 15 min
**Why now:** Foundation for all other work

**Files to create:**
```
browser-extension/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── background.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

#### 2. Create manifest.json
**Complexity:** Simple (S) - 20 min
**Why now:** Required for extension to load

**Key config:**
- Extension name, version, description
- Permissions (storage, activeTab, cookies for auth)
- Popup HTML file
- Background script
- Icons
- Keyboard shortcut
- Content Security Policy

#### 3. Design Popup UI (HTML/CSS)
**Complexity:** Medium (M) - 45 min
**Why now:** Core user interface

**Requirements:**
- Compact form (300x500px popup)
- Text area for memory content
- Dropdown for type (6 options)
- Optional fields: category, tags, epic_key, alternatives
- Submit button
- Status indicator (logged in/out)
- Error/success messages
- Clean, minimal design matching Corteza brand

#### 4. Implement Authentication Logic
**Complexity:** Complex (C) - 90 min
**Why now:** Required for API calls, most complex part

**Approaches (choose one):**

**Option A: Session Cookie (Recommended)**
- Extension shares cookies with corteza.app domain
- Check `/auth/me` endpoint to verify session
- Pros: Simple, reuses existing auth
- Cons: Requires user to be logged into dashboard

**Option B: API Key**
- User enters API key in extension
- Store encrypted in chrome.storage.sync
- Pros: Works without dashboard session
- Cons: User must generate key first

**Recommendation:** Start with Option A (session), add Option B later

**Implementation:**
- background.js: Check auth status on icon click
- popup.js: Verify auth on popup open
- Show login button if not authenticated
- Store workspace_id for API calls

#### 5. Implement Memory Submission
**Complexity:** Medium (M) - 45 min
**Why now:** Core functionality, depends on auth

**Implementation:**
- popup.js: Form validation
- Collect form data (text, type, category, tags, epic_key, alternatives)
- POST to `/api/memory/create`
- Add `source: "browser-extension"`
- Handle success/error responses
- Show confirmation message
- Clear form on success

#### 6. Icon and Badge Logic
**Complexity:** Simple (S) - 20 min
**Why now:** Visual feedback for user status

**Implementation:**
- background.js: Set icon based on auth status
- Green badge: logged in
- Red badge: not logged in
- Update on auth change

### ⚡ High Value (Should Complete - Session 1)

#### 7. Create Extension Icons
**Complexity:** Simple (S) - 30 min
**Why: ** Professional appearance

**Create 3 sizes:**
- 16x16 (toolbar)
- 48x48 (extensions page)
- 128x128 (Chrome Web Store)

**Design:**
- Use Corteza logo/branding
- Simple, recognizable at small sizes
- Black theme to match brand

#### 8. Add Keyboard Shortcut
**Complexity:** Simple (S) - 15 min
**Why:** Power user feature

**Shortcut:** `Ctrl+Shift+M` (Windows/Linux), `Cmd+Shift+M` (Mac)
**Action:** Open popup

#### 9. Error Handling & Validation
**Complexity:** Medium (M) - 30 min
**Why:** User experience

**Validations:**
- Text is required (min 10 chars)
- Type is required
- Tags format (comma-separated)
- Max length limits

**Errors:**
- Network errors
- Auth errors (401)
- Validation errors (400)
- Server errors (500)

#### 10. Write Extension README
**Complexity:** Simple (S) - 20 min
**Why:** Developer and user documentation

**Sections:**
- Installation instructions (Chrome/Edge)
- How to use
- Development setup
- Building for production
- Troubleshooting

### 💡 Nice-to-Have (Session 2 or Future)

#### 11. Recent Memories Display
**Complexity:** Medium (M) - 40 min
**Why:** User can see what they've logged

**Implementation:**
- Popup shows last 3-5 memories
- Click to view in dashboard
- Refresh button

#### 12. Auto-fill from Page Context
**Complexity:** Complex (C) - 90 min
**Why:** Convenience feature

**Implementation:**
- Content script reads page title/URL
- Pre-fill text area with page context
- User can edit before submitting

#### 13. Extension Settings Page
**Complexity:** Medium (M) - 60 min
**Why:** Configuration options

**Settings:**
- API key storage (if using Option B)
- Default memory type
- Auto-fill preferences
- Keyboard shortcut customization

---

## Dependencies & Execution Order

```
Task 1 (Directory) → Task 2 (Manifest) → All other tasks
Task 4 (Auth) → Task 5 (Submission) → Task 6 (Icon status)
Task 3 (UI) → Task 5 (Submission)
Task 3 (UI) + Task 4 (Auth) → Task 9 (Error handling)
```

**Execution Order:**
1. Directory structure
2. Manifest configuration
3. Popup UI (HTML/CSS)
4. Authentication logic (most complex, do when fresh)
5. Memory submission
6. Icon/badge logic
7. Create icons (can parallelize with coding)
8. Keyboard shortcut
9. Error handling
10. README

---

## Execution Plan

### Session 1: Core Extension (4-5 hours)

#### Phase 1: Setup & Configuration (45 min)
- Create directory structure (Task 1)
- Create manifest.json (Task 2)
- Set up basic popup HTML structure (Task 3 start)

**Break Point:** Commit "Browser extension scaffolding"

#### Phase 2: UI Development (60 min)
- Complete popup HTML (Task 3)
- Create popup CSS (Task 3)
- Make form functional (no API yet)

**Testing:** Load unpacked extension, verify popup opens and looks good

**Break Point:** Commit "Browser extension UI complete"

#### Phase 3: Authentication (90 min)
- Implement background.js auth check (Task 4)
- Add auth status to popup (Task 4)
- Test session cookie sharing (Task 4)
- Handle not-authenticated state (Task 4)

**Testing:**
- Load extension while logged into dashboard
- Verify auth status shows in popup
- Log out of dashboard, verify extension shows "not authenticated"

**Break Point:** Commit "Browser extension authentication"

#### Phase 4: Core Functionality (60 min)
- Implement form submission (Task 5)
- POST to /api/memory/create (Task 5)
- Handle responses (Task 5)
- Update icon based on status (Task 6)

**Testing:**
- Submit test memory
- Verify appears in dashboard /decisions list
- Check `source: "browser-extension"` in database

**Break Point:** Commit "Browser extension memory submission working"

#### Phase 5: Polish (45 min)
- Add keyboard shortcut (Task 8)
- Basic error handling (Task 9)
- Create placeholder icons (Task 7 - simple versions)
- Write basic README (Task 10)

**Testing:** End-to-end test

**Break Point:** Commit "Browser extension v1 complete"

---

### Session 2: Enhancement & Polish (2-3 hours, Optional)

#### Phase 1: Professional Icons (30 min)
- Design proper icons (Task 7)
- Export all sizes
- Update manifest

#### Phase 2: Enhanced Error Handling (30 min)
- Comprehensive validation (Task 9)
- Better error messages (Task 9)
- Network retry logic (Task 9)

#### Phase 3: Recent Memories (40 min)
- Implement recent memories display (Task 11)
- Add refresh functionality (Task 11)

#### Phase 4: Settings Page (60 min)
- Create settings page (Task 13)
- Add API key option (Task 13)
- Add preferences (Task 13)

---

## Technical Architecture

### Extension Components

```
┌─────────────────────────────────────────┐
│           Browser Toolbar               │
│  [Corteza Icon] ← Click or Ctrl+Shift+M│
└────────────┬────────────────────────────┘
             │
             ▼
      ┌─────────────┐
      │ popup.html  │ (300x500px)
      ├─────────────┤
      │ popup.css   │ (Styling)
      ├─────────────┤
      │ popup.js    │ (Form logic)
      └──────┬──────┘
             │
             │ Check auth, Submit memory
             ▼
      ┌─────────────┐
      │background.js│ (Service worker)
      ├─────────────┤
      │ • Auth check│
      │ • Icon badge│
      │ • API calls │
      └──────┬──────┘
             │
             │ HTTP Requests
             ▼
    ┌────────────────────┐
    │  Corteza Backend   │
    │ /api/memory/create │
    └────────────────────┘
```

### manifest.json Structure

```json
{
  "manifest_version": 3,
  "name": "Corteza Team Memory",
  "version": "1.0.0",
  "description": "Log team decisions, context, and learnings from anywhere on the web",
  "permissions": [
    "storage",
    "cookies",
    "activeTab"
  ],
  "host_permissions": [
    "https://corteza.app/*",
    "https://*.railway.app/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+M",
        "mac": "Command+Shift+M"
      },
      "description": "Open Corteza memory logger"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### Authentication Flow

```
1. Extension loads
   └─→ background.js checks auth via fetch('/auth/me')
       ├─→ 200 OK: User authenticated
       │   └─→ Store workspace_id
       │   └─→ Set green badge
       │   └─→ popup.js shows form
       └─→ 401: User not authenticated
           └─→ Set red badge
           └─→ popup.js shows "Please log in" message
               └─→ Link to dashboard login
```

### Memory Submission Flow

```
1. User fills form in popup
2. Click "Submit"
3. popup.js validates:
   ├─→ Invalid: Show error
   └─→ Valid: Continue
4. popup.js sends to background.js
5. background.js POST to /api/memory/create
   ├─→ Success (200):
   │   └─→ Show success message
   │   └─→ Clear form
   │   └─→ Optional: Fetch recent memories
   └─→ Error:
       ├─→ 401: "Please log in to dashboard first"
       ├─→ 400: Show validation errors
       └─→ 500: "Server error, try again"
```

---

## popup.html Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Log Team Memory</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <!-- Header -->
  <div class="header">
    <h1>🧠 Log Team Memory</h1>
    <div id="auth-status" class="auth-status"></div>
  </div>

  <!-- Login required message (hidden by default) -->
  <div id="login-required" class="login-message" style="display: none;">
    <p>Please <a href="#" id="login-link">log in to Corteza</a> first</p>
  </div>

  <!-- Form (shown when authenticated) -->
  <form id="memory-form" style="display: none;">
    <div class="form-group">
      <label for="text">Memory *</label>
      <textarea
        id="text"
        placeholder="What decision, context, or learning should the team remember?"
        rows="4"
        required
      ></textarea>
    </div>

    <div class="form-group">
      <label for="type">Type *</label>
      <select id="type" required>
        <option value="decision">✅ Decision</option>
        <option value="explanation">💡 Explanation</option>
        <option value="context">📌 Context</option>
        <option value="learning">🎓 Learning</option>
        <option value="risk">⚠️ Risk</option>
        <option value="assumption">🤔 Assumption</option>
      </select>
    </div>

    <div class="form-group">
      <label for="category">Category</label>
      <select id="category">
        <option value="">None</option>
        <option value="product">Product</option>
        <option value="ux">UX</option>
        <option value="technical">Technical</option>
      </select>
    </div>

    <div class="form-group">
      <label for="tags">Tags</label>
      <input
        type="text"
        id="tags"
        placeholder="database, architecture, security"
      />
      <small>Comma-separated</small>
    </div>

    <!-- Collapsible advanced options -->
    <details>
      <summary>Advanced Options</summary>
      <div class="form-group">
        <label for="epic_key">Jira Epic</label>
        <input type="text" id="epic_key" placeholder="PROJ-123" />
      </div>

      <div class="form-group">
        <label for="alternatives">Alternatives Considered</label>
        <input
          type="text"
          id="alternatives"
          placeholder="Option A, Option B"
        />
      </div>
    </details>

    <div class="form-actions">
      <button type="submit" class="btn-primary">Save Memory</button>
    </div>

    <!-- Status messages -->
    <div id="success-message" class="message success" style="display: none;"></div>
    <div id="error-message" class="message error" style="display: none;"></div>
  </form>

  <script src="popup.js"></script>
</body>
</html>
```

---

## Credit Optimization Strategies

### Batch Extension Development

**Instead of:**
```
Request 1: "Create manifest.json"
Request 2: "Create popup.html"
Request 3: "Create popup.css"
Request 4: "Create popup.js"
```

**Do this:**
```
Request: "Create browser extension scaffolding with 4 files:
1. manifest.json - Chrome extension manifest v3 with permissions
2. popup.html - Compact form for memory logging (300x500px)
3. popup.css - Minimal black-themed styling matching Corteza
4. popup.js - Form handling and API submission logic

Use existing /api/memory/create endpoint documented in src/routes/api.js:1297-1371"
```

**Savings: 65-70%**

### Reference Existing Patterns

**Do this:**
```
"Implement authentication in background.js similar to dashboard authentication in src/views/dashboard.html:1259-1280.

Use same session cookie check via /auth/me endpoint.
Store workspace_id in chrome.storage.local."
```

**Savings: 50%** (AI reuses existing patterns)

---

## Testing Plan

### Manual Testing Checklist

#### Installation
- [ ] Load unpacked extension in Chrome
- [ ] Load unpacked extension in Edge
- [ ] Extension appears in toolbar
- [ ] Icon displays correctly

#### Authentication
- [ ] Not logged in: Shows "Please log in" message
- [ ] Log in to dashboard: Extension detects auth
- [ ] Log out of dashboard: Extension shows logged out
- [ ] Badge color changes (green/red)

#### Memory Submission
- [ ] Fill required fields (text, type)
- [ ] Submit → Success message appears
- [ ] Memory appears in dashboard /decisions list
- [ ] Memory has correct `source: "browser-extension"`
- [ ] Form clears after successful submit

#### Validation
- [ ] Empty text → Shows error
- [ ] No type selected → Shows error
- [ ] Invalid tags format → Shows error
- [ ] Network error → Shows retry message

#### Keyboard Shortcut
- [ ] Ctrl+Shift+M (Windows) opens popup
- [ ] Cmd+Shift+M (Mac) opens popup

#### Cross-Browser
- [ ] Works in Chrome
- [ ] Works in Edge (Chromium)

### Automated Testing (Future)
- Jest for popup.js logic
- Integration tests for API calls
- E2E tests with Puppeteer

---

## Security Considerations

### Permissions
- ✅ `storage`: For caching auth status
- ✅ `cookies`: For session auth (read-only)
- ✅ `activeTab`: For future auto-fill from page
- ❌ Avoid `<all_urls>`: Too broad, not needed

### Content Security Policy
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```

### Authentication
- Never store passwords
- Session cookies are httpOnly (secure)
- API keys (if implemented) encrypted in storage
- No credentials in manifest or code

### API Calls
- Always use HTTPS
- Validate all server responses
- Handle 401/403 gracefully
- Rate limiting aware

---

## Deployment Plan

### Development
```bash
cd browser-extension
# Load unpacked in Chrome: chrome://extensions
# Enable developer mode → Load unpacked → Select folder
```

### Production (Chrome Web Store)
1. Zip extension files
2. Create developer account
3. Upload to Chrome Web Store
4. Fill metadata (description, screenshots, privacy policy)
5. Submit for review
6. Publish after approval

### Distribution
- Chrome Web Store (public)
- Direct link for beta testers
- Enterprise deployment (future)

---

## File Structure

```
browser-extension/
├── manifest.json              # Extension configuration
├── popup.html                 # Popup UI structure
├── popup.css                  # Popup styling
├── popup.js                   # Popup logic (form handling)
├── background.js              # Service worker (auth, API calls)
├── icons/
│   ├── icon16.png            # Toolbar icon
│   ├── icon48.png            # Extension management
│   └── icon128.png           # Chrome Web Store
└── README.md                  # Documentation
```

---

## Success Metrics

### Functionality
- [ ] Extension installable in 2 browsers (Chrome, Edge)
- [ ] 100% of test cases passing
- [ ] 0 console errors
- [ ] Average submission time < 30 seconds

### User Experience
- [ ] Popup opens in < 500ms
- [ ] Form submits in < 2 seconds
- [ ] Clear success/error feedback
- [ ] Keyboard shortcut works

### Technical Quality
- [ ] No security vulnerabilities
- [ ] Manifest v3 compliant
- [ ] Follows Chrome extension best practices
- [ ] Code documented with comments

---

## Rollback Plan

If extension causes issues:
1. Remove from Chrome Web Store
2. Notify users to uninstall
3. Fix issues locally
4. Test thoroughly
5. Republish

For local development:
- Git branch for extension
- Can delete folder if not working
- No changes to main backend (uses existing API)

---

## Future Enhancements (Phase 2+)

### Firefox Extension
- Convert to WebExtension format
- Test in Firefox
- Publish to Firefox Add-ons

### Safari Extension
- Convert to Safari App Extension
- Swift wrapper needed
- Test on macOS
- Publish to App Store

### Advanced Features
- Context menu: "Log this as team memory"
- Text selection: Auto-fill from highlighted text
- Page scraping: Extract page title/URL automatically
- Offline mode: Queue memories when offline
- Templates: Pre-defined memory templates
- Sync: Sync settings across devices

---

## Notes

- **Browser focus:** Chrome/Edge first (80%+ market share)
- **Manifest v3:** Required by Chrome (v2 deprecated)
- **Size limit:** Extensions should be < 5MB
- **Update strategy:** Auto-updates from Chrome Web Store
- **Privacy:** Extension doesn't read page content (respects user privacy)

---

## Related Documentation

- Chrome Extension Docs: https://developer.chrome.com/docs/extensions/
- Manifest V3 Guide: https://developer.chrome.com/docs/extensions/mv3/intro/
- Corteza API: `src/routes/api.js:1297-1371` (createMemory function)
- Dashboard Auth Pattern: `src/views/dashboard.html:1259-1280`

---

**Ready to build! Estimated 4-5 hours for MVP, 2-3 hours for polish.**
