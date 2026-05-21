# Chrome Web Store - Privacy Practices Tab (Complete Guide)

**IMPORTANT:** Copy and paste these exact answers into the Privacy Practices tab.

---

## 1. Single Purpose Description (Required)

**Question:** What is the single purpose of this extension?

**Answer (Copy this):**
```
This extension allows users to quickly log team decisions, context, and learnings to Corteza Team Memory from any webpage. Users can capture important information without leaving their current workflow, then search and retrieve that information using AI-powered semantic search through the Corteza dashboard.
```

---

## 2. Permission Justifications (Required)

### Host Permissions

**Permission:** `https://app.corteza.app/*`
**Justification (Copy this):**
```
This extension needs to communicate with app.corteza.app to authenticate users and save their team memories. The host permission allows the extension to:
1. Check if the user is logged in (GET /auth/me)
2. Submit new team memories (POST /api/memory/create)
All communication uses HTTPS and session cookies for authentication.
```

**Permission:** `https://decision-logger-bot-production.up.railway.app/*`
**Justification (Copy this):**
```
Fallback host for API communication when the primary domain (app.corteza.app) is unavailable. Uses the same authentication and API endpoints as the primary host. This ensures service continuity during maintenance or deployments.
```

**Permission:** `http://localhost:3000/*`
**Justification (Copy this):**
```
Development and testing environment only. Allows developers to test the extension against a local development server. Not used in production. Users can safely ignore this permission.
```

### Storage Permission

**Permission:** `storage`
**Justification (Copy this):**
```
Used to store user preferences locally in the browser, such as:
- View preference (Chat View vs Classic View)
- UI state (collapsed/expanded sections)
No personal data or team memories are stored locally - all data is saved to the user's Corteza workspace on the server.
```

### Cookies Permission

**Permission:** `cookies`
**Justification (Copy this):**
```
Required to access session cookies that authenticate the user with app.corteza.app. When users log in to the Corteza dashboard, a session cookie is created. This extension reads that cookie to verify the user is authenticated before allowing them to submit team memories. The extension does NOT create, modify, or delete cookies - it only reads existing session cookies created by the Corteza dashboard.
```

---

## 3. Remote Code (Important!)

**Question:** Does this item use remote code?

**Answer:** ❌ **NO** (Select "No" / Leave unchecked)

**Explanation:** Our extension does NOT use remotely hosted code. All JavaScript is bundled in the extension package. We only make API calls to save data.

---

## 4. Data Usage Certification

**Question:** How does this extension handle user data?

### Select These Options:

✅ **This extension does NOT collect user data**

**Explanation (if needed):**
```
This extension does not collect, store, or transmit personal user data. It only:
1. Reads session cookies to verify authentication (cookies created by corteza.app)
2. Submits user-entered team memories to the user's Corteza workspace
3. Stores non-sensitive UI preferences locally (view settings)

All team memories are stored in the user's Corteza workspace, not by the extension. The extension acts as a client to submit data the user explicitly enters.
```

---

## 5. Privacy Policy (Required)

**Question:** Privacy Policy URL

**Answer (Copy this):**
```
https://github.com/cristiantumani/corteza.app/blob/main/PRIVACY_POLICY.md
```

---

## 6. Contact Information

### Support Email (Required)

**Answer (Copy this):**
```
cristiantumani@gmail.com
```

**IMPORTANT:** You need to verify this email address!

#### How to Verify Email:
1. Go to your Developer Dashboard
2. Click on "Account" or "Settings"
3. Find email verification section
4. Enter: cristiantumani@gmail.com
5. Click "Send verification email"
6. Check your inbox
7. Click the verification link
8. Return to extension submission

---

## 7. Developer Program Policies Certification

**Question:** Do you certify that your data usage complies with Chrome Web Store Developer Program Policies?

**Answer:** ✅ **YES** (Check this box)

---

## 8. Additional Fields (If Asked)

### What data does this extension collect?

**Answer:**
```
None. The extension does not collect user data. It only submits data that users explicitly enter into the extension form.
```

### What data does this extension use or transfer?

**Answer:**
```
User-entered team memories (decisions, context, learnings) are transmitted via HTTPS to the user's Corteza workspace at app.corteza.app. This data is entered voluntarily by the user and stored in their workspace, not by the extension.
```

### Is the data being sold to third parties?

**Answer:** ❌ **NO**

### Is the data being used for purposes unrelated to the item's core functionality?

**Answer:** ❌ **NO**

### Is the data being used to determine creditworthiness or for lending purposes?

**Answer:** ❌ **NO**

---

## Complete Checklist

Before clicking "Submit for Review":

- [ ] Single purpose description filled
- [ ] Host permissions justified (3 hosts)
- [ ] Storage permission justified
- [ ] Cookies permission justified
- [ ] Remote code = NO (unchecked)
- [ ] Data usage = "Does not collect user data"
- [ ] Privacy Policy URL added
- [ ] Support email added (cristiantumani@gmail.com)
- [ ] Email verified ✅ (Check your inbox!)
- [ ] Developer Program Policies certified (checkbox checked)

---

## Common Mistakes to Avoid

❌ **Don't say:** "We use cookies to authenticate users"
✅ **Do say:** "We read existing session cookies created by corteza.app"

❌ **Don't say:** "We collect team decisions"
✅ **Do say:** "Users voluntarily enter team memories that are sent to their workspace"

❌ **Don't say:** "Remote code is used for API calls"
✅ **Do say:** "No remote code - we only make API calls to save data"

---

## Need Help?

If Chrome Web Store asks for more clarification:

1. **Keep it simple:** We're a client that submits user-entered data to their workspace
2. **Emphasize user control:** Users explicitly enter and submit data
3. **No tracking:** We don't track, analyze, or collect user behavior
4. **Session cookies:** We only read cookies created by the dashboard (corteza.app)

---

**Ready to submit!** Fill in these fields and you should be good to go. 🚀
