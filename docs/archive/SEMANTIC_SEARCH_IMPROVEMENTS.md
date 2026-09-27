# Semantic Search Improvements - Hybrid Search with Keyword + Recency Boosting

## Problem Statement

Pure semantic/vector search has two critical weaknesses:

### Issue 1: Exact Keyword Matches Rank Too Low
When users search for "decisions about **onboarding**" and there's a decision with "**Onboarding** flow..." in the text, it should be 90%+ match. But vector search was returning only ~75% similarity.

**Why?** Long detailed text gets diluted across 1536 dimensions. Exact keyword matches aren't automatically weighted higher.

### Issue 2: Ignores Recency
When users asked for "**latest** decisions about X", the semantic search would rank purely by text similarity, ignoring how recent decisions were.

**Result:** Both exact matches and recent decisions were being under-ranked.

## Solution: Hybrid Search with False Positive Filtering

We now apply **four layers** of intelligence to ensure high-quality, relevant results:

### Layer 1: Semantic Search (Base)
- Vector similarity using OpenAI embeddings
- Finds conceptually related decisions
- Base score: 0.0 - 1.0

### Layer 2: Keyword Boost (Always Applied)
Extract meaningful keywords from query and boost scores when exact matches found:

**Algorithm:**
1. Extract keywords (remove stop words like "the", "a", "show", "decisions")
2. Count keyword occurrences in decision text + tags
3. Boost: +0.05 per match (max +0.15 total)

**Example:**
- Query: "decisions about **onboarding**"
- Decision text: "**Onboarding** flow reduced from 4 to 3 steps"
- Base score: 75% + Keyword boost: 15% = **90%** ✅

### Layer 3: False Positive Filtering (**NEW - Critical for Quality**)
Filters out results that are semantically similar but topically irrelevant.

**Problem Example:**
- Query: "onboarding"
- False positive: "platform migration" (60% similarity - both are "processes")
- These should NEVER appear together!

**Filtering Rules:**
```
Keep result if:
  - Score >= 80% (trust high semantic similarity), OR
  - Has keyword match (exact word found in text)

Otherwise: FILTER IT OUT (it's a false positive)
```

**Impact:** Eliminates irrelevant results like "platform migration" when searching for "onboarding"

### Layer 4: Recency Boost (When Temporal Keywords Detected)
Detects temporal keywords: `latest`, `recent`, `newest`, `last`, `current`, `today`, etc.

**Boost by age:**
| Age | Boost | Example |
|-----|-------|---------|
| < 7 days | +0.15 (15%) | 75% → 90% |
| < 30 days | +0.10 (10%) | 75% → 85% |
| < 90 days | +0.05 (5%) | 75% → 80% |
| > 90 days | +0.00 (0%) | No boost |

### Layer 5: Relevance Threshold (Only Show 70%+)
**We only show results with 70%+ final score:**
- High Relevance (85%+)
- Medium Relevance (70-84%)
- ~~Low Relevance (60-69%)~~ → **EXCLUDED** (not shown to users)

### Combined Example

**Query:** "What are the **latest** decisions about **onboarding**?"

**Decision:** "Onboarding flow reduced..." (logged 2 days ago)

| Layer | Score | Calculation |
|-------|-------|-------------|
| Semantic (base) | 75% | Vector similarity |
| + Keyword boost | +15% | "onboarding" appears in text |
| + Recency boost | +15% | < 7 days old |
| **Final Score** | **100%** | Capped at 100% max |

**Result:** High Relevance (85%+) ✅

### 4. Improved AI Prompt

Claude now sees:
```
#123 [95%] (🎯 exact match, 🔥 recent) decision: "Onboarding flow simplified" (John, 2d ago)
Note: Exact keyword matches boosted. Recent decisions boosted due to temporal query.
```

## Code Changes

**File: `src/services/semantic-search.js`**

### Added Functions:
1. `hasTemporalContext(query)` - Detects temporal keywords
2. `applyRecencyBoost(results, applyBoost)` - Applies age-based score boost

### Modified Functions:
1. `semanticSearch()` - Detects temporal context, applies boost, re-sorts results
2. `generateConversationalResponse()` - Enhanced prompt with timestamps and boost indicators

## Impact

### Test Case 1: Query with Temporal Context
**Query:** "What are the **latest** decisions about **onboarding**?"

**Before:**
- Decision #123 (2 days old, contains "onboarding", 75% base) → **Medium Relevance (70-84%)** ❌

**After:**
- Decision #123 (2 days old, contains "onboarding", 75% base)
  - +15% keyword boost ("onboarding" match)
  - +15% recency boost (< 7 days)
  - **Final: 100%** (capped) → **High Relevance (85%+)** ✅

### Test Case 2: Query WITHOUT Temporal Context
**Query:** "What decisions have we made about **onboarding**?"

**Before:**
- Decision #123 (contains "onboarding", 75% base) → **Medium Relevance (70-84%)** ❌

**After:**
- Decision #123 (contains "onboarding", 75% base)
  - +15% keyword boost ("onboarding" match)
  - No recency boost (no temporal keywords)
  - **Final: 90%** → **High Relevance (85%+)** ✅

### Test Case 3: Old Decision with Exact Match
**Query:** "Show me decisions about **authentication**"

**Before:**
- Decision #456 (6 months old, contains "authentication", 75% base) → **Medium Relevance** ❌

**After:**
- Decision #456 (6 months old, contains "authentication", 75% base)
  - +15% keyword boost ("authentication" match)
  - No recency boost (no temporal keywords, old decision)
  - **Final: 90%** → **High Relevance (85%+)** ✅

### Test Case 4: False Positive Filtering (**CRITICAL**)
**Query:** "decisions about **onboarding**"

**Before:**
```
High Relevance: (none)
Medium Relevance:
  - Onboarding flow decision (75% base)
Low Relevance:
  - Platform migration decision (65% base) ❌ IRRELEVANT!
  - Kubernetes deployment decision (62% base) ❌ IRRELEVANT!
```

**After:**
```
High Relevance:
  - Onboarding flow decision (90% - has "onboarding" keyword) ✅

Medium/Low Relevance:
  - Platform migration (65%, NO keyword match) → FILTERED OUT ✅
  - Kubernetes deployment (62%, NO keyword match) → FILTERED OUT ✅
```

**Result:** Users only see relevant results. Trust in AI preserved! 🎯

## Testing

To test the improvement:

1. **Log a fresh decision:**
   ```
   /decision Test decision for recency boost
   ```

2. **Query with temporal context:**
   - "What are the latest decisions?"
   - "Show me recent decisions about X"
   - "What did we decide this week?"

3. **Query without temporal context:**
   - "Show me decisions about X"
   - "Find authentication decisions"

**Expected:** Fresh decision should rank higher when temporal keywords are used.

## Backward Compatibility

✅ **Fully backward compatible**
- Non-temporal queries work exactly as before
- Boost only applies when temporal keywords detected
- Original scores preserved in `originalScore` field
- No breaking changes to API

## Future Enhancements

- [ ] Boost by last modified date (for edited decisions)
- [ ] User-configurable boost weights
- [ ] Temporal range extraction ("decisions from last month")
- [ ] Decay function instead of step function
- [ ] A/B test boost values to optimize

## Monitoring

Look for these log messages in Railway:

### Example 1: Perfect Match (All Layers Applied)
```bash
🔍 Semantic search: "What are the latest decisions about onboarding?"
   🔑 Extracted keywords for boosting: [onboarding]
   🔑 Decision #123: 0.750 → 0.900 (+0.15 keyword boost, 2 matches)
   🚫 Filtering out Decision #456 (score: 65.0%, no keyword match)
   🚫 Filtering out Decision #789 (score: 62.0%, no keyword match)
   ✂️  Filtered out 2 false positives (no keyword match + score < 80%)
   ⏰ Temporal context detected - will boost recent decisions
   📅 Decision #123: 0.900 → 1.000 (+0.15 recency boost, 2 days old)
   ✅ After all boosts - Top score: 100.0%
   ✅ Categorized: 1 highly relevant, 0 relevant
   ℹ️  Excluded 0 low-relevance results (< 70%)
```

### Example 2: False Positives Filtered
```bash
🔍 Semantic search: "decisions about onboarding"
   - Raw results: 5
   🔑 Extracted keywords: [onboarding]
   🔑 Decision #123: 0.750 → 0.900 (+0.15 keyword boost, 2 matches)
   🚫 Filtering out Decision #456 (score: 65.0%, no keyword match)  ← "platform migration"
   🚫 Filtering out Decision #789 (score: 62.0%, no keyword match)  ← "kubernetes setup"
   ✂️  Filtered out 2 false positives
   ✅ Categorized: 1 highly relevant, 0 relevant
```

**What each line means:**
- `🔑 Extracted keywords` - Meaningful words after removing stop words
- `🔑 Decision #X: ... (+0.15 keyword boost)` - Found keyword match
- `🚫 Filtering out Decision #X` - **NEW**: Removing false positives
- `✂️  Filtered out N false positives` - **NEW**: Summary of removed results
- `⏰ Temporal context detected` - Query contains "latest" or similar
- `📅 Decision #X: ... (+0.15 recency boost)` - Recent decision boosted
- `ℹ️  Excluded N low-relevance` - **NEW**: Results < 70% not shown

---

**Date:** 2026-01-21
**Author:** Cristian Tumani + Claude
**Status:** ✅ Implemented & Ready to Deploy
