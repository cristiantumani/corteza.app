# Semantic Search Improvements - Recency Boosting

## Problem Statement

When users asked for "latest decisions about X", the semantic search would:
1. Find decisions semantically similar to X
2. Rank them purely by text similarity (vector distance)
3. Ignore recency completely

**Result:** A decision logged yesterday with 75% similarity would rank lower than a 6-month-old decision with 80% similarity, even when the user explicitly asked for "latest."

## Solution: Temporal Context Detection + Recency Boosting

### 1. Temporal Context Detection

Detects when queries mention time-related keywords:
- `latest`, `recent`, `newest`, `last`, `current`
- `today`, `yesterday`, `this week`, `this month`
- `new`, `just`, `recently made`

### 2. Recency Boost Algorithm

When temporal context is detected, apply score boosts based on age:

| Age | Boost | Example |
|-----|-------|---------|
| < 7 days | +0.15 (15%) | 75% → 90% |
| < 30 days | +0.10 (10%) | 75% → 85% |
| < 90 days | +0.05 (5%) | 75% → 80% |
| > 90 days | +0.00 (0%) | No boost |

**Example:**
- Query: "What are the latest decisions about onboarding?"
- Decision A: Logged yesterday, semantic score 75% → **90% after boost**
- Decision B: Logged 6 months ago, semantic score 80% → **80% (no boost)**
- **Result:** Decision A now ranks higher (correct!)

### 3. Improved AI Prompt

The conversational response now:
- Includes decision timestamps ("2 days ago", "yesterday", "today")
- Marks boosted decisions with 🔥 emoji
- Tells Claude that recency boost was applied
- Instructs Claude to highlight recent decisions

**Before:**
```
#123 [75%] decision: "Onboarding flow simplified" (John)
```

**After:**
```
#123 [90%] (🔥 recent) decision: "Onboarding flow simplified" (John, 2d ago)
Note: Recent decisions boosted due to "latest/recent" query context.
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

### Before:
Query: "What are the latest decisions about onboarding?"
- Decision #123 (2 days old, 75% similarity) → **Medium Relevance (70-84%)**
- Decision #456 (6 months old, 80% similarity) → **Medium Relevance (70-84%)**

### After:
Query: "What are the latest decisions about onboarding?"
- Decision #123 (2 days old, 75% → **90%**) → **High Relevance (85%+)** ✅
- Decision #456 (6 months old, 80% → 80%) → **Medium Relevance (70-84%)**

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

Look for these log messages:
```
⏰ Temporal context detected - will boost recent decisions
📅 Decision #123: 0.750 → 0.900 (+0.15 recency boost, 2 days old)
✅ After recency boost - Top score: 90.0%
```

---

**Date:** 2026-01-21
**Author:** Cristian Tumani + Claude
**Status:** ✅ Implemented & Ready to Deploy
