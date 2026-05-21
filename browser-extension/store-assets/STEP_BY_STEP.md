# Step-by-Step: Filling Out Privacy Practices Tab

Follow these steps exactly to complete the Privacy Practices section.

---

## STEP 1: Go to Privacy Practices Tab

In your Chrome Web Store dashboard:
1. Click on your extension draft
2. Click **"Privacy practices"** tab (left sidebar)

---

## STEP 2: Fill Single Purpose

**Find:** "What is the single purpose of this extension?"

**Paste this:**
```
This extension allows users to quickly log team decisions, context, and learnings to Corteza Team Memory from any webpage. Users can capture important information without leaving their current workflow, then search and retrieve that information using AI-powered semantic search through the Corteza dashboard.
```

✅ **Save**

---

## STEP 3: Justify Permissions

**Find:** "Justify the use of each permission"

You'll see a list of permissions. Fill each one:

### Permission: `cookies`
**Paste this:**
```
Required to access session cookies that authenticate the user with app.corteza.app. When users log in to the Corteza dashboard, a session cookie is created. This extension reads that cookie to verify the user is authenticated before allowing them to submit team memories. The extension does NOT create, modify, or delete cookies - it only reads existing session cookies created by the Corteza dashboard.
```

### Permission: `storage`
**Paste this:**
```
Used to store user preferences locally in the browser, such as view preference (Chat View vs Classic View) and UI state (collapsed/expanded sections). No personal data or team memories are stored locally - all data is saved to the user's Corteza workspace on the server.
```

### Permission: Host `https://app.corteza.app/*`
**Paste this:**
```
This extension needs to communicate with app.corteza.app to authenticate users and save their team memories. The host permission allows the extension to: 1) Check if the user is logged in (GET /auth/me) 2) Submit new team memories (POST /api/memory/create). All communication uses HTTPS and session cookies for authentication.
```

### Permission: Host `https://decision-logger-bot-production.up.railway.app/*`
**Paste this:**
```
Fallback host for API communication when the primary domain (app.corteza.app) is unavailable. Uses the same authentication and API endpoints as the primary host. This ensures service continuity during maintenance or deployments.
```

### Permission: Host `http://localhost:3000/*`
**Paste this:**
```
Development and testing environment only. Allows developers to test the extension against a local development server. Not used in production. Users can safely ignore this permission.
```

✅ **Save all justifications**

---

## STEP 4: Remote Code

**Find:** "Does this extension use remote code?"

**Select:** ❌ **NO** (or leave unchecked)

**Explanation:** We don't load external JavaScript. All code is in the extension package.

✅ **Save**

---

## STEP 5: Data Usage

**Find:** "How does this extension handle user data?"

**Select:** ✅ **"This extension does NOT collect user data"**

If it asks for details:
**Paste this:**
```
This extension does not collect, store, or transmit personal user data. It only: 1) Reads session cookies to verify authentication (cookies created by corteza.app) 2) Submits user-entered team memories to the user's Corteza workspace 3) Stores non-sensitive UI preferences locally (view settings). All team memories are stored in the user's Corteza workspace, not by the extension.
```

✅ **Save**

---

## STEP 6: Privacy Policy

**Find:** "Privacy policy URL"

**Paste this:**
```
https://github.com/cristiantumani/corteza.app/blob/main/PRIVACY_POLICY.md
```

✅ **Save**

---

## STEP 7: Certify Compliance

**Find:** Checkbox that says something like:
- "I certify that my extension complies with Developer Program Policies"
- "Certify data usage"

**Action:** ✅ **Check the box**

✅ **Save**

---

## STEP 8: Contact Email & Verification ⚠️ IMPORTANT

### Add Email

**Find:** "Support email" or "Contact email"

**Paste this:**
```
cristiantumani@gmail.com
```

✅ **Save**

### Verify Email (CRITICAL!)

**This is why you can't publish - your email isn't verified!**

1. **Go to Account tab** (or Developer Dashboard settings)
2. **Find "Email verification" section**
3. **Enter:** cristiantumani@gmail.com
4. **Click:** "Send verification email"
5. **Check your email inbox**
6. **Click the verification link** in the email
7. **Return to extension dashboard**
8. **Refresh the page**
9. You should see ✅ "Email verified"

**Without this, you CANNOT publish!**

---

## STEP 9: Final Review

Go back to the **Privacy practices** tab and check:

- [ ] Single purpose filled ✅
- [ ] All permissions justified (5 total) ✅
- [ ] Remote code = NO ✅
- [ ] Data usage = "Does not collect" ✅
- [ ] Privacy policy URL added ✅
- [ ] Policies certified (checkbox) ✅
- [ ] Contact email added ✅
- [ ] **Email verified** ✅ ← MOST IMPORTANT!

---

## STEP 10: Try to Submit Again

1. Click **"Submit for review"** button
2. If you still see errors, read them carefully
3. Most likely: **Email not verified** - go back to Step 8

---

## Troubleshooting

### Still can't submit?

**Error:** "Debes verificar tu dirección de correo electrónico"
**Solution:** Go to Account → Email verification → Click link in email

**Error:** "Falta justificación para..."
**Solution:** Make sure you filled ALL permissions (scroll down, some might be hidden)

**Error:** "Descripción de finalidad única"
**Solution:** Make sure single purpose description is at least 10 words

---

## Need the text files?

All copy-paste text is in:
- `QUICK_ANSWERS.txt` - Quick reference
- `PRIVACY_PRACTICES_FORM.md` - Detailed guide

---

**Good luck!** Once email is verified, you should be able to submit! 🚀
