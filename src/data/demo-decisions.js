/**
 * Demo workspace seed data
 * Realistic SaaS product team decisions, explanations, and context.
 * Used for the "Try Demo" experience — no Slack or auth required.
 *
 * Fictional company: Clearpath — a B2B SaaS project management tool.
 * Team: Product, UX, and Growth working on core user-facing flows.
 */

const DEMO_WORKSPACE_ID = 'demo_workspace';
const DEMO_WORKSPACE_NAME = 'Clearpath (Demo)';

const now = new Date();
function daysAgo(n) {
  return new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
}

const DEMO_DECISIONS = [
  // ── ONBOARDING PROJECT ──────────────────────────────────────────────────────

  {
    id: 1,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We will add a 3-step interactive checklist to the onboarding flow instead of a product tour video. Users were skipping the video and never completing setup.',
    type: 'decision',
    category: 'product',
    tags: ['onboarding', 'activation', 'checklist'],
    alternatives: 'We considered keeping the video tour and adding subtitles, or using a chatbot-style walkthrough. The checklist won because it lets users go at their own pace and gives a clear sense of progress.',
    creator: 'Sarah Chen',
    user_id: 'demo_sarah',
    channel_id: 'demo_product',
    timestamp: daysAgo(45),
    source: 'slack',
    epic_key: 'OB-12'
  },
  {
    id: 2,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'The onboarding checklist will have exactly 3 steps: (1) Create your first project, (2) Invite a teammate, (3) Set a due date. We deliberately kept it minimal — fewer steps = higher completion rate.',
    type: 'explanation',
    category: 'product',
    tags: ['onboarding', 'checklist', 'activation'],
    alternatives: null,
    creator: 'Sarah Chen',
    user_id: 'demo_sarah',
    channel_id: 'demo_product',
    timestamp: daysAgo(44),
    source: 'slack',
    epic_key: 'OB-12'
  },
  {
    id: 3,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Our current activation rate (users who complete at least 1 meaningful action in first session) is 34%. Industry benchmark for B2B SaaS is 45–60%. This is the primary motivation for the onboarding redesign.',
    type: 'context',
    category: 'product',
    tags: ['onboarding', 'metrics', 'activation'],
    alternatives: null,
    creator: 'Marcus Rivera',
    user_id: 'demo_marcus',
    channel_id: 'demo_product',
    timestamp: daysAgo(46),
    source: 'dashboard',
    epic_key: 'OB-12'
  },
  {
    id: 4,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We will send a single follow-up email 24 hours after signup if the user has not completed the onboarding checklist. We will NOT send a sequence — one well-timed nudge outperforms a drip in our A/B test data.',
    type: 'decision',
    category: 'product',
    tags: ['onboarding', 'email', 'activation', 'ab-test'],
    alternatives: 'Considered a 3-email drip (day 1, 3, 7). A/B test run in Q3 showed single email at 24h had 2x the click-through rate of the drip sequence.',
    creator: 'Priya Nair',
    user_id: 'demo_priya',
    channel_id: 'demo_growth',
    timestamp: daysAgo(30),
    source: 'slack',
    epic_key: 'OB-15'
  },
  {
    id: 5,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'The "invite a teammate" step in onboarding will be optional, not required. We removed the gate after data showed 60% of signups are individual users evaluating solo before buying team seats.',
    type: 'decision',
    category: 'ux',
    tags: ['onboarding', 'invite', 'friction'],
    alternatives: 'Originally the invite step was mandatory. Removed the gate in v2 after Hotjar recordings showed users abandoning at that step.',
    creator: 'Lena Park',
    user_id: 'demo_lena',
    channel_id: 'demo_design',
    timestamp: daysAgo(28),
    source: 'slack',
    epic_key: 'OB-12'
  },

  // ── CHECKOUT / CONVERSION PROJECT ───────────────────────────────────────────

  {
    id: 6,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We will switch the upgrade flow from a full-page redirect to an in-app modal. The redirect was causing a 40% drop-off because users lost their current context.',
    type: 'decision',
    category: 'ux',
    tags: ['checkout', 'upgrade', 'conversion', 'modal'],
    alternatives: 'Option A: Keep full-page redirect but improve the page design. Option B: In-app modal (chosen). Option C: Side panel drawer. Modal won based on Figma prototype testing — users felt less "interrupted".',
    creator: 'Lena Park',
    user_id: 'demo_lena',
    channel_id: 'demo_design',
    timestamp: daysAgo(60),
    source: 'slack',
    epic_key: 'CX-8'
  },
  {
    id: 7,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Pricing page will show monthly pricing by default, with an annual toggle. The toggle will show "Save 20%" as the label — not "Annual." This framing increased toggle engagement by 18% in our test.',
    type: 'decision',
    category: 'product',
    tags: ['pricing', 'checkout', 'conversion', 'copywriting'],
    alternatives: 'Tested "Annual" vs "Save 20%" label on the toggle. "Save 20%" had significantly higher click rate.',
    creator: 'Marcus Rivera',
    user_id: 'demo_marcus',
    channel_id: 'demo_growth',
    timestamp: daysAgo(55),
    source: 'slack',
    epic_key: 'CX-9'
  },
  {
    id: 8,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We do not show competitor comparisons on our pricing page. This is a deliberate positioning choice — we want to anchor on our value, not on others. This may be revisited if we enter a more commoditized market.',
    type: 'context',
    category: 'product',
    tags: ['pricing', 'positioning', 'competitors'],
    alternatives: null,
    creator: 'Sarah Chen',
    user_id: 'demo_sarah',
    channel_id: 'demo_product',
    timestamp: daysAgo(90),
    source: 'dashboard',
    epic_key: null
  },
  {
    id: 9,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Checkout will collect billing address only for customers in the EU (required for VAT). US and other non-EU customers skip the billing address step entirely to reduce checkout friction.',
    type: 'explanation',
    category: 'product',
    tags: ['checkout', 'billing', 'eu', 'vat', 'friction'],
    alternatives: null,
    creator: 'Tom Okafor',
    user_id: 'demo_tom',
    channel_id: 'demo_engineering',
    timestamp: daysAgo(40),
    source: 'slack',
    epic_key: 'CX-10'
  },
  {
    id: 10,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We will add a "money-back guarantee" badge to the checkout page. Legal confirmed 30 days is our actual policy. Adding visible trust signals at checkout reduced cart abandonment by 12% in Stripe benchmark data.',
    type: 'decision',
    category: 'ux',
    tags: ['checkout', 'trust', 'conversion', 'guarantee'],
    alternatives: 'Considered adding customer logos or a testimonial instead. Chose guarantee badge because it directly addresses purchase anxiety at the moment of decision.',
    creator: 'Priya Nair',
    user_id: 'demo_priya',
    channel_id: 'demo_growth',
    timestamp: daysAgo(22),
    source: 'slack',
    epic_key: 'CX-8'
  },

  // ── NOTIFICATIONS / RETENTION ────────────────────────────────────────────────

  {
    id: 11,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We will not send daily email digests by default. Users can opt in. Data showed that daily emails from tools like ours generate high unsubscribe rates. Weekly digest is the default cadence.',
    type: 'decision',
    category: 'product',
    tags: ['notifications', 'email', 'retention', 'digest'],
    alternatives: 'Daily digest was the original plan. Surveyed 50 users — 72% said they would unsubscribe from daily emails. Weekly won.',
    creator: 'Priya Nair',
    user_id: 'demo_priya',
    channel_id: 'demo_growth',
    timestamp: daysAgo(35),
    source: 'slack',
    epic_key: null
  },
  {
    id: 12,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'In-app notifications use a bell icon in the top nav, not a floating badge overlay. The overlay pattern was rejected because it obscured content and tested poorly with users who have ADHD (accessibility feedback from beta group).',
    type: 'explanation',
    category: 'ux',
    tags: ['notifications', 'accessibility', 'design-system'],
    alternatives: null,
    creator: 'Lena Park',
    user_id: 'demo_lena',
    channel_id: 'demo_design',
    timestamp: daysAgo(50),
    source: 'slack',
    epic_key: null
  },

  // ── MOBILE ───────────────────────────────────────────────────────────────────

  {
    id: 13,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We are not building a native mobile app in 2025. Mobile traffic accounts for 8% of sessions and the core workflow (project management, planning) is inherently desktop-first. We will revisit in 2026.',
    type: 'decision',
    category: 'product',
    tags: ['mobile', 'roadmap', '2025'],
    alternatives: 'React Native app was scoped and estimated at 6 months of engineering. Not worth the investment given current usage data.',
    creator: 'Sarah Chen',
    user_id: 'demo_sarah',
    channel_id: 'demo_product',
    timestamp: daysAgo(80),
    source: 'dashboard',
    epic_key: null
  },
  {
    id: 14,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Our responsive web design must work on tablets (768px+). We explicitly exclude mobile phones (<768px) from our support matrix given the 8% usage stat. This prevents over-engineering the mobile layout.',
    type: 'context',
    category: 'technical',
    tags: ['mobile', 'responsive', 'design-system', 'breakpoints'],
    alternatives: null,
    creator: 'Tom Okafor',
    user_id: 'demo_tom',
    channel_id: 'demo_engineering',
    timestamp: daysAgo(78),
    source: 'slack',
    epic_key: null
  },

  // ── SEARCH / NAVIGATION ──────────────────────────────────────────────────────

  {
    id: 15,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Global search (Cmd+K) will be the primary navigation pattern. We are removing the left-sidebar nav links for Projects, Tasks, and Members — they will only be accessible via search or the top nav. This simplifies the interface significantly.',
    type: 'decision',
    category: 'ux',
    tags: ['navigation', 'search', 'cmd-k', 'simplification'],
    alternatives: 'Option A: Keep sidebar. Option B: Move sidebar to top nav bar. Option C: Remove sidebar, go full cmd-k (chosen). Tested Option C with 10 users — 9/10 found it faster after 5 minutes of use.',
    creator: 'Lena Park',
    user_id: 'demo_lena',
    channel_id: 'demo_design',
    timestamp: daysAgo(20),
    source: 'slack',
    epic_key: 'NAV-3'
  },
  {
    id: 16,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Search indexes project names, task titles, assignees, and tags. It does NOT index task description body text — that was a performance decision (too much data to index for acceptable search speed on our current infrastructure).',
    type: 'explanation',
    category: 'technical',
    tags: ['search', 'indexing', 'performance'],
    alternatives: null,
    creator: 'Tom Okafor',
    user_id: 'demo_tom',
    channel_id: 'demo_engineering',
    timestamp: daysAgo(18),
    source: 'slack',
    epic_key: 'NAV-3'
  },

  // ── TEAM / PERMISSIONS ───────────────────────────────────────────────────────

  {
    id: 17,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Guest users can view projects and comment on tasks but cannot create or delete anything. This permission level exists for clients who need visibility without edit access.',
    type: 'explanation',
    category: 'product',
    tags: ['permissions', 'guests', 'clients'],
    alternatives: null,
    creator: 'Sarah Chen',
    user_id: 'demo_sarah',
    channel_id: 'demo_product',
    timestamp: daysAgo(65),
    source: 'slack',
    epic_key: 'TEAM-5'
  },
  {
    id: 18,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We will not charge per-seat for Guest users. Guests are a retention feature — they bring clients into the tool, which makes teams stickier. Charging for guests creates friction at the moment of sharing.',
    type: 'decision',
    category: 'product',
    tags: ['pricing', 'guests', 'retention', 'seats'],
    alternatives: 'Competitors like Asana charge per guest. We decided against it based on win/loss interview feedback where teams said free guest access was a reason they chose competitors over us in the past.',
    creator: 'Marcus Rivera',
    user_id: 'demo_marcus',
    channel_id: 'demo_product',
    timestamp: daysAgo(64),
    source: 'slack',
    epic_key: 'TEAM-5'
  },

  // ── INTEGRATIONS ─────────────────────────────────────────────────────────────

  {
    id: 19,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We will build the Slack integration before the Microsoft Teams integration, despite Teams having slightly more enterprise users. Our current customer base skews toward startup/scale-up companies where Slack adoption is near 100%.',
    type: 'decision',
    category: 'product',
    tags: ['integrations', 'slack', 'teams', 'roadmap'],
    alternatives: 'Teams integration was requested by 3 enterprise prospects. Slack integration was requested by 47 existing customers. Prioritized by volume and ICP fit.',
    creator: 'Sarah Chen',
    user_id: 'demo_sarah',
    channel_id: 'demo_product',
    timestamp: daysAgo(100),
    source: 'dashboard',
    epic_key: 'INT-2'
  },
  {
    id: 20,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Zapier integration is available on the Pro plan and above. We do not offer it on the Starter plan. Zapier usage is a strong signal of power users who get more value — this aligns the feature with plans where we can justify the margin.',
    type: 'explanation',
    category: 'product',
    tags: ['integrations', 'zapier', 'pricing', 'plan-gating'],
    alternatives: null,
    creator: 'Marcus Rivera',
    user_id: 'demo_marcus',
    channel_id: 'demo_product',
    timestamp: daysAgo(70),
    source: 'slack',
    epic_key: null
  },

  // ── BRAND / COPY ─────────────────────────────────────────────────────────────

  {
    id: 21,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We use "workspace" not "organization" in all UI copy and documentation. "Organization" tested as too corporate for our target users (startup/scale-up teams). "Workspace" feels collaborative and modern.',
    type: 'decision',
    category: 'ux',
    tags: ['copy', 'terminology', 'brand'],
    alternatives: 'Tested "organization," "team," "account," and "workspace" in 5-second tests. "Workspace" had the highest comprehension score and most positive sentiment.',
    creator: 'Lena Park',
    user_id: 'demo_lena',
    channel_id: 'demo_design',
    timestamp: daysAgo(120),
    source: 'dashboard',
    epic_key: null
  },
  {
    id: 22,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Error messages must always tell users what to do next, not just what went wrong. "Something went wrong" is banned from our UI. Every error state has a specific action (retry, contact support, check your connection, etc.).',
    type: 'context',
    category: 'ux',
    tags: ['copy', 'errors', 'design-system', 'ux-writing'],
    alternatives: null,
    creator: 'Lena Park',
    user_id: 'demo_lena',
    channel_id: 'demo_design',
    timestamp: daysAgo(110),
    source: 'dashboard',
    epic_key: null
  },

  // ── RECENT ───────────────────────────────────────────────────────────────────

  {
    id: 23,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'We will add an in-app NPS survey triggered at day 30 for active users (users who have logged in at least 5 times). Passive users will not see the survey — their low engagement would skew results.',
    type: 'decision',
    category: 'product',
    tags: ['nps', 'survey', 'retention', 'analytics'],
    alternatives: 'Considered triggering at day 14 (too early — users are still learning the product) and at day 60 (too late — churned users never see it). Day 30 with the activity filter is the best signal.',
    creator: 'Priya Nair',
    user_id: 'demo_priya',
    channel_id: 'demo_growth',
    timestamp: daysAgo(10),
    source: 'slack',
    epic_key: null
  },
  {
    id: 24,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'The dashboard home page will show "Recently updated projects" by default, not "All projects." Teams with 50+ projects said the all-projects view was overwhelming and made them feel behind.',
    type: 'decision',
    category: 'ux',
    tags: ['dashboard', 'navigation', 'home', 'information-architecture'],
    alternatives: 'Options tested: All projects, Recently updated (chosen), Pinned projects, Projects by status. "Recently updated" tested best because it shows momentum without requiring any manual curation.',
    creator: 'Lena Park',
    user_id: 'demo_lena',
    channel_id: 'demo_design',
    timestamp: daysAgo(7),
    source: 'slack',
    epic_key: 'NAV-4'
  },
  {
    id: 25,
    workspace_id: DEMO_WORKSPACE_ID,
    text: 'Free plan will be limited to 3 active projects and 5 team members. These limits were chosen based on cohort analysis: teams exceeding either limit converted to paid within 30 days at an 80%+ rate.',
    type: 'context',
    category: 'product',
    tags: ['pricing', 'free-plan', 'limits', 'conversion'],
    alternatives: null,
    creator: 'Marcus Rivera',
    user_id: 'demo_marcus',
    channel_id: 'demo_product',
    timestamp: daysAgo(3),
    source: 'dashboard',
    epic_key: null
  }
];

module.exports = {
  DEMO_WORKSPACE_ID,
  DEMO_WORKSPACE_NAME,
  DEMO_DECISIONS
};
