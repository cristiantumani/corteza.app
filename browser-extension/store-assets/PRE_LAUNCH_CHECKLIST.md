# Chrome Web Store Pre-Launch Checklist

Use this checklist to track your progress toward publishing the extension.

---

## Phase 1: Account Setup

- [ ] Register Chrome Web Store developer account
  - URL: https://chrome.google.com/webstore/devconsole
  - Cost: $5 one-time fee
  - Expected time: 15 minutes

---

## Phase 2: Create Assets

### Screenshots (Required - minimum 1, recommended 3-5)

- [ ] Screenshot 1: Extension popup empty state
  - Size: 1280x800 PNG
  - Shows: Auth status, login button

- [ ] Screenshot 2: Logging a memory
  - Size: 1280x800 PNG
  - Shows: Form filled out with all fields

- [ ] Screenshot 3: Success state
  - Size: 1280x800 PNG
  - Shows: "Memory saved successfully" message

- [ ] Screenshot 4: Dashboard integration (optional)
  - Size: 1280x800 PNG
  - Shows: Extension working with dashboard

- [ ] Screenshot 5: Browser toolbar (optional)
  - Size: 1280x800 PNG
  - Shows: Extension icon in Chrome toolbar

### Promotional Tiles (Optional but Recommended)

- [ ] Small promotional tile
  - Size: 440x280 PNG
  - Design: Corteza logo + "Your Team's AI Memory"

- [ ] Large promotional tile
  - Size: 920x680 PNG
  - Design: Logo + tagline + feature highlights

- [ ] Marquee promo (optional)
  - Size: 1400x560 PNG
  - Design: Hero image for featured placements

---

## Phase 3: Package Extension

- [ ] Verify manifest.json fields:
  ```json
  {
    "name": "Corteza Team Memory",
    "version": "1.0.0",
    "description": "Log and search your team's decisions using AI. Never lose important context again.",
    "homepage_url": "https://corteza.app"
  }
  ```

- [ ] Create ZIP package:
  ```bash
  cd browser-extension
  zip -r corteza-extension-v1.0.0.zip . \
    -x "*.git*" \
    -x "*node_modules*" \
    -x "*.DS_Store" \
    -x "PUBLISHING_GUIDE.md" \
    -x "store-assets/*"
  ```

- [ ] Test ZIP in clean Chrome profile
  - Install from ZIP
  - Test all features work
  - Verify no console errors

---

## Phase 4: Prepare Store Listing

- [ ] Copy detailed description from PUBLISHING_GUIDE.md

- [ ] Copy short description from STORE_LISTING_COPY.txt

- [ ] Prepare permission justifications:
  - storage: "Store user preferences and view settings locally"
  - cookies: "Access session cookies to authenticate with corteza.app"

- [ ] Verify Privacy Policy is accessible:
  - https://github.com/cristiantumani/corteza.app/blob/main/PRIVACY_POLICY.md

- [ ] Verify Terms of Service is accessible:
  - https://github.com/cristiantumani/corteza.app/blob/main/TERMS_OF_SERVICE.md

---

## Phase 5: Submit to Chrome Web Store

- [ ] Go to Developer Dashboard
  - https://chrome.google.com/webstore/devconsole

- [ ] Click "New Item"

- [ ] Upload ZIP file (corteza-extension-v1.0.0.zip)

- [ ] Fill Store Listing tab:
  - [ ] Extension name
  - [ ] Short description
  - [ ] Detailed description
  - [ ] Category: Productivity
  - [ ] Language: English (United States)
  - [ ] Screenshots (upload all created)
  - [ ] Promotional tiles (if created)

- [ ] Fill Privacy Practices tab:
  - [ ] Data usage: "Does not collect/transmit user data"
  - [ ] Permission justifications (storage, cookies)
  - [ ] Privacy policy URL

- [ ] Fill Distribution tab:
  - [ ] Visibility: Public
  - [ ] Regions: All regions
  - [ ] Pricing: Free

- [ ] Fill Additional Information:
  - [ ] Website: https://corteza.app
  - [ ] Support email: cristiantumani@gmail.com

- [ ] Click "Submit for Review"

---

## Phase 6: Wait for Review

- [ ] Review submitted
  - Expected wait: 1-3 business days
  - Check email for updates

- [ ] If rejected:
  - [ ] Read rejection reason
  - [ ] Fix issues
  - [ ] Resubmit (1-2 day review)

- [ ] If approved:
  - [ ] Note your extension URL
  - [ ] Proceed to Phase 7

---

## Phase 7: Post-Launch

- [ ] Update website (https://corteza.app)
  - [ ] Add Chrome Web Store badge
  - [ ] Link to extension page

- [ ] Update browser-extension/README.md
  - [ ] Add Chrome Web Store installation link
  - [ ] Update installation instructions

- [ ] Announce launch:
  - [ ] LinkedIn post (already drafted!)
  - [ ] Twitter/X
  - [ ] Email existing users
  - [ ] Product Hunt (optional)

- [ ] Set up monitoring:
  - [ ] Check reviews daily
  - [ ] Respond to user feedback
  - [ ] Track installation stats

---

## Bonus: Edge Add-ons (Optional)

- [ ] Create Microsoft Partner Center account (free)
  - https://partner.microsoft.com/dashboard/microsoftedge/overview

- [ ] Submit same ZIP package

- [ ] Fill similar store listing

- [ ] Wait for review (1-2 days)

---

## Estimated Timeline

| Phase | Time Required |
|-------|---------------|
| Account setup | 15 minutes |
| Create screenshots | 1 hour |
| Create promo tiles (optional) | 2 hours |
| Package extension | 15 minutes |
| Prepare listing | 30 minutes |
| Submit | 5 minutes |
| **Wait for review** | **1-3 days** |
| Post-launch updates | 1 hour |

**Total active work:** ~4-5 hours
**Total calendar time:** 2-4 days

---

## Resources

- Publishing guide: `PUBLISHING_GUIDE.md`
- Store listing copy: `STORE_LISTING_COPY.txt`
- Chrome Web Store Dashboard: https://chrome.google.com/webstore/devconsole
- Developer docs: https://developer.chrome.com/docs/webstore/

---

**Current Status:** Not started

**Next Action:** Register Chrome Web Store developer account ($5)

---

Good luck! 🚀
