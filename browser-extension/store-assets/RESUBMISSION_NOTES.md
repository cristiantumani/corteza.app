# Chrome Web Store Resubmission - v1.0.1

## Rejection Details

**Date:** February 11, 2026
**Reference ID:** Purple Potassium
**Reason:** Requesting unused permissions (`storage` and `cookies`)

**Original rejection message:**
> Solicitar pero no usar los permisos que se indican a continuación: storage, cookies

---

## Changes Made in v1.0.1

### 1. Removed Unused Permissions

**Before (v1.0.0):**
```json
"permissions": [
  "storage",
  "cookies"
]
```

**After (v1.0.1):**
```json
"permissions": []
```

### 2. Why This Works

Our extension only needs:
- **`host_permissions`** - To make fetch requests to app.corteza.app with credentials
- **No explicit permissions needed** - Manifest V3 allows `credentials: 'include'` with just `host_permissions`

We don't use:
- ❌ `chrome.storage` API - No local storage needed
- ❌ `chrome.cookies` API - No direct cookie manipulation needed
- ✅ We only use fetch with `credentials: 'include'` which works with `host_permissions`

### 3. Version Bump

- Version changed from **1.0.0** → **1.0.1**

---

## What Still Works

✅ **Authentication via cookies** - fetch with `credentials: 'include'` works with `host_permissions`
✅ **API calls** - All requests to app.corteza.app still work
✅ **Badge updates** - Extension badge still shows login status
✅ **Background service worker** - Still checks auth every 2 minutes

**No functionality was lost by removing these permissions.**

---

## Resubmission Steps

### 1. Upload New Package

1. Go to Chrome Web Store Developer Dashboard
2. Find your rejected submission
3. Click "Edit" or "Resubmit"
4. Upload new package: **`corteza-extension-v1.0.1.zip`**

### 2. What Changed - Explain to Reviewers

**In the "Additional details" or "Notes to reviewers" field, write:**

```
CHANGES IN v1.0.1:

Removed unused permissions "storage" and "cookies" as requested by review team
(Reference ID: Purple Potassium).

The extension now only uses host_permissions for API communication, which is
sufficient for our needs. No functionality was affected.

Authentication flow uses standard fetch() with credentials: 'include', which
works correctly with host_permissions only in Manifest V3.
```

### 3. Update Privacy Practices (if needed)

Since we removed permissions, you may need to update the privacy practices form:

**Single Purpose:**
(No changes needed - same as before)

**Permission Justifications:**
You can now say: "No additional permissions required. Extension uses only host_permissions for API communication."

### 4. Submit

Click "Submit for review"

---

## Testing Before Submission

To verify everything still works:

1. Load unpacked extension from folder
2. Open popup (Ctrl+Shift+M)
3. Verify it says "Not logged in"
4. Click "Login to Corteza"
5. Log in on dashboard
6. Return to extension popup
7. Verify it says "Logged in"
8. Create a test memory
9. Verify it saves successfully

**All functionality should work identically to v1.0.0**

---

## Expected Timeline

- **Resubmission:** Today
- **Review:** 1-3 business days (usually faster for resubmissions)
- **Approval:** Should be quick since we addressed the only issue

---

## Technical Explanation (for reference)

### Why We Don't Need `cookies` Permission

In Manifest V3, there are two ways to work with cookies:

1. **Using `chrome.cookies` API** - Requires `"cookies"` permission
   - Read/write cookies programmatically
   - We don't do this

2. **Using fetch with credentials** - Only requires `host_permissions`
   - Browser automatically sends/receives cookies
   - This is what we do

Our code:
```javascript
fetch(`${API_BASE_URL}/auth/me`, {
  credentials: 'include'  // ← This sends cookies automatically
})
```

With `host_permissions: ["https://app.corteza.app/*"]`, this works perfectly without the `cookies` permission.

### Why We Don't Need `storage` Permission

We never use:
- `chrome.storage.local.set()`
- `chrome.storage.local.get()`
- `chrome.storage.sync.set()`
- `chrome.storage.sync.get()`

All our data comes from API calls, nothing is stored locally in the extension.

---

## Files Changed

1. **`manifest.json`**
   - Removed `"storage"` and `"cookies"` from permissions
   - Bumped version to 1.0.1

2. **`corteza-extension-v1.0.1.zip`**
   - New package ready for resubmission

**No other files were modified.**

---

## If You Get Additional Questions

**Q: "Why do you need host_permissions?"**
**A:** "To communicate with our backend API at app.corteza.app for authentication and data storage. The extension sends user-created memories to our server."

**Q: "Can you reduce host_permissions scope?"**
**A:** "We need full access to app.corteza.app/* for multiple API endpoints (/auth/me, /api/memory/create). We also support Railway and localhost for development/staging."

**Q: "Do you collect user data?"**
**A:** "Yes, only the data users explicitly enter into the extension (team memories). This is explained in our privacy practices form. Authentication is handled via session cookies."

---

## Summary

✅ Fixed the only issue Google raised
✅ No functionality lost
✅ Cleaner manifest (following best practices)
✅ Ready to resubmit immediately

**The rejection was actually helpful - it made our extension cleaner and more compliant with Chrome Web Store policies.**

---

Good luck with the resubmission! 🚀
