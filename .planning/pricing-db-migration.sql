-- ============================================
-- Corteza Pricing - Database Migration Script
-- ============================================
-- Run this when ready to implement pricing
-- Test in development first!
--
-- PRICING STRATEGY NOTES:
-- - Free tier gets 30 AI searches/month (full power from day one!)
-- - After 30 searches, free users fall back to classic search (no hard block)
-- - Team/Business plans support per-seat pricing at $9/month per additional user
-- - All beta users get grandfathered to Team plan (free for life)
-- ============================================

-- ============================================
-- 1. PLANS TABLE
-- ============================================

CREATE TABLE plans (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,

  -- Pricing (stored in cents)
  monthly_price_cents INTEGER NOT NULL,
  annual_price_cents INTEGER NOT NULL,
  per_seat_price_cents INTEGER DEFAULT 0, -- Price for each additional user beyond user_limit

  -- Stripe integration
  stripe_monthly_price_id VARCHAR(100),
  stripe_annual_price_id VARCHAR(100),

  -- Limits (NULL = unlimited)
  memory_limit INTEGER,
  user_limit INTEGER,
  workspace_limit INTEGER DEFAULT 1,
  ai_search_limit INTEGER, -- per month, NULL = unlimited

  -- Features (stored as JSON)
  features JSONB DEFAULT '{}',

  -- Display
  is_active BOOLEAN DEFAULT true,
  is_visible BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default plans
INSERT INTO plans (id, name, display_name, description, monthly_price_cents, annual_price_cents, per_seat_price_cents, memory_limit, user_limit, workspace_limit, ai_search_limit, features, sort_order) VALUES
(
  'free',
  'starter',
  'Starter',
  'Perfect for trying out Corteza - full AI power from day one!',
  0,
  0,
  0, -- No per-seat pricing on free
  100, -- 100 memories max
  5,   -- 5 users max
  1,   -- 1 workspace
  30,  -- 30 AI searches per month (then fallback to classic search)
  '{"slack": false, "extension": true, "export": false, "api": false, "analytics": false, "sso": false}',
  1
),
(
  'team',
  'professional',
  'Team',
  'For small product teams',
  2900, -- $29/month
  29000, -- $290/year (2 months free)
  900, -- $9/month per additional user beyond 10
  NULL, -- Unlimited memories
  10,   -- 10 users included
  1,
  NULL, -- Unlimited AI searches
  '{"slack": true, "extension": true, "export": true, "api": false, "analytics": true, "sso": false}',
  2
),
(
  'business',
  'enterprise',
  'Business',
  'For growing companies',
  9900, -- $99/month
  99000, -- $990/year
  900, -- $9/month per additional user beyond 50
  NULL, -- Unlimited memories
  50,   -- 50 users included
  3, -- 3 workspaces
  NULL, -- Unlimited AI searches
  '{"slack": true, "extension": true, "export": true, "api": true, "analytics": true, "sso": true}',
  3
),
(
  'enterprise',
  'custom',
  'Enterprise',
  'Custom solution for large teams',
  49900, -- $499/month starting
  499000,
  0, -- No per-seat pricing - unlimited users included
  NULL, -- Unlimited memories
  NULL, -- Unlimited users
  NULL, -- Unlimited workspaces
  NULL, -- Unlimited AI searches
  '{"slack": true, "extension": true, "export": true, "api": true, "analytics": true, "sso": true, "onpremise": true, "white_label": true}',
  4
);

-- ============================================
-- 2. SUBSCRIPTIONS TABLE
-- ============================================

CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Possible values: 'active', 'trialing', 'past_due', 'canceled', 'unpaid'

  -- Stripe integration
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100),

  -- Billing details
  billing_cycle VARCHAR(20), -- 'monthly', 'annual'
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT false,

  -- Trial
  trial_start TIMESTAMP,
  trial_end TIMESTAMP,

  -- Grandfathering (for beta users)
  is_grandfathered BOOLEAN DEFAULT false,
  grandfathered_plan VARCHAR(50),
  grandfathered_reason TEXT,
  grandfathered_date TIMESTAMP,

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  canceled_at TIMESTAMP,

  UNIQUE(workspace_id)
);

CREATE INDEX idx_subscriptions_workspace ON subscriptions(workspace_id);
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- ============================================
-- 3. USAGE TRACKING TABLE
-- ============================================

CREATE TABLE usage_tracking (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,

  -- Current counts
  memories_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 1,
  workspaces_count INTEGER DEFAULT 1,

  -- Monthly usage (resets each billing period)
  ai_searches_this_month INTEGER DEFAULT 0,
  api_calls_this_month INTEGER DEFAULT 0,

  -- Billing period tracking
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,

  -- Audit
  last_updated TIMESTAMP DEFAULT NOW(),

  UNIQUE(workspace_id)
);

CREATE INDEX idx_usage_workspace ON usage_tracking(workspace_id);

-- ============================================
-- 4. INVOICES TABLE
-- ============================================

CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  subscription_id INTEGER REFERENCES subscriptions(id),

  -- Stripe data
  stripe_invoice_id VARCHAR(100) UNIQUE,
  stripe_invoice_number VARCHAR(100),

  -- Amount
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',

  -- Status
  status VARCHAR(20) NOT NULL,
  -- Possible values: 'draft', 'open', 'paid', 'void', 'uncollectible'

  -- URLs
  invoice_pdf_url TEXT,
  hosted_invoice_url TEXT,

  -- Period
  period_start TIMESTAMP,
  period_end TIMESTAMP,

  -- Dates
  created_at TIMESTAMP DEFAULT NOW(),
  due_date TIMESTAMP,
  paid_at TIMESTAMP
);

CREATE INDEX idx_invoices_workspace ON invoices(workspace_id);
CREATE INDEX idx_invoices_stripe_id ON invoices(stripe_invoice_id);

-- ============================================
-- 5. BILLING EVENTS LOG
-- ============================================

CREATE TABLE billing_events (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  -- Examples: 'plan_changed', 'subscription_created', 'payment_succeeded',
  --           'payment_failed', 'limit_reached', 'trial_started'

  event_data JSONB,

  stripe_event_id VARCHAR(100),

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_billing_events_workspace ON billing_events(workspace_id);
CREATE INDEX idx_billing_events_type ON billing_events(event_type);
CREATE INDEX idx_billing_events_created ON billing_events(created_at);

-- ============================================
-- 6. INITIALIZE EXISTING WORKSPACES
-- ============================================

-- Give all existing beta workspaces free Team tier
INSERT INTO subscriptions (workspace_id, plan_id, status, is_grandfathered, grandfathered_plan, grandfathered_reason, grandfathered_date)
SELECT DISTINCT
  workspace_id,
  'team' as plan_id,
  'active' as status,
  true as is_grandfathered,
  'team' as grandfathered_plan,
  'Beta user - free Team tier for life' as grandfathered_reason,
  NOW() as grandfathered_date
FROM decisions
WHERE workspace_id IS NOT NULL
ON CONFLICT (workspace_id) DO NOTHING;

-- Initialize usage tracking for existing workspaces
INSERT INTO usage_tracking (workspace_id, memories_count, current_period_start, current_period_end)
SELECT
  workspace_id,
  COUNT(*) as memories_count,
  NOW() as current_period_start,
  NOW() + INTERVAL '1 month' as current_period_end
FROM decisions
WHERE workspace_id IS NOT NULL
GROUP BY workspace_id
ON CONFLICT (workspace_id) DO NOTHING;

-- ============================================
-- 7. HELPER FUNCTIONS
-- ============================================

-- Function to check if workspace can create memory
CREATE OR REPLACE FUNCTION can_create_memory(p_workspace_id VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
  v_limit INTEGER;
  v_current_count INTEGER;
BEGIN
  -- Get memory limit for workspace's plan
  SELECT p.memory_limit INTO v_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.workspace_id = p_workspace_id
    AND s.status = 'active';

  -- NULL limit means unlimited
  IF v_limit IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Get current memory count
  SELECT memories_count INTO v_current_count
  FROM usage_tracking
  WHERE workspace_id = p_workspace_id;

  -- Check if under limit
  RETURN v_current_count < v_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to increment usage
CREATE OR REPLACE FUNCTION increment_usage(
  p_workspace_id VARCHAR,
  p_metric VARCHAR,
  p_amount INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  CASE p_metric
    WHEN 'memories' THEN
      UPDATE usage_tracking
      SET memories_count = memories_count + p_amount,
          last_updated = NOW()
      WHERE workspace_id = p_workspace_id;

    WHEN 'ai_searches' THEN
      UPDATE usage_tracking
      SET ai_searches_this_month = ai_searches_this_month + p_amount,
          last_updated = NOW()
      WHERE workspace_id = p_workspace_id;

    WHEN 'api_calls' THEN
      UPDATE usage_tracking
      SET api_calls_this_month = api_calls_this_month + p_amount,
          last_updated = NOW()
      WHERE workspace_id = p_workspace_id;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to check if AI search is allowed
CREATE OR REPLACE FUNCTION can_use_ai_search(p_workspace_id VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
  v_limit INTEGER;
  v_current_count INTEGER;
BEGIN
  -- Get AI search limit for workspace's plan
  SELECT p.ai_search_limit INTO v_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.workspace_id = p_workspace_id
    AND s.status = 'active';

  -- NULL limit means unlimited AI searches
  IF v_limit IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Get current AI search count for this month
  SELECT ai_searches_this_month INTO v_current_count
  FROM usage_tracking
  WHERE workspace_id = p_workspace_id;

  -- Check if under limit
  RETURN v_current_count < v_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to reset monthly usage (call via cron)
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS VOID AS $$
BEGIN
  UPDATE usage_tracking
  SET ai_searches_this_month = 0,
      api_calls_this_month = 0,
      current_period_start = NOW(),
      current_period_end = NOW() + INTERVAL '1 month',
      last_updated = NOW()
  WHERE current_period_end < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. VERIFICATION QUERIES
-- ============================================

-- Check all plans created
SELECT * FROM plans ORDER BY sort_order;

-- Check all workspaces have subscriptions
SELECT
  COUNT(DISTINCT d.workspace_id) as total_workspaces,
  COUNT(DISTINCT s.workspace_id) as with_subscriptions
FROM decisions d
LEFT JOIN subscriptions s ON d.workspace_id = s.workspace_id;

-- Check grandfathered users
SELECT
  workspace_id,
  plan_id,
  is_grandfathered,
  grandfathered_reason
FROM subscriptions
WHERE is_grandfathered = true;

-- Check usage tracking initialized
SELECT * FROM usage_tracking LIMIT 10;

-- ============================================
-- ROLLBACK (If needed)
-- ============================================

/*
-- Uncomment to rollback (USE WITH CAUTION!)

DROP TABLE IF EXISTS billing_events CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS usage_tracking CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS plans CASCADE;

DROP FUNCTION IF EXISTS can_create_memory(VARCHAR);
DROP FUNCTION IF EXISTS increment_usage(VARCHAR, VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS reset_monthly_usage();
*/

-- ============================================
-- DONE!
-- ============================================

-- Verify everything worked
DO $$
BEGIN
  RAISE NOTICE 'Pricing tables created successfully!';
  RAISE NOTICE 'Plans created: %', (SELECT COUNT(*) FROM plans);
  RAISE NOTICE 'Subscriptions created: %', (SELECT COUNT(*) FROM subscriptions);
  RAISE NOTICE 'Grandfathered users: %', (SELECT COUNT(*) FROM subscriptions WHERE is_grandfathered = true);
END $$;
