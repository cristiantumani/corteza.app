# 🚀 Launch Day Checklist

**Use this checklist on the day your extension is approved!**

---

## ⏰ Morning (First 2 Hours)

### Step 1: Verify Extension is Live (5 min)
- [ ] Check email for "Your item has been published" from Google
- [ ] Click the Chrome Web Store link in the email
- [ ] Verify extension page is public and accessible
- [ ] Copy your Chrome Web Store URL
- [ ] Save URL: ___________________________________

### Step 2: Test the Extension (15 min)
- [ ] Open Chrome in Incognito mode (fresh profile)
- [ ] Install extension from Chrome Web Store
- [ ] Click extension icon
- [ ] Verify "Not logged in" shows correctly
- [ ] Log in to https://app.corteza.app
- [ ] Reopen extension - verify "✓ Logged in" shows
- [ ] Try logging a test memory
- [ ] Verify it appears in dashboard
- [ ] ✅ Extension works perfectly!

### Step 3: Update All Marketing Materials (10 min)
- [ ] Open LINKEDIN_POST.txt
- [ ] Replace [CHROME_STORE_URL] with actual URL
- [ ] Save file
- [ ] Open TWITTER_THREAD.txt
- [ ] Replace [CHROME_STORE_URL] with actual URL
- [ ] Save file
- [ ] Open USER_EMAIL.txt
- [ ] Replace [CHROME_STORE_URL] with actual URL
- [ ] Save file

---

## 📱 Social Media Launch (Throughout Day)

### 9:00 AM - LinkedIn Post
- [ ] Go to Corteza LinkedIn company page
- [ ] Copy text from LINKEDIN_POST.txt
- [ ] Add screenshot of extension popup
- [ ] Post
- [ ] Share to personal profile
- [ ] Pin to company page
- [ ] Set reminder to check comments in 2 hours

### 10:00 AM - Twitter Thread
- [ ] Copy Tweet 1 from TWITTER_THREAD.txt
- [ ] Post Tweet 1
- [ ] Wait 2 minutes
- [ ] Reply with Tweet 2
- [ ] Reply with Tweet 3
- [ ] Reply with Tweet 4
- [ ] Reply with Tweet 5
- [ ] Retweet thread from personal account
- [ ] Pin thread to profile

### 2:00 PM - Product Hunt (Optional)
- [ ] Go to https://www.producthunt.com/posts/new
- [ ] Copy description from LAUNCH_KIT.md
- [ ] Add screenshots
- [ ] Add topics/tags
- [ ] Submit
- [ ] Share Product Hunt link on Twitter
- [ ] Share Product Hunt link on LinkedIn

---

## 📧 Email & Website Updates

### 10:30 AM - Email Existing Users
- [ ] Get list of Corteza user emails
- [ ] Copy text from USER_EMAIL.txt
- [ ] Send via your email platform (Mailchimp, SendGrid, etc.)
- [ ] Track open rates
- [ ] Monitor replies

### 11:00 AM - Update Website
- [ ] Go to https://corteza.app
- [ ] Add Chrome Web Store badge:
  ```html
  <a href="[YOUR_CHROME_STORE_URL]">
    <img src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/iNEddTyWiMfLSwFD6qGq.png"
         alt="Available in the Chrome Web Store" height="58">
  </a>
  ```
- [ ] Add "Install Extension" CTA button
- [ ] Update homepage copy to mention extension
- [ ] Test all links work
- [ ] Deploy changes

### 11:30 AM - Update GitHub
- [ ] Update main README.md with Chrome Web Store link
- [ ] Update browser-extension/README.md:
  ```markdown
  ## Installation

  ### From Chrome Web Store (Recommended)
  Install directly from the [Chrome Web Store]([YOUR_URL])

  ### Developer Mode
  [Keep existing instructions...]
  ```
- [ ] Commit and push changes

---

## 🎯 Engagement & Monitoring

### 12:00 PM - First Check-in
- [ ] LinkedIn post: Like/reply to all comments
- [ ] Twitter: Engage with all replies and retweets
- [ ] Chrome Web Store: Check for reviews (likely none yet)
- [ ] Email: Respond to any replies

### 3:00 PM - Mid-Day Check-in
- [ ] Check installation stats in Chrome Web Store dashboard
- [ ] Current installs: _________
- [ ] Check reviews (if any)
- [ ] Respond to all feedback within 1 hour
- [ ] Share milestone if reached (e.g., "50 installs in first 6 hours!")

### 6:00 PM - Evening Check-in
- [ ] Final social media engagement sweep
- [ ] Respond to all comments/messages
- [ ] Check installation stats
- [ ] End of day installs: _________
- [ ] Screenshot stats for tomorrow's update

---

## 🌍 Community Sharing (Optional)

If you have time, share in these communities:

### Reddit
- [ ] r/productivity
- [ ] r/chrome_extensions
- [ ] r/productmanagement
- [ ] r/SideProject

### Indie Hackers
- [ ] Post in "Show IH" section
- [ ] Share in relevant groups

### Discord/Slack Communities
- [ ] Product management communities
- [ ] Chrome extension developer groups
- [ ] Startup/indie hacker groups

**Template for community posts:**
```
Hey [community]! Just launched Corteza as a Chrome extension.

It's a team memory tool powered by AI - log decisions from any webpage, search them later with natural language.

Built it because we kept losing decisions in Slack threads.

Free to use: [CHROME_STORE_URL]

Would love feedback from this community!
```

---

## 📊 Day 1 Metrics to Track

Record these at end of day:

**Installations:**
- [ ] Total installs: _________
- [ ] Goal: 50+ (excellent), 25+ (good), 10+ (okay)

**Engagement:**
- [ ] LinkedIn post likes: _________
- [ ] LinkedIn post comments: _________
- [ ] Twitter thread likes: _________
- [ ] Twitter thread retweets: _________

**Reviews:**
- [ ] Chrome Web Store reviews: _________
- [ ] Average rating: _________

**Website:**
- [ ] Clicks to Chrome Web Store: _________
- [ ] New signups: _________

**Email:**
- [ ] Open rate: _________% (target: 25%+)
- [ ] Click rate: _________% (target: 5%+)

---

## 🎉 End of Day Celebration

### Post End-of-Day Update (7:00 PM)

**LinkedIn/Twitter:**
```
Day 1 update: [X] installations 🎉

Thanks to everyone who tried Corteza!

Keep the feedback coming - we're reading every comment.

Haven't installed yet? → [CHROME_STORE_URL]

[Screenshot of Chrome Web Store stats]
```

### Prepare for Tomorrow
- [ ] Note common questions for FAQ
- [ ] Collect positive feedback for testimonials
- [ ] Prioritize any bug reports
- [ ] Plan Day 2 content ("Behind the scenes" post)

---

## 🚨 If Something Goes Wrong

### Extension Bug Reports
1. Acknowledge immediately (within 1 hour)
2. Ask for details: Chrome version, screenshot, steps to reproduce
3. Create GitHub issue
4. Fix and release update ASAP
5. Notify reporters when fixed

### Negative Review
1. Don't panic - it happens
2. Respond professionally and helpfully
3. Offer to help via email
4. Fix the issue if valid
5. Follow up when resolved

### Low Installation Numbers
- Don't worry! Day 1 is just the start
- Focus on quality of feedback over quantity
- Improve based on feedback
- Keep promoting over next few weeks
- Growth compounds over time

---

## ✅ You Did It!

**Congratulations on launching your Chrome extension!** 🚀

Tomorrow: Focus on engaging with users, collecting feedback, and improving the product.

**Questions or need help?** Review LAUNCH_KIT.md for detailed guidance.

---

**Total Time Required:** ~4-5 hours spread throughout the day

**Most Important:** Respond to ALL comments and reviews quickly. Engagement is key!
