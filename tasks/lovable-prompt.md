# Create Lovable Prompt for Corteza.app Updates

Generate comprehensive, well-structured prompts for Lovable to update the Corteza.app landing page with latest backend features and improvements.

## Description
This task analyzes recent backend changes in decision-logger-bot and creates clear, actionable prompts for Lovable to update the frontend landing page, marketing copy, and feature descriptions.

## When to Use
- After major feature releases
- Before beta launches or public announcements
- When backend capabilities change significantly
- After user feedback indicates confusion about features
- When preparing marketing materials
- Quarterly landing page refreshes

## Step 1: Analyze Recent Backend Changes

### Review Git History
```bash
# Check commits since last frontend update
git log --since="2026-01-01" --oneline --no-merges

# Check recent changes to key files
git log --since="2026-01-01" -- src/routes/ src/views/ README.md CHANGELOG.md

# See detailed changes
git log --since="2026-01-01" --stat
```

### Identify Feature Categories

**New Features to Highlight:**
- [ ] Multi-entry point architecture (Slack → Dashboard → API)
- [ ] Dashboard memory logging (log directly from web)
- [ ] API Keys management for integrations
- [ ] Settings page for workspace configuration
- [ ] Expanded memory types (6 types now)
- [ ] Coda Pack integration
- [ ] Enhanced permissions system
- [ ] GDPR compliance tools

**UX Improvements:**
- [ ] Modern dashboard design
- [ ] Simplified authentication flow
- [ ] Better search interface
- [ ] Mobile responsiveness
- [ ] Performance optimizations

**Technical Capabilities:**
- [ ] Claude API optimization (40% cost reduction)
- [ ] Semantic search improvements
- [ ] Multi-workspace OAuth
- [ ] Encrypted settings storage
- [ ] Rate limiting and security

### Extract UI/UX Implications

**For Each Feature, Determine:**
1. Does it need a new section on landing page?
2. Does it replace existing copy?
3. Should it be in hero, features, or pricing section?
4. What screenshots/demos would help?
5. What user pain point does it solve?

## Step 2: Review Current Landing Page

### Audit Existing Content
- [ ] Check corteza.app current state
- [ ] Identify outdated claims or descriptions
- [ ] Find sections that need updating
- [ ] Note any broken features or links
- [ ] Check for inconsistent branding

### Compare with Backend Reality
- [ ] Features listed vs features actually available
- [ ] Screenshots accuracy
- [ ] Pricing information accuracy
- [ ] Integration claims accuracy
- [ ] Performance claims accuracy

## Step 3: Generate Lovable Prompt

### Prompt Structure Template

```markdown
# Corteza.app Landing Page Update - [Feature Name]

## Context
Corteza is a team memory platform that helps teams capture and search decisions, explanations, and context from meetings. We've recently added [feature] which significantly improves [user benefit].

**Current landing page state:**
[Describe what's currently shown - e.g., "Hero section only mentions Slack as entry point"]

**What needs to change:**
[Be specific - e.g., "Update hero to highlight multi-channel input (Slack, Dashboard, API)"]

---

## Requirements

### User Story
As a [user type], I want to [action] so that [benefit].

**Example:**
As a product manager, I want to log team decisions directly from the dashboard (not just Slack) so that I can capture decisions during web meetings without switching tools.

### Functionality
1. [Specific feature to implement or update]
2. [Another feature]
3. [Edge case or variation]

### Expected Behavior
- When user [action], they should see [result]
- If [condition], then [outcome]
- Error states: [describe]

---

## Technical Specifications

### API Endpoints Changed
**New Endpoint:** `POST /api/memory/create`
```json
// Request
{
  "text": "We decided to use PostgreSQL for the main database",
  "type": "decision",
  "category": "technical",
  "tags": ["database", "architecture"],
  "source": "dashboard"
}

// Response
{
  "success": true,
  "memory": {
    "id": 123,
    "text": "...",
    "timestamp": "2026-02-06T10:00:00Z"
  }
}
```

### Data Model Changes
- Added `source` field to track entry point (slack | dashboard | api)
- Expanded `type` field to include 6 types: decision, explanation, context, learning, risk, assumption
- Added `category` field: product, ux, technical

### Integration Points
- Dashboard now has "Log Team Memory" button in hero section
- Settings page at `/settings` for API keys and GDPR tools
- API key authentication for third-party integrations (Coda, Zapier)

---

## UI/UX Guidelines

### Design Requirements
**Visual Style:**
- Pure black primary color (#000000)
- Dark gray for hovers (#2D2D2D)
- Modern, bold typography
- Glassmorphism effects for cards
- Gradient accents sparingly

**Component Updates:**
- Hero section: Add "Multiple Entry Points" visual (Slack icon + Web icon + API icon → Corteza logo)
- Features section: Add new feature card for "Log from Anywhere"
- Screenshots: Update dashboard screenshot to show "Log Team Memory" button

### User Flow
1. User lands on homepage
2. Sees hero highlighting "Centralized team memory across Slack, Dashboard, and API"
3. Scrolls to features section
4. Sees visual comparison: "Before (Slack only) → After (Multiple channels)"
5. Clicks "Get Started" → Sign up flow

### Loading & Error States
- **Loading:** Show skeleton loader for feature cards
- **Error:** "Failed to load pricing info" with retry button
- **Empty state:** Not applicable for landing page

### Responsive Design
- Mobile: Stack feature cards vertically
- Tablet: 2-column grid
- Desktop: 3-column grid
- Hero image: Hide on mobile, show on tablet+

---

## Acceptance Criteria

### Must Have ✅
- [ ] Hero section mentions multi-entry point architecture
- [ ] Features section includes new "Log from Anywhere" feature card
- [ ] Screenshot shows updated dashboard with memory logging
- [ ] Copy mentions 6 memory types (not just 3)
- [ ] API integration capabilities are highlighted
- [ ] Mobile responsive layout works properly

### Nice to Have 💡
- [ ] Animated diagram showing data flow (Slack/Dashboard/API → Corteza → Search)
- [ ] Customer testimonial mentioning dashboard logging
- [ ] Comparison table: Corteza vs competitors showing multi-channel support
- [ ] Interactive demo of memory logging

### Test Scenarios
1. **Desktop user on homepage**
   - Should see clear messaging about multiple entry points
   - Should understand they can use Slack OR dashboard OR API
   - CTA should be prominent and clear

2. **Mobile user scrolling features**
   - All feature cards should be readable
   - Images should load quickly
   - CTA buttons should be tappable (44px min)

3. **User clicking "See Integrations"**
   - Should see Slack, Coda, API listed
   - Each should have brief description
   - Should link to relevant docs

---

## Copy Guidelines

### Tone & Voice
- **Conversational:** Write like you're explaining to a teammate
- **Specific:** Use concrete examples, not vague claims
- **Benefit-focused:** Lead with user value, not technical features
- **Authentic:** No corporate jargon or AI-generated fluff

### Examples

❌ **Bad (vague, jargon-heavy):**
"Leverage our multi-modal intake solution to synergize cross-functional decision capture across your organization's communication channels."

✅ **Good (clear, specific):**
"Log team decisions from Slack, your dashboard, or via API. Your team's memory, centralized in one searchable place."

❌ **Bad (feature-focused):**
"Corteza now supports 6 different memory types with advanced categorization."

✅ **Good (benefit-focused):**
"Capture not just decisions, but the explanations, context, and learnings that matter. Search them all in one place."

### Key Messaging
**Hero Headline Options:**
1. "Your team's memory. Centralized, searchable, always accessible."
2. "Stop losing decisions in Slack threads. Start building team knowledge."
3. "Capture decisions from Slack, Dashboard, or API. Search them in seconds."

**Feature Headlines:**
- "Log from anywhere" (not "Multi-modal intake")
- "Search like you think" (not "Advanced semantic search")
- "Your data, your control" (not "GDPR-compliant data management")

---

## Visual Assets Needed

### Screenshots to Update
1. **Dashboard hero image**
   - Show "Log Team Memory" button prominently
   - Display recent memories list
   - Show search interface

2. **Settings page**
   - API Keys section
   - Data Privacy section
   - Clean, modern UI

3. **Slack integration**
   - `/memory` command in action
   - Decision modal
   - Bot response

### Diagrams/Illustrations
1. **Multi-entry point flow**
   ```
   [Slack icon]  ────┐
   [Web icon]    ────┼──→ [Corteza] ──→ [Magnifying glass]
   [API icon]    ────┘
   ```

2. **Memory types visual**
   - 6 colored cards showing: Decision, Explanation, Context, Learning, Risk, Assumption
   - Each with icon and brief description

3. **Before/After comparison**
   - Before: "Decisions lost in Slack" (messy thread visual)
   - After: "Decisions organized and searchable" (clean dashboard)

### Brand Assets
- Color palette: Black (#000000), Dark Gray (#2D2D2D), Accent colors
- Logo variations (light/dark backgrounds)
- Icon set for memory types
- Custom illustrations vs stock photos

---

## SEO Considerations

### Meta Updates
```html
<title>Corteza - Team Memory & Decision Tracking | Slack + Dashboard + API</title>
<meta name="description" content="Capture team decisions from Slack, dashboard, or API. AI-powered search finds decisions in seconds. Free during beta.">
<meta name="keywords" content="team decisions, decision tracking, slack bot, team memory, knowledge management, semantic search">
```

### Content Keywords to Include
- "team memory platform"
- "decision tracking"
- "multi-channel logging"
- "semantic search"
- "Slack integration"
- "API integration"
- "knowledge management"

### Structured Data
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Corteza",
  "applicationCategory": "BusinessApplication",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  }
}
```

---

## Conversion Optimization

### CTAs to Update
**Primary CTA:** "Start Free Beta" (not "Sign Up")
- Button color: Black (#000000)
- Hover state: Dark gray (#2D2D2D)
- Position: Hero, above fold + end of features section

**Secondary CTAs:**
- "See How It Works" → Demo video
- "Read Documentation" → Beta guide
- "View Integrations" → Coda, Zapier, API docs

### Social Proof
- "Used by [X] teams in beta"
- Customer testimonials (if available)
- "Built with Claude AI" badge
- "Free during beta" callout

### Trust Signals
- GDPR compliant badge
- "Your data stays yours" messaging
- Security features highlighted
- Open source badge (if applicable)

---

## Implementation Checklist

### Pre-Lovable Preparation
- [ ] Screenshots taken and compressed
- [ ] Copy written and reviewed
- [ ] Brand assets ready (logos, icons)
- [ ] API documentation updated
- [ ] Feature demos recorded (if needed)

### Lovable Prompt Sections
- [ ] Context clearly explains current state
- [ ] Requirements list specific functionality
- [ ] Technical specs include real API examples
- [ ] UI/UX guidelines are detailed and visual
- [ ] Acceptance criteria are testable
- [ ] Copy examples are concrete and authentic

### Post-Lovable Review
- [ ] Visual review: Does it match brand?
- [ ] Content review: Is copy accurate and clear?
- [ ] Technical review: Do links and integrations work?
- [ ] Mobile review: Does it work on all devices?
- [ ] SEO review: Are meta tags and keywords updated?
- [ ] Analytics review: Are tracking events firing?

---

## Example Lovable Prompts

### Example 1: Multi-Entry Point Feature

```markdown
# Update Corteza.app Hero Section - Multi-Entry Point Architecture

## Context
Corteza has evolved from a Slack-only decision logger to a multi-channel team memory platform. Users can now log decisions from:
1. Slack (existing, via `/memory` command)
2. Dashboard (NEW - direct web form)
3. API (NEW - for Coda, Zapier, custom integrations)

Currently, the landing page only mentions Slack integration. This undersells our capabilities and confuses users who want to log decisions during web meetings or from other tools.

## Requirements

### Update Hero Section
Replace:
"Slack bot that captures team decisions from meetings"

With:
"Team memory platform that captures decisions from Slack, your dashboard, or any tool via API"

### Add Visual Diagram
Create a simple icon flow in hero section:
[Slack icon] + [Web/Dashboard icon] + [API/Puzzle icon] → [Corteza logo] → [Search/Magnifying glass]

### Update Feature Cards
Add new feature card in features section:

**Title:** "Log from Anywhere"

**Description:**
"Your team works in multiple places. Log decisions directly from Slack with `/memory`, from your web dashboard during video calls, or programmatically via our API from Coda, Zapier, or custom integrations."

**Visual:**
Screenshot showing dashboard with "Log Team Memory" button highlighted + Slack command side-by-side

## Technical Specifications

### New Dashboard Endpoint
Users can now POST to `/api/memory/create` from the dashboard:

```javascript
const response = await fetch('/api/memory/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'We decided to use PostgreSQL',
    type: 'decision',
    category: 'technical',
    source: 'dashboard'
  })
});
```

### Source Tracking
All memories now include a `source` field:
- `slack` - Created via Slack command
- `dashboard` - Created via web form
- `api` - Created via API integration

This data can be shown in analytics later.

## UI/UX Guidelines

### Hero Layout
```
+--------------------------------------------------+
|  [Logo]                            [Start Beta]  |
|                                                  |
|     Your team's memory. Centralized,            |
|       searchable, always accessible.            |
|                                                  |
|  Log from Slack, Dashboard, or API →            |
|  Search in seconds with AI                      |
|                                                  |
|  [Slack] [Web] [API] → [Corteza] → [Search]    |
|                                                  |
|        [Start Free Beta]  [See Demo]            |
+--------------------------------------------------+
```

### Visual Style
- Icons: Use simple, recognizable icons (Slack logo, browser/window for web, puzzle piece for API)
- Arrow: Single-line arrow (→) in dark gray
- Spacing: Generous whitespace between sections
- Typography: Hero headline 48px bold, subheading 20px regular

### Mobile Adaptation
- Stack icons vertically on mobile
- Reduce headline to 32px
- Hide diagram on very small screens (<375px)

## Acceptance Criteria

- [ ] Hero mentions all three entry points (Slack, Dashboard, API)
- [ ] Visual diagram shows flow clearly
- [ ] Feature card "Log from Anywhere" exists with correct copy
- [ ] Dashboard screenshot shows "Log Team Memory" button
- [ ] Copy is conversational and benefit-focused (no jargon)
- [ ] Mobile layout works on iPhone SE (375px width)
- [ ] All links work and point to correct pages

## Test Scenarios

1. **New visitor lands on homepage**
   - Should immediately understand they can use Slack OR web OR API
   - Should see visual representation of multi-channel input
   - Should feel confident Corteza fits their workflow

2. **Existing Slack-only user visits page**
   - Should learn about new dashboard capability
   - Should understand they can now log during web meetings
   - Should see clear screenshots showing how

3. **Technical user interested in API**
   - Should see API mentioned prominently
   - Should find link to API documentation
   - Should understand integration possibilities (Coda, Zapier)
```

### Example 2: API Keys Feature

```markdown
# Add API Integration Section to Corteza.app

## Context
Corteza now supports API key authentication for third-party integrations. We've built a Coda Pack (live in Coda gallery) and users can integrate via Zapier, Make, n8n, or custom tools.

Currently, the landing page doesn't mention API capabilities at all. Technical users don't know they can integrate Corteza with their existing workflows.

## Requirements

### New Section: "Integrate with Your Tools"
Add section after "Features" and before "Pricing"

**Headline:** "Works with the tools you already use"

**Description:**
"Use Corteza's API to connect with Coda, Zapier, Make, or build custom integrations. Your team's memory, accessible from anywhere."

**Integration Cards:**
- Coda (with Coda logo)
- Zapier (with Zapier logo)
- Make (with Make logo)
- API (with code/terminal icon)

### Settings Page Call-out
In features section, add note:
"Generate API keys from your settings page. Each key is scoped to your workspace with full audit trail."

## Technical Specifications

### API Key Flow
```javascript
// 1. User generates key from dashboard settings
POST /api/keys/generate
Response: { api_key: "corteza_abc123..." }

// 2. User uses key in integration (e.g., Coda)
GET /api/v1/decisions/123
Headers: { Authorization: "Bearer corteza_abc123..." }
```

### Security Features
- API keys are workspace-scoped (can only access own data)
- Keys can be revoked anytime from settings
- Last used timestamp tracked
- Rate limited (100 requests/hour per key)

## UI/UX Guidelines

### Integration Cards Layout
```
+------------------+  +------------------+  +------------------+
|  [Coda Logo]     |  | [Zapier Logo]    |  | [Make Logo]      |
|                  |  |                  |  |                  |
|  Coda Pack       |  | Zapier           |  | Make             |
|  Access decisions|  | Automate         |  | Connect your     |
|  in your docs    |  | decision logging |  | workflows        |
|                  |  |                  |  |                  |
|  [View Pack]     |  | [See Zap]        |  | [Get Started]    |
+------------------+  +------------------+  +------------------+

+------------------+
|  [Code Icon]     |
|                  |
|  Custom API      |
|  Build your own  |
|  integrations    |
|                  |
|  [API Docs]      |
+------------------+
```

### Visual Style
- Card background: White with subtle shadow
- Logo size: 64px height, maintain aspect ratio
- Padding: 24px all around
- Border radius: 12px
- Hover: Lift effect (translateY(-4px) + stronger shadow)

## Acceptance Criteria

- [ ] "Integrate with Your Tools" section exists
- [ ] 4 integration cards showing (Coda, Zapier, Make, API)
- [ ] Each card has logo, title, description, CTA
- [ ] Links work: Coda Pack, Zapier template, Make template, API docs
- [ ] Settings page screenshot shows API key management
- [ ] Copy emphasizes ease of integration
- [ ] Mobile: Cards stack vertically

## Test Scenarios

1. **Coda user visits landing page**
   - Sees Coda logo prominently
   - Clicks "View Pack" → Opens Coda gallery (new tab)
   - Understands Corteza works with Coda

2. **Developer interested in API**
   - Finds "Custom API" card
   - Clicks "API Docs" → Opens API documentation
   - Sees example code and authentication flow

3. **Non-technical user**
   - Understands integrations exist
   - Doesn't feel overwhelmed by technical details
   - Can easily skip section if not relevant
```

---

## Output Validation

### Prompt Quality Checklist

#### Clarity
- [ ] No ambiguous requirements ("make it better", "improve design")
- [ ] Specific measurements provided (padding, font sizes, colors)
- [ ] Concrete examples included (good vs bad copy)
- [ ] Visual mockups or descriptions provided

#### Completeness
- [ ] Context explains current state and desired state
- [ ] All technical specs included (APIs, data models)
- [ ] UI/UX guidelines cover layout, colors, typography
- [ ] Acceptance criteria are testable
- [ ] Edge cases considered

#### Actionability
- [ ] Lovable can implement without asking clarifying questions
- [ ] All required assets listed (screenshots, logos, icons)
- [ ] External dependencies identified (APIs, third-party services)
- [ ] Success metrics clear

#### Authenticity
- [ ] Copy examples sound like real human writing
- [ ] No corporate jargon or buzzwords
- [ ] Benefit-focused, not feature-focused
- [ ] Conversational tone maintained

### Common Mistakes to Avoid

❌ **Too vague:**
"Update the hero section to be more engaging"

✅ **Specific:**
"Replace hero headline with 'Your team's memory, centralized and searchable' and add visual diagram showing Slack + Dashboard + API → Corteza"

❌ **Missing context:**
"Add API integration section"

✅ **With context:**
"We recently added API key authentication (see /api/keys endpoint). Landing page doesn't mention this capability. Add 'Integrations' section showing Coda, Zapier, API with cards and CTAs."

❌ **No acceptance criteria:**
"Make the features section better"

✅ **Clear criteria:**
"Features section must include: 6 feature cards, each with icon, title, 2-sentence description, screenshot. Must be responsive (3 cols desktop, 2 tablet, 1 mobile)."

---

## Notes

- **Frequency**: Run after each major feature release or monthly
- **Time Estimate**: 1-2 hours to create comprehensive prompt
- **Collaboration**: Review with product/marketing before sending to Lovable
- **Iteration**: Lovable may need 2-3 rounds of refinement
- **Documentation**: Save prompts for future reference

## Related Tasks

- `tasks/update-docs.md` - Ensure docs match landing page claims
- `CHANGELOG.md` - Reference recent changes
- `README.md` - Technical features to highlight

## Tools & Resources

- **Lovable**: https://lovable.dev
- **Screenshot tools**: CloudApp, Monosnap, CleanShot X
- **Diagrams**: Excalidraw, Figma, Mermaid
- **Copy review**: Hemingway App, Grammarly
- **SEO**: Ahrefs, Google Search Console

---

**Landing pages are the first impression. Make it count!**
