# Corteza Pricing Strategy & Implementation Plan

**Status:** Planning Phase (Beta is Free)
**Goal:** Define pricing model and technical implementation roadmap
**Timeline:** Implement when ready (3-6 months from now)

---

## 📊 Market Analysis & Positioning

### Comparable Products Pricing

| Product | Model | Price Range | Target |
|---------|-------|-------------|--------|
| Notion | Per user | $8-15/user/month | Knowledge base |
| Coda | Per user | $10-30/user/month | Documents + automation |
| Guru | Per user | $15-20/user/month | Knowledge management |
| Slab | Per user | $8-12/user/month | Team wiki |
| Confluence | Per user | $5-10/user/month | Enterprise wiki |
| Mem | Flat | $8-15/month | Personal memory |

**Key Insights:**
- Knowledge tools: $8-20/user/month
- Flat pricing rare but emerging
- AI features command premium ($3-5 extra)
- Free tiers are common (5-10 users)

---

## 💰 Recommended Pricing Model

### Model: **Tiered Per-Workspace Pricing** (Hybrid)

**Why this model:**
- ✅ Simple for small teams (no per-user calculation)
- ✅ Scales with team size naturally
- ✅ Predictable revenue
- ✅ Easy to understand
- ✅ Reduces friction for trying with whole team

**Alternative considered:** Per-user pricing → Rejected (too complex, slows adoption)

---

## 🎯 Pricing Tiers (Proposed)

### **Free Tier - "Starter"**
**Price:** $0/month
**Limits:**
- Up to 100 memories total
- 1 workspace
- Up to 5 team members
- **AI-powered semantic search - 30 searches/month** (full power!)
- Classic filter/search (unlimited, no AI)
- Browser extension
- Email authentication
- Community support

**Target:** Individual contributors, small side projects, trying out

**Strategy:** Let users experience the full AI power from day one. After 30 AI searches, they fall back to classic search - this creates urgency to upgrade while still providing value.

---

### **Team Tier - "Professional"** (Recommended)
**Price:** $29/month or $290/year (save $58)
**Per-seat overage:** $9/month per additional member after 10

**Limits:**
- Unlimited memories
- 1 workspace
- Up to 10 team members (included)
- **Additional members: $9/month each**
- AI-powered semantic search - unlimited
- Slack integration
- Browser extension
- Email support (48h response)
- Export data (CSV, JSON)

**Target:** Small product teams, startups (5-10 people)

**Example pricing:**
- 10 members: $29/month
- 15 members: $29 + (5 × $9) = $74/month
- 20 members: $29 + (10 × $9) = $119/month

---

### **Business Tier - "Enterprise"**
**Price:** $99/month or $990/year (save $198)
**Per-seat overage:** $9/month per additional member after 50

**Limits:**
- Everything in Team
- Up to 50 team members (included)
- **Additional members: $9/month each**
- Multiple workspaces (3)
- Advanced analytics & insights
- Custom AI personality/prompts
- API access
- Priority support (24h response)
- SSO (Single Sign-On)

**Target:** Growing companies, multiple product teams

**Example pricing:**
- 50 members: $99/month
- 75 members: $99 + (25 × $9) = $324/month
- 100 members: $99 + (50 × $9) = $549/month

---

### **Enterprise Tier - "Custom"**
**Price:** Custom (starts at $499/month)
**Limits:**
- Everything in Business
- Unlimited team members
- Unlimited workspaces
- On-premise deployment option
- Custom integrations
- Dedicated account manager
- SLA guarantees
- White-label option
- Custom data retention policies

**Target:** Large enterprises, regulated industries

---

## 🎯 Pricing Philosophy & Strategy

### The "Full Power Free Tier" Approach

**Why give AI search on the free tier?**

Traditional SaaS wisdom says: "Limit the best features to paid tiers." We're doing the opposite.

**Our strategy:**
1. **Let users taste the magic** - 30 AI searches shows the full power of Corteza
2. **Create urgency** - When they hit 30/30, they *feel* the limitation
3. **Smart fallback** - Classic search keeps them using Corteza (sticky!)
4. **Natural upgrade path** - They've already experienced the value

**Example user journey:**
- Week 1: Signs up, tries AI search → "Wow, this is amazing!"
- Week 2: Uses 10 more searches → Getting used to it
- Week 3: Hits 30/30 limit → "I need this to work faster"
- Week 4: Upgrades to Team plan → Customer for life

**Why this works:**
- ✅ Shows differentiated value immediately
- ✅ Creates habit before limiting
- ✅ Fallback prevents churn
- ✅ Higher conversion than "keyword search only"

### Per-Seat Pricing Strategy

**Why $9/seat overage instead of forcing plan upgrade?**

**Benefits:**
1. **Smooth scaling** - Teams don't hit walls
2. **Predictable revenue** - Linear growth with team size
3. **Lower friction** - No "we need 11 people but that's $99/month jump"
4. **Competitive** - $9/seat is industry standard (vs $10-15/seat competitors)

**Example:**
- Team with 15 people: $29 + (5 × $9) = $74/month
- Still cheaper than Business plan ($99)
- But revenue grows naturally as team grows

**When to upgrade to Business:**
- At 18+ users: $29 + (8 × $9) = $101 → Business plan ($99) is better value
- Plus Business includes 3 workspaces, SSO, API
- Natural upsell opportunity

---

## 🔄 Grandfathering Strategy for Beta Users

### Option 1: Lifetime Free (Recommended for First 100)

**Who:** First 100 beta users/workspaces
**What:** Free Team tier features forever
**Why:** Rewards early adopters, builds loyalty, generates testimonials

**Implementation:**
```javascript
// In database
{
  workspace_id: "W123",
  plan: "team",
  billing_status: "grandfathered",
  grandfathered_date: "2026-02-08",
  notes: "Beta user - free Team tier for life"
}
```

---

### Option 2: Discounted Forever (For Next 500)

**Who:** Beta users 101-500
**What:** 50% off Team tier forever ($14.50/month instead of $29)
**Why:** Still rewards early adopters, generates revenue

---

### Option 3: Extended Trial (For All Beta Users)

**Who:** All beta users when pricing launches
**What:** 6 months free Team tier, then switch to Free or pay
**Why:** Smooth transition, time to prove value

---

## 🛠️ Technical Implementation Plan

### Phase 1: Database Schema Updates

**New Tables:**

#### `subscriptions` table
```sql
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  plan_id VARCHAR(50) NOT NULL, -- 'free', 'team', 'business', 'enterprise'
  status VARCHAR(20) NOT NULL, -- 'active', 'canceled', 'past_due', 'trialing'

  -- Stripe IDs
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100),

  -- Billing
  billing_cycle VARCHAR(20), -- 'monthly', 'annual'
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT false,

  -- Limits
  memory_limit INTEGER, -- NULL = unlimited
  user_limit INTEGER,
  workspace_limit INTEGER DEFAULT 1,

  -- Grandfathering
  is_grandfathered BOOLEAN DEFAULT false,
  grandfathered_plan VARCHAR(50),
  grandfathered_reason TEXT,

  -- Timestamps
  trial_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(workspace_id)
);
```

#### `plans` table
```sql
CREATE TABLE plans (
  id VARCHAR(50) PRIMARY KEY, -- 'free', 'team', 'business', 'enterprise'
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,

  -- Pricing
  monthly_price_cents INTEGER NOT NULL,
  annual_price_cents INTEGER NOT NULL,

  -- Stripe IDs
  stripe_monthly_price_id VARCHAR(100),
  stripe_annual_price_id VARCHAR(100),

  -- Limits
  memory_limit INTEGER, -- NULL = unlimited
  user_limit INTEGER,
  workspace_limit INTEGER,

  -- Features (JSON)
  features JSONB,

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_visible BOOLEAN DEFAULT true, -- Show on pricing page

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `usage_tracking` table
```sql
CREATE TABLE usage_tracking (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,

  -- Current usage
  memories_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 0,
  workspaces_count INTEGER DEFAULT 1,

  -- Monthly usage (resets each billing cycle)
  ai_searches_count INTEGER DEFAULT 0,
  api_calls_count INTEGER DEFAULT 0,

  -- Timestamps
  last_updated TIMESTAMP DEFAULT NOW(),

  UNIQUE(workspace_id)
);
```

#### `invoices` table
```sql
CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  subscription_id INTEGER REFERENCES subscriptions(id),

  stripe_invoice_id VARCHAR(100),

  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(20), -- 'draft', 'open', 'paid', 'void'

  invoice_pdf_url TEXT,

  period_start TIMESTAMP,
  period_end TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);
```

---

### Phase 2: Backend API Endpoints

**New files to create:**

#### `src/services/billing.js`
```javascript
/**
 * Billing service - handles subscription logic
 */

class BillingService {
  // Check if workspace can perform action
  async canPerformAction(workspaceId, action) {
    // action: 'create_memory', 'add_user', 'use_ai_search', etc.
    const subscription = await getSubscription(workspaceId);
    const usage = await getUsage(workspaceId);

    return checkLimits(subscription, usage, action);
  }

  // Get current plan for workspace
  async getCurrentPlan(workspaceId) { }

  // Upgrade/downgrade plan
  async changePlan(workspaceId, newPlanId) { }

  // Cancel subscription
  async cancelSubscription(workspaceId) { }

  // Track usage
  async incrementUsage(workspaceId, metric) { }
}
```

#### `src/services/stripe.js`
```javascript
/**
 * Stripe integration service
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class StripeService {
  // Create customer
  async createCustomer(email, workspaceId) { }

  // Create subscription
  async createSubscription(customerId, priceId) { }

  // Handle webhooks
  async handleWebhook(event) {
    switch(event.type) {
      case 'invoice.paid':
        // Update subscription status
      case 'invoice.payment_failed':
        // Handle failed payment
      case 'customer.subscription.deleted':
        // Handle cancellation
    }
  }

  // Create checkout session
  async createCheckoutSession(workspaceId, priceId) { }

  // Create billing portal session
  async createPortalSession(customerId) { }

  // Add per-seat billing
  async addSeat(subscriptionId, quantity = 1) {
    // Update subscription quantity in Stripe
    // Stripe will automatically prorate the charge
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        quantity: subscription.items.data[0].quantity + quantity
      }]
    });
    return subscription;
  }

  // Remove seat (when user is removed)
  async removeSeat(subscriptionId, quantity = 1) {
    // Decrease quantity, Stripe will credit on next invoice
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        quantity: Math.max(1, subscription.items.data[0].quantity - quantity)
      }]
    });
    return subscription;
  }
}
```

#### `src/middleware/plan-limits.js`
```javascript
/**
 * Middleware to check plan limits before actions
 */

async function checkMemoryLimit(req, res, next) {
  const workspaceId = req.session.user.workspace_id;
  const billing = new BillingService();

  const canCreate = await billing.canPerformAction(workspaceId, 'create_memory');

  if (!canCreate) {
    return res.status(403).json({
      error: 'Memory limit reached',
      message: 'Your free plan allows up to 100 memories. Upgrade to Team for unlimited memories.',
      upgrade_url: '/pricing'
    });
  }

  next();
}

async function checkAISearchLimit(req, res, next) {
  const workspaceId = req.session.user.workspace_id;
  const billing = new BillingService();

  const canUseAI = await billing.canPerformAction(workspaceId, 'use_ai_search');

  if (!canUseAI) {
    // Free tier: fallback to classic search (no error, just disable AI)
    req.aiSearchDisabled = true;
    req.aiSearchReason = 'limit_reached'; // Show "30/30 AI searches used this month. Upgrade for unlimited."
  }

  next(); // Always continue - classic search is always available
}

async function checkUserLimit(req, res, next) {
  const workspaceId = req.session.user.workspace_id;
  const billing = new BillingService();

  const canAddUser = await billing.canPerformAction(workspaceId, 'add_user');

  if (!canAddUser) {
    // Check if they can pay per-seat overage
    const plan = await billing.getCurrentPlan(workspaceId);

    if (plan.per_seat_price_cents > 0) {
      return res.status(403).json({
        error: 'User limit reached',
        message: `Your ${plan.display_name} plan includes ${plan.user_limit} members. Add another for $${plan.per_seat_price_cents / 100}/month.`,
        per_seat_price: plan.per_seat_price_cents,
        upgrade_url: '/billing/add-seat'
      });
    } else {
      return res.status(403).json({
        error: 'User limit reached',
        message: 'Upgrade to add more team members.',
        upgrade_url: '/pricing'
      });
    }
  }

  next();
}

module.exports = {
  checkMemoryLimit,
  checkAISearchLimit,
  checkUserLimit
};
```

#### `src/routes/billing.js`
```javascript
/**
 * Billing routes
 */

// GET /billing/plans - List available plans
async function getPlans(req, res) { }

// GET /billing/subscription - Get current subscription
async function getSubscription(req, res) { }

// GET /billing/usage - Get current usage stats
async function getUsage(req, res) { }

// POST /billing/checkout - Create checkout session
async function createCheckout(req, res) { }

// POST /billing/portal - Create billing portal session
async function createPortal(req, res) { }

// POST /billing/webhook - Stripe webhook handler
async function handleWebhook(req, res) { }

// POST /billing/cancel - Cancel subscription
async function cancelSubscription(req, res) { }
```

---

### Phase 3: Frontend Updates

**New pages/components to create:**

#### `src/views/pricing.html`
```html
<!-- Public pricing page -->
<section class="pricing">
  <h1>Simple, Transparent Pricing</h1>
  <p>Start free. Upgrade when you're ready.</p>

  <div class="pricing-toggle">
    <button>Monthly</button>
    <button>Annual (Save 17%)</button>
  </div>

  <div class="pricing-cards">
    <!-- Free tier -->
    <div class="pricing-card">
      <h3>Starter</h3>
      <div class="price">$0<span>/month</span></div>
      <ul>
        <li>100 memories</li>
        <li>Up to 5 members</li>
        <li>30 AI searches/month ⚡</li>
        <li>Classic search (unlimited)</li>
        <li>Browser extension</li>
        <li>1 workspace</li>
      </ul>
      <button>Start Free</button>
    </div>

    <!-- Team tier -->
    <div class="pricing-card featured">
      <div class="badge">Most Popular</div>
      <h3>Team</h3>
      <div class="price">$29<span>/month</span></div>
      <ul>
        <li>Unlimited memories</li>
        <li>AI-powered search</li>
        <li>Up to 10 users</li>
        <li>Slack + Extension</li>
      </ul>
      <button>Start 14-Day Trial</button>
    </div>

    <!-- Business tier -->
    <!-- Enterprise tier -->
  </div>
</section>
```

#### `src/views/billing-dashboard.html`
```html
<!-- Billing settings in dashboard -->
<div class="billing-section">
  <h2>Billing & Subscription</h2>

  <div class="current-plan">
    <h3>Current Plan: Team</h3>
    <p>$29/month • Renews March 1, 2026</p>
    <button onclick="openBillingPortal()">Manage Subscription</button>
  </div>

  <div class="usage-stats">
    <h3>Current Usage</h3>
    <div class="usage-meter">
      <label>Memories</label>
      <progress value="247" max="unlimited">Unlimited</progress>
      <span>247 memories</span>
    </div>
    <div class="usage-meter">
      <label>Team Members</label>
      <progress value="7" max="10">7 of 10</progress>
      <span>7 of 10 users</span>
    </div>
  </div>

  <div class="upgrade-cta">
    <p>Need more users or workspaces?</p>
    <button onclick="showUpgradeModal()">Upgrade to Business</button>
  </div>
</div>
```

#### `public/scripts/billing.js`
```javascript
// Frontend billing logic

async function openBillingPortal() {
  const response = await fetch('/billing/portal', { method: 'POST' });
  const { url } = await response.json();
  window.location.href = url; // Redirects to Stripe portal
}

async function startCheckout(priceId) {
  const response = await fetch('/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price_id: priceId })
  });
  const { url } = await response.json();
  window.location.href = url; // Redirects to Stripe checkout
}

async function loadUsageStats() {
  const response = await fetch('/billing/usage');
  const usage = await response.json();
  updateUsageMeters(usage);
}
```

---

### Phase 4: Feature Gating

**Where to add checks:**

#### `src/routes/api.js` - Memory creation
```javascript
// Before creating memory
const { checkMemoryLimit } = require('../middleware/plan-limits');

app.post('/api/memory/create',
  requireAuth,
  checkMemoryLimit, // NEW: Check limit
  createMemory
);
```

#### `src/routes/semantic-search.js` - AI search
```javascript
// Before AI search
const { checkAISearchLimit } = require('../middleware/plan-limits');

app.post('/api/semantic-search',
  requireAuth,
  checkAISearchLimit, // NEW: Check if plan allows AI
  handleSemanticSearch
);
```

#### Dashboard UI - Feature locks
```javascript
// In dashboard.js
async function checkFeatureAccess() {
  const subscription = await fetch('/billing/subscription').then(r => r.json());

  if (subscription.plan === 'free') {
    // Disable AI search button
    document.getElementById('ai-search-toggle').disabled = true;
    document.getElementById('ai-search-toggle').title = 'Upgrade to Team for AI search';

    // Show upgrade prompts
    showUpgradePrompts();
  }
}
```

---

### Phase 5: Payment Provider Integration (Stripe)

**Setup steps:**

1. **Create Stripe Account**
   - Sign up at stripe.com
   - Complete business verification
   - Add bank account for payouts

2. **Create Products in Stripe**
   ```
   Product: Corteza Team (Monthly)
   Price: $29/month
   ID: price_team_monthly_xxx

   Product: Corteza Team (Annual)
   Price: $290/year
   ID: price_team_annual_xxx

   [Repeat for Business, Enterprise]
   ```

3. **Install Stripe SDK**
   ```bash
   npm install stripe
   ```

4. **Environment Variables**
   ```bash
   STRIPE_SECRET_KEY=sk_live_xxx
   STRIPE_PUBLISHABLE_KEY=pk_live_xxx
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

5. **Setup Webhooks**
   - Stripe Dashboard → Webhooks
   - Endpoint: `https://app.corteza.app/billing/webhook`
   - Events to listen:
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`

---

## 🚀 Migration Plan: Beta → Paid

### Timeline

**Month 1-2: Preparation**
- Build database schema
- Build billing backend
- Integrate Stripe
- Internal testing

**Month 3: Soft Launch**
- Add pricing page (hidden)
- Email beta users about upcoming changes
- Offer early bird discount

**Month 4: Public Launch**
- Make pricing page public
- Enable free tier limits
- Grandfathering: Give beta users lifetime/discounted access
- Send migration emails

**Month 5: Enforcement**
- Start enforcing limits on free tier
- Show upgrade prompts
- Monitor churn

---

### Communication Plan

#### Email 1: Announcement (2 months before)
```
Subject: Corteza is growing - what's next

Hi [Name],

Exciting news! Corteza has grown from 10 beta users to over [X] teams.
Thanks for being part of this journey.

As we scale, we're introducing pricing to sustain and improve the platform.

**What this means for you:**
- You'll keep Team features free forever (our thank you for being early!)
- Pricing launches in 2 months
- Nothing changes for your workspace

More details coming soon.

Questions? Reply to this email.

Thanks,
Cristian
```

#### Email 2: Detailed Plan (1 month before)
```
Subject: Your Corteza pricing - Locked in at $0

Hi [Name],

Quick update on Corteza pricing (launching March 1):

**Your Plan: Team (Free Forever)**
✅ Unlimited memories
✅ AI-powered search
✅ All integrations
✅ Priority support

Why free? You believed in us early. This is our thank you.

**New users will see:**
- Free tier: 100 memories, basic search
- Team tier: $29/month (what you get free!)
- Business tier: $99/month

Nothing changes for you. Just keep using Corteza!

Cheers,
Cristian

P.S. Help us spread the word? Share Corteza with other teams!
```

#### Email 3: Launch Day
```
Subject: Corteza pricing is live (you're still free!)

Hi [Name],

Corteza pricing launched today 🎉

Your workspace: Still free (Team features forever)

Public pricing: https://corteza.app/pricing

Thanks for being an early believer.

Cristian
```

---

## 📊 Metrics to Track

### Pre-Launch
- Beta users count
- Active workspaces
- Average memories per workspace
- Feature usage (AI search, exports, etc.)

### Post-Launch
- Free tier signups
- Free → Paid conversion rate (target: 3-5%)
- Paid tier distribution (Team vs Business)
- Monthly Recurring Revenue (MRR)
- Churn rate (target: <5%/month)
- Customer Lifetime Value (LTV)
- Customer Acquisition Cost (CAC)
- LTV:CAC ratio (target: 3:1)

---

## 💡 Pricing Experiments to Try

### Experiment 1: Trial Length
- **A:** 7-day trial
- **B:** 14-day trial
- **C:** 30-day trial
- **Measure:** Trial → Paid conversion rate

### Experiment 2: Free Tier Limits
- **A:** 50 memories
- **B:** 100 memories
- **C:** 500 memories
- **Measure:** Free → Paid conversion + retention

### Experiment 3: Pricing Points
- **A:** $19/month Team tier
- **B:** $29/month Team tier
- **C:** $39/month Team tier
- **Measure:** Conversion rate, revenue per customer

---

## 🎯 Revenue Projections (Conservative)

### Year 1 Assumptions
- 100 beta users (grandfathered free)
- 500 new free users
- 3% conversion rate (15 paid customers)
- Average plan: $29/month

**Monthly Revenue:**
- Month 6: $435 (15 × $29)
- Month 12: $1,450 (50 × $29)

**Annual Revenue Year 1:** ~$10,000

### Year 2 Assumptions
- 2,000 free users
- 5% conversion rate (100 paid customers)
- Mix: 70% Team, 20% Business, 10% Enterprise

**Monthly Revenue:**
- Month 24: $4,500

**Annual Revenue Year 2:** ~$40,000

---

## 🔐 Legal & Compliance

### Required Documents (Create Before Launch)

1. **Terms of Service Update**
   - Add billing terms
   - Refund policy
   - Cancellation policy
   - Plan changes

2. **Privacy Policy Update**
   - Stripe data processing
   - Payment information handling

3. **Refund Policy**
   - 30-day money-back guarantee (recommended)
   - Pro-rated refunds for annual plans
   - No refunds for monthly after use

4. **SLA (Service Level Agreement)** - For Business+ tiers
   - 99.9% uptime guarantee
   - Response times
   - Credits for downtime

---

## 🛡️ Risk Mitigation

### Risk 1: Beta Users Churn After Pricing
**Mitigation:** Grandfather them with free Team tier
**Backup:** Offer 50% lifetime discount

### Risk 2: Low Free → Paid Conversion
**Mitigation:** Generous free tier to build habit, clear upgrade path
**Backup:** Adjust limits, add killer paid feature

### Risk 3: Price Too High/Low
**Mitigation:** Start higher, easier to discount than raise
**Backup:** A/B test pricing, offer annual discounts

### Risk 4: Stripe Integration Bugs
**Mitigation:** Extensive testing in Stripe test mode
**Backup:** Manual invoicing as fallback

### Risk 5: Competition Undercuts Pricing
**Mitigation:** Focus on AI differentiation, not price
**Backup:** Add value (more features) not lower price

---

## 📝 Implementation Checklist

### Phase 1: Planning (Completed ✅)
- [x] Define pricing tiers
- [x] Choose billing model
- [x] Plan database schema
- [x] Design implementation roadmap

### Phase 2: Backend (3-4 weeks)
- [ ] Create database tables (subscriptions, plans, usage_tracking, invoices)
- [ ] Build billing service (src/services/billing.js)
- [ ] Integrate Stripe SDK (src/services/stripe.js)
- [ ] Create billing API routes
- [ ] Add plan limits middleware
- [ ] Setup Stripe webhooks
- [ ] Test with Stripe test mode

### Phase 3: Frontend (2-3 weeks)
- [ ] Create pricing page (public)
- [ ] Add billing dashboard (authenticated)
- [ ] Build checkout flow
- [ ] Add usage meters
- [ ] Create upgrade prompts
- [ ] Add plan badges/indicators

### Phase 4: Feature Gating (1-2 weeks)
- [ ] Add checks to memory creation
- [ ] Add checks to AI search
- [ ] Add checks to user invites
- [ ] Disable features for free tier
- [ ] Test all limits work correctly

### Phase 5: Migration (2 weeks)
- [ ] Identify beta users
- [ ] Create grandfathered subscriptions
- [ ] Send announcement emails
- [ ] Launch pricing page
- [ ] Monitor for issues

### Phase 6: Launch & Monitor (Ongoing)
- [ ] Public launch announcement
- [ ] Track conversions
- [ ] Respond to feedback
- [ ] Fix bugs
- [ ] Iterate on pricing

---

## 🎯 Success Criteria

**3 months post-launch:**
- ✅ 5+ paying customers
- ✅ <5% churn rate
- ✅ 0 payment processing issues
- ✅ Positive user feedback on pricing
- ✅ Clear upgrade path working

**6 months post-launch:**
- ✅ $2,000+ MRR
- ✅ 50+ paying customers
- ✅ 3%+ Free → Paid conversion
- ✅ Profitable unit economics

---

## 📚 Resources Needed

### Development
- **Time:** 8-10 weeks development
- **Cost:** $0 (your time)

### Infrastructure
- **Stripe:** 2.9% + $0.30 per transaction
- **Cost:** ~$1 per paid customer/month

### Legal
- **ToS/Privacy updates:** $500-1,000 (optional lawyer review)
- **Or:** Use templates and review yourself

### Total Estimated Cost: $1,000-2,000 one-time + ongoing Stripe fees

---

## 🚀 Next Steps (When Ready)

1. **Decide on timeline** - When do you want to launch pricing?
2. **Set up Stripe account** - Start with test mode
3. **Build Phase 2** (Backend) - Database + Stripe integration
4. **Test thoroughly** - Ensure billing works perfectly
5. **Communicate early** - Give beta users 2+ months notice
6. **Launch gradually** - Pricing page first, enforcement later
7. **Iterate based on feedback** - Adjust as you learn

---

## ✅ Summary

**Recommended Model:** Tiered per-workspace pricing
**Tiers:** Free ($0), Team ($29), Business ($99), Enterprise (Custom)
**Beta Users:** Free Team tier for life (first 100)
**Tech Stack:** Stripe + PostgreSQL
**Timeline:** 8-10 weeks to implement
**Revenue Goal:** $10K Year 1, $40K Year 2

**You're in a great position to monetize when ready!**

---

*Last Updated: 2026-02-08*
*Status: Planning Phase - Ready to Execute When Timing is Right*
