# Corteza Team Memory - Browser Extension

A Chrome/Edge browser extension that allows you to log team decisions, context, and learnings from anywhere on the web.

## Features

- Log team memories without leaving your current tab
- Quick access via toolbar icon or keyboard shortcut (Ctrl+Shift+M / Cmd+Shift+M)
- Reuses your Corteza dashboard authentication (session cookies)
- Supports all memory types: Decision, Explanation, Context, Learning, Risk, Assumption
- Optional fields: category, tags, Jira epic, alternatives considered
- Visual auth status indicator (green checkmark when logged in)
- Auto-validates form input (10-5000 characters)

## Installation

### Chrome/Edge (Developer Mode)

1. **Download Extension Files**
   - Clone or download this repository
   - Navigate to the `browser-extension/` directory

2. **Load Unpacked Extension**
   - Open Chrome/Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
   - Enable "Developer mode" toggle (top right)
   - Click "Load unpacked"
   - Select the `browser-extension/` directory
   - Extension should now appear in your toolbar

3. **Pin Extension** (Optional)
   - Click the puzzle piece icon in Chrome toolbar
   - Find "Corteza Team Memory"
   - Click the pin icon to keep it visible

## Usage

### Prerequisites

You must be logged into Corteza first. The extension shares session cookies with the dashboard, so authentication is automatic once you're logged in.

**Two ways to log in:**

**Option A: Email Magic Link** (No Slack Required)
1. Go to https://app.corteza.app/auth/login
2. Enter your email address
3. Enter your workspace name (e.g., "my-team")
4. Click "Send Magic Link"
5. Check your email inbox
6. Click the login link in the email (expires in 5 minutes)
7. You'll be redirected to the dashboard

**Option B: Slack Login** (If your team uses Slack)
1. Type `/login` in your Slack workspace
2. Click the login link sent to you (only visible to you)
3. You'll be redirected to the dashboard

After logging in via either method, the browser extension will automatically detect your session.

### Logging a Memory

1. **Open Extension**
   - Click the extension icon in your toolbar, OR
   - Press `Ctrl+Shift+M` (Windows/Linux) or `Cmd+Shift+M` (Mac)

2. **Check Auth Status**
   - Top right of popup shows "✓ Logged in" (green) or "✗ Not logged in" (red)
   - If not logged in, click "Open Dashboard" to log in

3. **Fill Form**
   - **Memory*** (required): Enter the decision, context, or learning (10-5000 characters)
   - **Type*** (required): Select memory type
     - ✅ Decision - A choice that was made
     - 💡 Explanation - Why something works a certain way
     - 📌 Context - Background information
     - 🎓 Learning - Something the team learned
     - ⚠️ Risk - A potential risk or concern
     - 🤔 Assumption - An assumption being made
   - **Category** (optional): Product, UX, or Technical
   - **Tags** (optional): Comma-separated tags (e.g., "database, architecture, security")

4. **Advanced Options** (Optional)
   - Click "Advanced Options" to expand
   - **Jira Epic**: Link to a Jira epic (e.g., "PROJ-123")
   - **Alternatives Considered**: Other options that were considered

5. **Submit**
   - Click "Save Memory"
   - Success message will show: "✅ Memory #123 saved successfully!"
   - Form will clear automatically

## Development

### Project Structure

```
browser-extension/
├── manifest.json          # Chrome Extension config (Manifest V3)
├── popup.html            # Extension popup UI
├── popup.css             # Popup styling (black Corteza theme)
├── popup.js              # Form logic and validation
├── background.js         # Service worker (auth, API calls)
├── icons/                # Extension icons
│   ├── icon16.png       # 16x16 toolbar icon
│   ├── icon48.png       # 48x48 extension management icon
│   ├── icon128.png      # 128x128 Chrome Web Store icon
│   └── README-ICONS.md  # Icon creation guide
└── README.md            # This file
```

### Local Development Setup

1. **Start Corteza Backend**
   ```bash
   cd /path/to/decision-logger-bot
   npm install
   npm start
   # Backend runs on http://localhost:3000
   ```

2. **Load Extension in Chrome/Edge**
   - Follow installation instructions above
   - Extension will try production API first, then fall back to localhost:3000

3. **Make Changes**
   - Edit files in `browser-extension/`
   - **IMPORTANT:** After code changes, go to `chrome://extensions/` and click the **reload icon** (circular arrow) next to the extension
   - Hard refresh popup if needed (Ctrl+Shift+R while popup is open)
   - **Note:** Chrome does NOT auto-reload unpacked extensions - you MUST manually reload after every code change

4. **View Logs**
   - Right-click extension icon → "Inspect popup" (for popup.js logs)
   - Go to `chrome://extensions/` → "Service worker" link (for background.js logs)

### Common Development Issues

**Issue: Extension still shows old behavior after code changes**
- **Solution:** Reload the extension in `chrome://extensions/` (don't just refresh the popup)
- The extension files are loaded into memory and won't update until you click the reload button
- If reload doesn't work, try removing and re-adding the extension

**Issue: Extension shows "Not logged in" even after logging into dashboard**
- **Solution 1:** Wait up to 2 minutes (extension checks auth every 2 minutes)
- **Solution 2:** Close and reopen the popup (triggers fresh auth check)
- **Solution 3:** Reload the extension in `chrome://extensions/`

**Issue: Changes to manifest.json not taking effect**
- **Solution:** You MUST reload the extension after changing manifest.json
- Some manifest changes may require removing and re-adding the extension

### Testing Checklist

- [ ] Icons display correctly in toolbar and popup
- [ ] Extension loads without errors in console
- [ ] Auth status indicator shows correct state
- [ ] Login link opens dashboard in new tab
- [ ] Form validation works (min/max length, required fields)
- [ ] Character counter updates in real-time
- [ ] Submit button disables during save
- [ ] Success message shows with memory ID
- [ ] Error message shows on failure
- [ ] Form clears after successful submission
- [ ] Advanced options expand/collapse correctly
- [ ] Keyboard shortcut (Ctrl+Shift+M) opens popup
- [ ] Badge shows ✓ when logged in, ✗ when logged out

### API Integration

The extension uses the existing Corteza API endpoint:

**Endpoint:** `POST /api/memory/create`

**Request:**
```json
{
  "text": "Memory content...",
  "type": "decision",
  "category": "technical",
  "tags": "database, architecture",
  "epic_key": "PROJ-123",
  "alternatives": "Option A, Option B",
  "source": "browser-extension"
}
```

**Response (Success):**
```json
{
  "success": true,
  "memory": {
    "id": 123,
    "text": "Memory content...",
    "type": "decision",
    "workspace_id": "T123ABC",
    "timestamp": "2026-02-07T10:30:00.000Z"
  }
}
```

**Authentication:** Session cookies (shared with dashboard)

### Configuration

**API URLs** (in `background.js`):
- Primary: `https://app.corteza.app`
- Fallback: `https://decision-logger-bot-production.up.railway.app` (Railway)
- Local: `http://localhost:3000`

The extension automatically tries app.corteza.app first, then Railway as fallback, then local if both fail.

## Building for Production

### Chrome Web Store Submission

1. **Update Version**
   - Edit `manifest.json`: `"version": "1.0.0"` → `"version": "1.0.1"` (increment)

2. **Zip Extension**
   ```bash
   cd browser-extension
   zip -r corteza-extension-v1.0.0.zip . -x "*.git*" -x "*node_modules*"
   ```

3. **Test in Clean Profile**
   - Create new Chrome profile
   - Install extension from zip
   - Test all functionality

4. **Submit to Chrome Web Store**
   - Go to https://chrome.google.com/webstore/devconsole
   - Create new item
   - Upload zip file
   - Fill out store listing (description, screenshots, privacy policy)
   - Submit for review

### Edge Add-ons Submission

Same process as Chrome, but submit to https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview

## Troubleshooting

### "Not logged in" Status

**Problem:** Extension shows "✗ Not logged in" even though you're logged into dashboard

**Solutions:**
1. Clear browser cookies and log in again
2. Check that dashboard URL matches extension's host_permissions in manifest.json
3. Open dashboard in same browser profile as extension
4. Check browser console for CORS errors

### Extension Not Loading

**Problem:** Extension shows error when loading unpacked

**Solutions:**
1. Verify all required files exist (manifest.json, popup.html, popup.css, popup.js, background.js)
2. Verify icon files exist (icon16.png, icon48.png, icon128.png)
3. Check manifest.json for syntax errors (use JSON validator)
4. Check Chrome DevTools console for specific error messages

### Form Submission Fails

**Problem:** Clicking "Save Memory" shows error message

**Solutions:**
1. Check network tab in popup inspector (right-click extension → Inspect popup)
2. Verify API endpoint is accessible (try in Postman)
3. Check backend logs for errors
4. Verify session cookie is being sent (check Network tab → Headers → Cookie)

### Icons Not Displaying

**Problem:** Extension icon is blank or shows default puzzle piece

**Solutions:**
1. Verify icon files exist in `icons/` directory (icon16.png, icon48.png, icon128.png)
2. Reload extension in `chrome://extensions/`
3. Clear Chrome icon cache: `rm -rf ~/Library/Caches/Google/Chrome/Default/Extension*`
4. Hard refresh browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

## Known Limitations

1. **Firefox & Safari Support:** Currently Chrome/Edge only (Manifest V3). Firefox and Safari require different manifest formats.

2. **Session Expiration:** If your dashboard session expires, you must log in again. The extension checks auth every 5 minutes.

3. **Local Development:** Extension tries production API first, so local development requires production to be down or manual code change.

## Security Notes

- Extension only requests minimal permissions: `storage`, `cookies`
- Host permissions limited to Railway app and localhost
- No tracking or analytics
- Session cookies are httpOnly and secure
- API calls use HTTPS in production

## Support

For issues or feature requests, please contact the Corteza development team or file an issue in the repository.

## Version History

- **v1.0.0** (2026-02-07) - Initial release
  - Basic memory logging functionality
  - Chrome/Edge support (Manifest V3)
  - Session cookie authentication
  - All 6 memory types supported
  - Optional advanced fields (Jira, alternatives)

## License

Part of the Corteza Team Memory project.
