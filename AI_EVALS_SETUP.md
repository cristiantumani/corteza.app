# AI Evaluation System - Setup Guide

## Overview

Comprehensive AI evaluation system using Braintrust to ensure search quality, conversational accuracy, and system reliability for Corteza before beta launch.

**Status:** ✅ Phase 1 Complete - Infrastructure Ready

**Framework:** [Braintrust AI](https://braintrustdata.com)

---

## What Gets Evaluated

### 1. Search Accuracy (10 test cases)
- ✅ Exact keyword matches found
- ✅ Semantic similarity works
- ✅ Temporal queries boost recent decisions
- ✅ False positives filtered correctly
- ✅ ID lookups work

### 2. Conversational Quality (7 test cases)
- ✅ Includes decision IDs for reference
- ✅ Uses first person plural ("we decided")
- ✅ Natural, warm tone (not robotic)
- ✅ No structured markdown sections
- ✅ Appropriate response length
- ✅ LLM judge rates quality 8/10+

### 3. Edge Cases (15 test cases)
- ✅ Empty/whitespace queries
- ✅ Very long queries
- ✅ Special characters & SQL injection
- ✅ Unicode & emoji
- ✅ Case insensitivity
- ✅ Mixed languages

**Total:** 32 test cases covering critical scenarios

---

## Quick Start

### Step 1: Create Braintrust Account

1. Sign up at [https://braintrustdata.com](https://braintrustdata.com) (free tier)
2. Create project: **"corteza-ai-evals"**
3. Go to Settings → API Keys
4. Generate new API key
5. Copy the key (you'll need it next)

### Step 2: Configure Environment Variables

Add to your `.env` file:

```bash
# AI Evaluation
BRAINTRUST_API_KEY=your-braintrust-api-key-here
TEST_WORKSPACE_ID=your-test-workspace-id
```

**Important:**
- `TEST_WORKSPACE_ID` should be a dedicated test workspace (not production)
- Make sure this workspace has some test decisions logged for evals to work

### Step 3: Run Evals Locally

```bash
# Run all evals
npm run eval

# Run only search accuracy evals
npm run eval -- --search-only

# Run only conversational quality evals
npm run eval -- --conversational-only
```

**Expected output:**
```
🧪 Running Corteza AI Evaluations...

   Workspace ID: T123ABC456
   Mode: All Tests

📊 Running Search Accuracy Evals...
   ✅ Tests: 25/25 passed
   📈 Average score: 96.2%
   🎉 Above target!

💬 Running Conversational Quality Evals...
   ✅ Tests: 7/7 passed
   📈 Average score: 88.5%
   🎉 Above target!

📋 Summary:
   Search Accuracy: 100.0% (25/25)
   Conversational: 100.0% (7/7)

🔗 View detailed results: https://braintrustdata.com

✅ All evals passed! Ship it! 🚀
```

---

## Directory Structure

```
evals/
├── eval-runner.js              # Search accuracy eval logic
├── conversational-eval.js      # Conversational quality eval logic
├── run-evals.js               # CLI entry point
└── test-cases/
    ├── search-accuracy.json    # 10 search test cases
    ├── conversational-quality.json  # 7 conversational test cases
    └── edge-cases.json         # 15 edge case test cases
```

---

## Evaluation Scores Explained

### Search Accuracy Scores

| Score | Meaning | What It Checks |
|-------|---------|----------------|
| `contains_expected` | 0.0 - 1.0 | Are expected decision IDs in results? |
| `no_false_positives` | 0.0 or 1.0 | Are excluded IDs filtered out? |
| `top_result_correct` | 0.0 or 1.0 | Is the top result the expected one? |
| `search_method_correct` | 0.0 or 1.0 | Did it use the right search method? |

**Target:** 95%+ average score

### Conversational Quality Scores

| Score | Meaning | What It Checks |
|-------|---------|----------------|
| `includes_decision_ids` | 0.0 - 1.0 | Does response mention decision IDs? |
| `uses_first_person_plural` | 0.0 or 1.0 | Uses "we/our/us"? |
| `no_structured_sections` | 0.0 or 1.0 | No markdown headers like "High Relevance"? |
| `appropriate_length` | 0.0 - 1.0 | Response length 50-200 words? |
| `llm_quality_judge` | 0.0 - 1.0 | Claude Haiku rates quality 0-10 |

**Target:** 80%+ average score

---

## Adding New Test Cases

### Example: Add Search Test Case

Edit `evals/test-cases/search-accuracy.json`:

```json
{
  "id": "my_new_test",
  "query": "decisions about mobile app",
  "expected": {
    "decision_ids": [999],
    "exclude_ids": [111, 222],
    "top_result_id": 999,
    "min_score": 0.85
  },
  "rationale": "Should find mobile app decision, not web decisions"
}
```

### Example: Add Conversational Test Case

Edit `evals/test-cases/conversational-quality.json`:

```json
{
  "id": "my_conversational_test",
  "query": "Tell me about mobile decisions",
  "results": {
    "highlyRelevant": [
      {
        "id": 999,
        "type": "decision",
        "decision": "Building native mobile app",
        "author_name": "Alex",
        "timestamp": "2026-01-20T10:00:00Z",
        "score": 0.95
      }
    ],
    "relevant": [],
    "somewhatRelevant": [],
    "all": []
  },
  "expected": {
    "query": "Tell me about mobile decisions",
    "decision_ids": [999],
    "should_use_first_person": true
  },
  "rationale": "Should mention Decision #999 and use 'we'"
}
```

Then run: `npm run eval` to test your new cases!

---

## CI/CD Integration (Phase 5 - Coming Soon)

### What's Next

Once you're ready to automate evals:

1. **GitHub Actions CI/CD** - Run on every commit
2. **PR Comments** - Eval results posted to pull requests
3. **Scheduled Monitoring** - Daily quality checks
4. **Slack Notifications** - Alert on failures

See the [implementation plan](/Users/cristiantumani/.claude/plans/snazzy-puzzling-rain.md) for details.

---

## Debugging Failed Evals

### If Search Evals Fail

1. Check Braintrust dashboard for details
2. Run locally: `npm run eval -- --search-only`
3. Look at the specific test case that failed
4. Debug the search logic in `src/services/semantic-search.js`
5. Re-run to verify fix

### If Conversational Evals Fail

1. Check Braintrust dashboard for LLM judge scores
2. Run locally: `npm run eval -- --conversational-only`
3. Review the generated response
4. Adjust prompt in `src/services/semantic-search.js` (generateConversationalResponse)
5. Re-run to verify improvement

---

## Beta Tester Issue Workflow

When a beta tester reports an issue:

1. **Create test case** - Add to `test-cases/*.json`
2. **Run eval** - Confirm failure: `npm run eval`
3. **Fix issue** - Update search or conversational logic
4. **Verify fix** - Run eval again (should pass)
5. **Deploy** - Ship with confidence!

---

## Success Metrics

### Current Status: Phase 1 Complete ✅

- [x] Braintrust integration working
- [x] 32 comprehensive test cases created
- [x] Manual execution via `npm run eval`
- [x] Search accuracy evals functional
- [x] Conversational quality evals functional
- [ ] CI/CD integration (Phase 5)
- [ ] Scheduled monitoring (Phase 6)

### Target Metrics

**Search Accuracy:**
- ✅ Precision@3: 90%+
- ✅ Recall: 80%+
- ✅ False Positive Rate: < 5%

**Conversational Quality:**
- ✅ LLM Judge Score: 8/10+
- ✅ Decision ID Mention: 100%
- ✅ First Person Usage: 80%+

**Overall:**
- ✅ 95%+ pass rate on all evals

---

## Cost Analysis

### Per Eval Run (32 test cases)

**Search Accuracy (25 tests):**
- Vector search: ~$0.005
- Total: ~$0.005

**Conversational Quality (7 tests):**
- Response generation: 7 × $0.003 = $0.021
- LLM judge (Haiku): 7 × $0.001 = $0.007
- Total: ~$0.028

**Total per run:** ~$0.033

**Monthly (30 runs):** ~$1.00

**Verdict:** Extremely cost-effective for the confidence it provides!

---

## Troubleshooting

### Error: "TEST_WORKSPACE_ID environment variable is required"

Add to your `.env`:
```bash
TEST_WORKSPACE_ID=T123ABC456
```

### Error: "BRAINTRUST_API_KEY environment variable is required"

1. Go to [https://braintrustdata.com](https://braintrustdata.com)
2. Create account (if not already)
3. Settings → API Keys → Generate
4. Add to `.env`:
```bash
BRAINTRUST_API_KEY=your-api-key
```

### Error: "Cannot find module 'braintrust'"

Run:
```bash
npm install
```

### Evals passing locally but failing in CI

Make sure GitHub Secrets are set:
- `BRAINTRUST_API_KEY`
- `TEST_WORKSPACE_ID`
- `MONGODB_URI`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

---

## Next Steps

**You're ready to:**

1. ✅ Run evals locally anytime: `npm run eval`
2. ✅ Add test cases as you find edge cases
3. ✅ Use evals to debug beta tester issues
4. 🔜 Set up CI/CD (Phase 5)
5. 🔜 Set up scheduled monitoring (Phase 6)

**Beta Launch Readiness:**
- ✅ Infrastructure in place
- ✅ Comprehensive test coverage
- ✅ Manual testing capability
- 🔜 Automated regression detection

---

**Date:** 2026-01-22
**Author:** Cristian Tumani + Claude
**Status:** ✅ Phase 1 Complete - Ready for Local Testing
**Next Phase:** CI/CD Integration (Phases 5-6)

---

## Resources

- [Braintrust Documentation](https://braintrustdata.com/docs)
- [Implementation Plan](/Users/cristiantumani/.claude/plans/snazzy-puzzling-rain.md)
- [Search Quality Improvements](./SEMANTIC_SEARCH_IMPROVEMENTS.md)
- [Conversational AI Improvements](./CONVERSATIONAL_AI_IMPROVEMENTS.md)
