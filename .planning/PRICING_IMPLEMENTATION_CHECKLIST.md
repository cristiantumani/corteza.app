# Pricing Implementation Checklist

**Use this when you're ready to implement pricing**

Estimated time: 8-10 weeks

---

## Week 1-2: Setup & Planning

### Stripe Account Setup
- [ ] Create Stripe account (https://stripe.com)
- [ ] Complete business verification
- [ ] Add bank account for payouts
- [ ] Enable test mode
- [ ] Get API keys (test mode):
  - [ ] Publishable key: `pk_test_xxx`
  - [ ] Secret key: `sk_test_xxx`

### Create Products in Stripe Dashboard
- [ ] Product: Corteza Team (Monthly) - $29
  - [ ] Save price ID: `price_team_monthly_xxx`
- [ ] Product: Corteza Team (Annual) - $290
  - [ ] Save price ID: `price_team_annual_xxx`
- [ ] Product: Corteza Business (Monthly) - $99
  - [ ] Save price ID: `price_business_monthly_xxx`
- [ ] Product: Corteza Business (Annual) - $990
  - [ ] Save price ID: `price_business_annual_xxx`

### Environment Variables
- [ ] Add to `.env`:
  ```bash
  STRIPE_SECRET_KEY=sk_test_xxx
  STRIPE_PUBLISHABLE_KEY=pk_test_xxx
  STRIPE_WEBHOOK_SECRET=whsec_xxx (after webhook setup)
  ```

---

## Week 3-4: Database Implementation

### Run Migration
- [ ] Review `.planning/pricing-db-migration.sql`
- [ ] Test in local database first
- [ ] Run on staging database
- [ ] Verify all tables created:
  - [ ] `plans`
  - [ ] `subscriptions`
  - [ ] `usage_tracking`
  - [ ] `invoices`
  - [ ] `billing_events`

### Verify Data
- [ ] Check plans populated: `SELECT * FROM plans;`
- [ ] Check subscriptions created for existing workspaces
- [ ] Check grandfathered beta users
- [ ] Check usage tracking initialized

---

## Week 5-6: Backend Implementation

### Install Dependencies
- [ ] `npm install stripe`

### Create New Files

#### `src/services/billing.js`
- [ ] `BillingService` class
- [ ] `canPerformAction(workspaceId, action)` method
- [ ] `getCurrentPlan(workspaceId)` method
- [ ] `changePlan(workspaceId, newPlanId)` method
- [ ] `cancelSubscription(workspaceId)` method
- [ ] `incrementUsage(workspaceId, metric)` method
- [ ] Test with unit tests

#### `src/services/stripe.js`
- [ ] Initialize Stripe SDK
- [ ] `createCustomer(email, workspaceId)` method
- [ ] `createSubscription(customerId, priceId)` method
- [ ] `handleWebhook(event)` method
- [ ] `createCheckoutSession(workspaceId, priceId)` method
- [ ] `createPortalSession(customerId)` method
- [ ] `addSeat(subscriptionId, quantity)` method - Per-seat billing
- [ ] `removeSeat(subscriptionId, quantity)` method - Per-seat billing
- [ ] Test with Stripe test mode

#### `src/middleware/plan-limits.js`
- [ ] `checkMemoryLimit` middleware - Blocks memory creation when limit reached
- [ ] `checkAISearchLimit` middleware - **IMPORTANT: Don't block! Set req.aiSearchDisabled = true**
- [ ] `checkUserLimit` middleware - Offer per-seat upgrade or plan upgrade
- [ ] Test middleware works correctly:
  - [ ] Free tier: AI search works for first 30 searches
  - [ ] Free tier: After 30 searches, falls back to classic search (no error)
  - [ ] Team/Business: Offer $9/seat when user limit reached
  - [ ] Test classic search still works when AI disabled

#### `src/routes/billing.js`
- [ ] GET `/billing/plans` - List plans
- [ ] GET `/billing/subscription` - Get current subscription
- [ ] GET `/billing/usage` - Get usage stats (including AI search count: X/30 or X/unlimited)
- [ ] POST `/billing/checkout` - Create checkout session
- [ ] POST `/billing/portal` - Create billing portal
- [ ] POST `/billing/webhook` - Stripe webhook handler
- [ ] POST `/billing/cancel` - Cancel subscription
- [ ] POST `/billing/add-seat` - **NEW: Add per-seat billing**
  - [ ] Check if plan supports per-seat pricing
  - [ ] Update Stripe subscription quantity
  - [ ] Update database user_limit
  - [ ] Return updated subscription info
- [ ] Test all endpoints

### Update Existing Routes
- [ ] Add `checkMemoryLimit` to POST `/api/memory/create`
- [ ] Add `checkAISearchLimit` to POST `/api/semantic-search`
- [ ] Update `/api/semantic-search` to handle fallback:
  - [ ] If `req.aiSearchDisabled === true`, return classic filter results instead
  - [ ] Include in response: `{ aiSearchDisabled: true, reason: 'limit_reached', usage: '30/30' }`
  - [ ] Frontend shows upgrade prompt: "You've used 30/30 AI searches this month. Upgrade for unlimited."
- [ ] Add `checkUserLimit` to POST `/api/workspace/invite`
- [ ] Test limits work correctly:
  - [ ] Free tier falls back to classic search after 30 AI searches
  - [ ] Team/Business can add seats when user limit reached

### Setup Stripe Webhooks
- [ ] Stripe Dashboard → Developers → Webhooks
- [ ] Add endpoint: `https://app.corteza.app/billing/webhook`
- [ ] Select events:
  - [ ] `invoice.paid`
  - [ ] `invoice.payment_failed`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`
  - [ ] `customer.subscription.trial_will_end`
- [ ] Save webhook secret to `.env`
- [ ] Test webhook with Stripe CLI: `stripe listen --forward-to localhost:3000/billing/webhook`

---

## Week 7: Frontend Implementation

### Create New Pages

#### `src/views/pricing.html`
- [ ] Hero section
- [ ] Pricing toggle (monthly/annual)
- [ ] Pricing cards (Free, Team, Business, Enterprise)
  - [ ] Free tier highlights: "30 AI searches/month ⚡" with badge
  - [ ] Team/Business: Show per-seat pricing ("$9/month per additional member")
  - [ ] Add tooltips explaining per-seat billing
- [ ] Feature comparison table
- [ ] FAQ section (add Q&A about AI search limit and per-seat pricing)
- [ ] CTA buttons link to checkout
- [ ] Mobile responsive
- [ ] Test in browser

#### `src/views/billing-settings.html`
- [ ] Current plan display
- [ ] Usage meters:
  - [ ] Memories: X/100 (free) or X/unlimited (paid)
  - [ ] Users: X/5 (free), X/10 (team), X/50 (business) + "Add seat for $9/month" button
  - [ ] **AI Searches: X/30 (free) or X/unlimited (paid)** - Show prominent upgrade CTA when approaching limit
- [ ] Upgrade/downgrade buttons
- [ ] "Add seat" button (for Team/Business plans when approaching user limit)
- [ ] "Manage subscription" button (opens Stripe portal)
- [ ] Invoice history
- [ ] Test UI

### Update Dashboard
- [ ] Add "Billing" link to navigation
- [ ] Add usage indicators (when approaching limits)
- [ ] **AI Search Limit UI** (Free tier):
  - [ ] Show "X/30 AI searches used" badge on chat input
  - [ ] At 25/30: Show warning "5 AI searches remaining this month"
  - [ ] At 30/30: Disable AI search button, show "Upgrade for unlimited AI searches"
  - [ ] When disabled: Chat input shows "Classic search only - Upgrade to unlock AI"
  - [ ] Add subtle animation/color change when approaching limit
- [ ] Add upgrade prompts when hitting limits
- [ ] **Don't disable classic search** - always available as fallback
- [ ] Test all UI changes:
  - [ ] Free tier can still search after 30 AI searches (using classic)
  - [ ] Paid tiers show "Unlimited" instead of count

### Create `public/scripts/billing.js`
- [ ] `startCheckout(priceId)` function
- [ ] `openBillingPortal()` function
- [ ] `loadUsageStats()` function
- [ ] `checkFeatureAccess()` function
- [ ] Test all functions

### Update CSS
- [ ] Style pricing page
- [ ] Style billing dashboard
- [ ] Style upgrade prompts
- [ ] Style usage meters
- [ ] Mobile responsive

---

## Week 8: Testing & Polish

### Unit Tests
- [ ] Test billing service methods
- [ ] Test limit checks
- [ ] Test usage increments
- [ ] Test plan changes

### Integration Tests
- [ ] Test full checkout flow (test mode)
- [ ] Test webhook handling
- [ ] Test subscription updates
- [ ] Test cancellations
- [ ] Test trial expirations

### Manual Testing Checklist
- [ ] Create test workspace
- [ ] Sign up for Team plan (test mode)
- [ ] Create memories up to limit
- [ ] Verify limit blocks creation
- [ ] Try to use AI search on free tier
- [ ] Upgrade from Free to Team
- [ ] Downgrade from Team to Free
- [ ] Cancel subscription
- [ ] Test billing portal
- [ ] Test invoice generation
- [ ] Test refunds

### Edge Cases
- [ ] What happens if payment fails?
- [ ] What happens if trial expires?
- [ ] What happens if downgrade would exceed limits?
- [ ] What happens if Stripe is down?
- [ ] What happens if webhook is delayed?

---

## Week 9: Beta User Communication

### Email 1: Announcement (Send now)
- [ ] Subject: "Corteza is growing - what's next"
- [ ] Announce pricing coming
- [ ] Assure beta users get free Team tier
- [ ] Timeline: 2 weeks
- [ ] Send to all beta users

### Email 2: Details (Send 1 week later)
- [ ] Subject: "Your Corteza pricing - Locked in at $0"
- [ ] Confirm grandfathered status
- [ ] Show what new users will pay
- [ ] Link to pricing page
- [ ] Send to all beta users

### Update Website
- [ ] Add announcement banner
- [ ] Update homepage copy
- [ ] Add "Pricing coming soon" section

---

## Week 10: Launch

### Pre-Launch (Day before)
- [ ] Switch Stripe to live mode
- [ ] Update environment variables with live keys
- [ ] Test checkout with real card (refund after)
- [ ] Verify webhooks work in production
- [ ] Double-check all beta users grandfathered

### Launch Day
- [ ] Enable pricing page (make public)
- [ ] Send Email 3: "Corteza pricing is live"
- [ ] Post on LinkedIn
- [ ] Post on Twitter
- [ ] Update all marketing materials

### Monitor (First 48 hours)
- [ ] Check for errors in logs
- [ ] Monitor Stripe dashboard
- [ ] Respond to user questions
- [ ] Track first conversions
- [ ] Fix any bugs immediately

---

## Post-Launch Ongoing

### Daily (Week 1)
- [ ] Check for new signups
- [ ] Monitor conversion rates
- [ ] Respond to billing questions
- [ ] Check for failed payments
- [ ] Review Stripe logs

### Weekly (Month 1)
- [ ] Review metrics (MRR, churn, conversion)
- [ ] Collect user feedback
- [ ] Adjust limits if needed
- [ ] Improve based on feedback

### Monthly (Ongoing)
- [ ] Review revenue
- [ ] Analyze upgrade/downgrade patterns
- [ ] Update pricing page based on learnings
- [ ] Consider pricing experiments
- [ ] Plan new paid features

---

## Success Metrics to Track

### Week 1
- [ ] 0 critical bugs
- [ ] First paying customer
- [ ] 0 angry beta users
- [ ] Smooth checkout flow

### Month 1
- [ ] 5+ paying customers
- [ ] 3%+ free → paid conversion
- [ ] <5% churn rate
- [ ] $500+ MRR

### Month 3
- [ ] 15+ paying customers
- [ ] $1,500+ MRR
- [ ] Clear upgrade patterns
- [ ] Profitable unit economics

### Month 6
- [ ] 50+ paying customers
- [ ] $3,000+ MRR
- [ ] Predictable growth
- [ ] Consider raising prices

---

## Rollback Plan

### If Major Issues
- [ ] Pause new signups
- [ ] Disable pricing page
- [ ] Refund affected customers
- [ ] Fix issues
- [ ] Re-launch

### If Low Conversions
- [ ] Survey users (why not upgrading?)
- [ ] Adjust free tier limits
- [ ] Add killer paid feature
- [ ] Test different pricing points
- [ ] Don't panic - takes time!

---

## Resources

### Documentation
- [ ] Stripe docs: https://stripe.com/docs
- [ ] Stripe webhooks: https://stripe.com/docs/webhooks
- [ ] Pricing strategy: `/PRICING_STRATEGY.md`

### Support
- [ ] Stripe support (excellent!)
- [ ] Stripe community forum
- [ ] Your implementation plan: `/PRICING_STRATEGY.md`

---

## Before You Start

**Ask yourself:**
- [ ] Do I have 8-10 weeks to dedicate to this?
- [ ] Is my current user base large enough? (50+ active users recommended)
- [ ] Have I validated people would pay? (ask in beta!)
- [ ] Is the product stable? (no major bugs)
- [ ] Am I ready for support burden? (billing questions)

**If any answer is NO, wait!** It's okay to stay free longer.

---

## Notes

**Cost:** ~$1,000 one-time (optional legal review) + Stripe fees (2.9% + $0.30)

**Time:** 8-10 weeks of focused development

**Risk:** Low - can always rollback or adjust pricing

**Reward:** Sustainable revenue to grow Corteza

---

**You've got this! 🚀**

When ready, start with Week 1 and work through systematically.
