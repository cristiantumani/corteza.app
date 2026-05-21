# Chrome Web Store Publishing Guide

**Goal:** Publish Corteza Team Memory browser extension to Chrome Web Store

---

## Prerequisites Checklist

### 1. Chrome Web Store Developer Account
- [ ] Go to https://chrome.google.com/webstore/devconsole
- [ ] Sign in with Google account
- [ ] Pay one-time $5 registration fee
- [ ] Verify email address

### 2. Required Assets

#### Already Have ✅
- [x] Icons (16x16, 48x48, 128x128) in `icons/` folder
- [x] Privacy Policy: https://github.com/cristiantumani/corteza.app/blob/main/PRIVACY_POLICY.md
- [x] Terms of Service: https://github.com/cristiantumani/corteza.app/blob/main/TERMS_OF_SERVICE.md

#### Need to Create 📸
- [ ] **Screenshots** (minimum 1, recommended 3-5)
  - Size: 1280x800 or 640x400 PNG
  - Show: Chat view, logging a memory, success state
- [ ] **Promotional tile - Small** (optional but recommended)
  - Size: 440x280 PNG
  - Used in search results
- [ ] **Promotional tile - Large** (optional but highly recommended)
  - Size: 920x680 PNG
  - Used in featured placements
- [ ] **Marquee promo** (optional)
  - Size: 1400x560 PNG
  - Used in spotlight features

---

## Step 1: Prepare Extension Package

### Update manifest.json

Check these fields are correct:

```json
{
  "name": "Corteza Team Memory",
  "version": "1.0.0",
  "description": "Log and search your team's decisions using AI. Never lose important context again.",
  "homepage_url": "https://corteza.app"
}
```

### Create ZIP Package

```bash
cd browser-extension
zip -r corteza-extension-v1.0.0.zip . -x "*.git*" -x "*node_modules*" -x "*.DS_Store" -x "PUBLISHING_GUIDE.md" -x "store-assets/*"
```

**What gets included:**
- manifest.json
- popup.html, popup.css, popup.js
- background.js
- icons/ folder
- README.md

**What gets excluded:**
- .git files
- node_modules (if any)
- Publishing guide
- Store assets (submitted separately)

---

## Step 2: Create Screenshots

### Recommended Screenshots (3-5 total)

**Screenshot 1: Extension Popup - Empty State**
- Open extension popup (before logging in)
- Shows auth status and login button
- Size: 1280x800 PNG

**Screenshot 2: Logging a Memory**
- Extension popup with form filled out
- Shows all fields (memory text, type, category, tags)
- Size: 1280x800 PNG

**Screenshot 3: Success State**
- Shows "✅ Memory #123 saved successfully!" message
- Demonstrates successful submission
- Size: 1280x800 PNG

**Screenshot 4: Dashboard Integration** (optional)
- Show extension working alongside dashboard
- Demonstrates seamless workflow
- Size: 1280x800 PNG

**Screenshot 5: Browser Integration** (optional)
- Show extension icon in Chrome toolbar
- Demonstrates accessibility
- Size: 1280x800 PNG

### How to Create Screenshots

1. **Load extension in Chrome**
   - Go to `chrome://extensions/`
   - Load unpacked extension

2. **Take screenshots**
   - Use Chrome DevTools Device Toolbar for consistent sizing
   - Set viewport to 1280x800
   - Use macOS Screenshot (Cmd+Shift+4) or Windows Snipping Tool

3. **Save as PNG**
   - Save to `browser-extension/store-assets/screenshots/`
   - Name: `screenshot-1.png`, `screenshot-2.png`, etc.

---

## Step 3: Write Store Listing

### Extension Name
```
Corteza Team Memory
```

### Short Description (132 characters max)
```
Log and search your team's decisions using AI. Never lose important context again.
```

### Detailed Description (16,000 characters max)

```
**Never lose important team decisions again**

Corteza Team Memory is your team's AI-powered knowledge base. Log decisions, context, and learnings from anywhere—then find them instantly using natural language search.

🎯 **The Problem We Solve**

Product teams make dozens of critical decisions every week:
• "Why did we choose this framework?"
• "What did we decide about the checkout flow?"
• "Who approved this design direction?"

But those decisions get buried in Slack threads, scattered across docs, or lost entirely. Your team wastes hours re-explaining decisions that were already made.

💡 **How Corteza Works**

**1. Log Anywhere**
Click the extension icon from any webpage to quickly log a decision, explanation, or context. No need to switch tools or lose your flow.

**2. AI-Powered Organization**
Our AI automatically processes and organizes your team's memory. No folders, no tags to remember.

**3. Search Naturally**
Ask questions in plain English from the dashboard:
• "Show me AEM decisions from last quarter"
• "What did we decide about authentication?"
• "Why did we choose that API framework?"

Get instant answers with full context—no hunting through channels.

✨ **Key Features**

• **Quick Access**: Keyboard shortcut (Ctrl+Shift+M / Cmd+Shift+M)
• **Session Sharing**: Automatically uses your dashboard login
• **All Memory Types**: Decisions, Explanations, Context, Learnings, Risks, Assumptions
• **Optional Fields**: Categories, tags, Jira epic links, alternatives considered
• **Visual Feedback**: Auth status indicator shows login state
• **Form Validation**: Auto-validates input (10-5000 characters)
• **Mobile Responsive**: Works on any screen size

🔐 **Privacy & Security**

• Minimal permissions (storage, cookies only)
• Session cookies are httpOnly and secure
• No tracking or analytics
• HTTPS encryption in production
• Open source: https://github.com/cristiantumani/corteza.app

🚀 **Getting Started**

1. Install the extension
2. Log in at https://app.corteza.app using:
   - Email magic link (no Slack required), OR
   - Slack login (if your team uses Slack)
3. Click the extension icon to start logging decisions
4. Search your team memory from the dashboard

📍 **Works With**

• Slack integration (optional)
• Web dashboard
• Email authentication
• Browser extension
• All integrated in one seamless experience

🏢 **Built for Modern Teams**

Whether you're a startup moving fast or an enterprise managing multiple products, Corteza helps you:
• Onboard new team members 10x faster
• Stop re-explaining old decisions
• Capture tribal knowledge before it's lost
• Search by meaning, not keywords

💬 **Support**

Need help? Contact us at cristiantumani@gmail.com or visit https://corteza.app

📄 **Legal**

• Privacy Policy: https://github.com/cristiantumani/corteza.app/blob/main/PRIVACY_POLICY.md
• Terms of Service: https://github.com/cristiantumani/corteza.app/blob/main/TERMS_OF_SERVICE.md

---

Built by product teams, for product teams. Start building your team's memory today.
```

### Category
- **Primary**: Productivity
- **Secondary**: Communication (optional)

### Language
- English (United States)

---

## Step 4: Submit to Chrome Web Store

### 1. Go to Chrome Web Store Developer Dashboard
https://chrome.google.com/webstore/devconsole

### 2. Click "New Item"

### 3. Upload ZIP File
- Upload `corteza-extension-v1.0.0.zip`
- Wait for upload to complete

### 4. Fill Out Store Listing

**Store listing tab:**
- Language: English (United States)
- Extension name: Corteza Team Memory
- Short description: [Copy from above]
- Detailed description: [Copy from above]
- Category: Productivity
- Screenshots: Upload 1-5 PNG files
- Small tile (optional): Upload 440x280 PNG
- Large tile (optional): Upload 920x680 PNG
- Marquee (optional): Upload 1400x560 PNG

**Privacy practices tab:**
- Data usage: "This extension does not collect or transmit user data"
- Permissions justification:
  - `storage`: "Store user preferences and view settings locally"
  - `cookies`: "Access session cookies to authenticate with corteza.app"
- Privacy policy URL: https://github.com/cristiantumani/corteza.app/blob/main/PRIVACY_POLICY.md

**Distribution tab:**
- Visibility: Public
- Regions: All regions (or select specific countries)
- Pricing: Free

**Additional information:**
- Website: https://corteza.app
- Support email: cristiantumani@gmail.com
- Support URL: https://corteza.app (or create a support page)

### 5. Submit for Review

Click **"Submit for Review"**

---

## Step 5: Review Process

### Timeline
- **Initial review**: 1-3 business days (usually faster)
- **If rejected**: Fix issues and resubmit (1-2 days)
- **Total time**: Usually published within 3-5 days

### Common Rejection Reasons (and how to avoid them)

❌ **"Insufficient description"**
- ✅ Use detailed description above (explains problem, solution, features)

❌ **"Missing privacy policy"**
- ✅ Already have: https://github.com/cristiantumani/corteza.app/blob/main/PRIVACY_POLICY.md

❌ **"Permissions not justified"**
- ✅ Explain each permission clearly in privacy practices tab

❌ **"Misleading screenshots"**
- ✅ Use actual screenshots of extension, not mockups

❌ **"External code"**
- ✅ Our extension doesn't load external scripts - all bundled

❌ **"Login required to use"**
- ✅ This is allowed - clearly state in description that login is required

### What Reviewers Check
- Extension works as described
- Permissions are necessary and justified
- No malicious code
- Privacy policy is clear
- Screenshots match functionality
- Description is accurate

---

## Step 6: After Approval

### Once Published

You'll get an email: **"Your item has been published"**

Your extension will be live at:
```
https://chrome.google.com/webstore/detail/[auto-generated-id]
```

### Post-Launch Actions

1. **Update website**
   - Add Chrome Web Store badge to https://corteza.app
   - Link to extension in docs

2. **Update README**
   - Add installation link to `browser-extension/README.md`
   - Update installation instructions

3. **Announce launch**
   - LinkedIn post (already drafted!)
   - Twitter/X
   - Product Hunt (optional)
   - Email existing users

4. **Monitor reviews**
   - Respond to user reviews within 48 hours
   - Address bugs quickly
   - Collect feature requests

---

## Edge Add-ons (Bonus - Same Extension!)

Your extension is Manifest V3, so it works on Edge without changes.

### Publish to Edge Add-ons

1. **Create Partner Center Account**
   - Go to https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview
   - Sign in with Microsoft account
   - **Free** (no registration fee)

2. **Submit Same ZIP Package**
   - Upload same `corteza-extension-v1.0.0.zip`
   - Fill similar store listing
   - Usually faster review (1-2 days)

3. **Benefits**
   - Reach Edge users (10-15% market share)
   - No extra development work
   - Free to publish

---

## Version Updates (Future)

When you update the extension:

1. **Update version in manifest.json**
   ```json
   "version": "1.0.1"
   ```

2. **Create new ZIP**
   ```bash
   zip -r corteza-extension-v1.0.1.zip . -x "*.git*" -x "*node_modules*" -x "*.DS_Store"
   ```

3. **Upload to Developer Dashboard**
   - Go to your extension in dashboard
   - Click "Package"
   - Upload new ZIP
   - Submit for review (usually auto-approved within hours)

---

## Troubleshooting

### "Extension size too large"
- Max size: 100 MB (you're well under this)
- If needed, compress images

### "Manifest errors"
- Validate manifest.json at: https://developer.chrome.com/docs/extensions/mv3/manifest/

### "Screenshots rejected"
- Ensure 1280x800 or 640x400 PNG
- Must show actual extension UI
- No text overlays or marketing graphics

### "Privacy policy issues"
- Host on GitHub (already done ✅)
- Must be publicly accessible
- Must explain data handling

---

## Cost Summary

| Item | Cost |
|------|------|
| Chrome Web Store registration | $5 (one-time) |
| Edge Add-ons registration | Free |
| Extension hosting | Free (Chrome hosts) |
| Updates | Free |
| **Total** | **$5** |

---

## Timeline Estimate

| Task | Time |
|------|------|
| Create screenshots | 1 hour |
| Create promotional tiles (optional) | 2 hours |
| Fill out store listing | 30 minutes |
| Submit for review | 5 minutes |
| **Review wait time** | **1-3 days** |
| Fix issues (if any) | 1 hour |
| **Total active work** | **~4 hours** |

---

## Next Steps

1. [ ] Register Chrome Web Store developer account ($5)
2. [ ] Create screenshots (3-5 images)
3. [ ] Create promotional tiles (optional but recommended)
4. [ ] Create ZIP package
5. [ ] Fill out store listing
6. [ ] Submit for review
7. [ ] Wait for approval (1-3 days)
8. [ ] Announce launch!

---

## Resources

- **Chrome Web Store Developer Dashboard**: https://chrome.google.com/webstore/devconsole
- **Publishing Guide**: https://developer.chrome.com/docs/webstore/publish/
- **Best Practices**: https://developer.chrome.com/docs/webstore/best_practices/
- **Review Guidelines**: https://developer.chrome.com/docs/webstore/program-policies/

---

**Questions?** Contact cristiantumani@gmail.com

Good luck with the launch! 🚀
