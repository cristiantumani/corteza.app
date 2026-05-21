# Updated Privacy Practices Form - v1.0.1

**Since we removed `storage` and `cookies` permissions, you may need to update the privacy practices form.**

---

## What to Update (if asked)

### 1. Permission Justifications

Since we now have **NO permissions** (empty array), you can simplify the justification:

**Previous response mentioned cookies and storage - now you can say:**

```
No additional permissions required beyond host_permissions.

The extension only needs network access to communicate with our backend API
at app.corteza.app for:
- User authentication (session-based)
- Creating and storing team memories

All data handling is done server-side. No local storage is used.
```

---

## Most Likely: No Changes Needed

The Chrome Web Store form typically doesn't require updates when you *remove* permissions - only when you *add* them.

Since you're removing permissions (making it more restrictive), they'll likely approve without asking you to update the privacy form.

---

## If They Ask About Host Permissions

**Q: Why do you need host_permissions to app.corteza.app?**

**Copy-paste this:**

```
Host permissions for https://app.corteza.app/* are required to:

1. Check user authentication status via /auth/me endpoint
2. Create team memories via /api/memory/create endpoint

The extension uses standard fetch() API with credentials: 'include' to
maintain user session state via HTTP-only cookies (managed by the browser,
not directly accessed by the extension).

Railway and localhost URLs are for development/staging environments only.
```

---

## Data Usage Certification

**No changes needed here** - your data collection practices remain the same:

✅ User-provided content (team memories)
✅ Authentication data (handled via session cookies)
✅ No tracking, no analytics, no third-party services

---

## Summary

**Most likely:** You don't need to update anything. Just resubmit with the new ZIP.

**If they ask:** Use the justifications above.

**The removal of permissions makes your extension MORE privacy-friendly, which is good!**

---

## Quick Resubmission Checklist

- [ ] Upload `corteza-extension-v1.0.1.zip`
- [ ] Add note to reviewers: "Removed unused storage and cookies permissions per review feedback (Ref: Purple Potassium)"
- [ ] Click Submit
- [ ] Wait 1-3 business days

Done! ✅
