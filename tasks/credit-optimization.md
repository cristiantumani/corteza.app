# Credit Usage Optimization

Analyze the codebase and workflow to minimize Claude Code credit consumption while maintaining productivity and code quality.

## Description
This task systematically reviews the project to identify opportunities to reduce token usage, improve AI efficiency, and optimize workflow patterns. The goal is to get more done with fewer credits without sacrificing quality.

## When to Use
- After noticing high credit consumption
- Before major development sprints
- Monthly optimization reviews
- When adding new large features
- After project structure changes
- When preparing for team expansion

## Understanding Token Usage

### What Consumes Credits
1. **Reading files** - Every file read adds tokens to context
2. **Large file content** - Bigger files = more tokens
3. **Multiple tool calls** - Each tool use has overhead
4. **Back-and-forth clarifications** - Ambiguous code requires multiple rounds
5. **Redundant context** - Same info in multiple files
6. **Verbose comments** - Overly detailed comments inflate size
7. **Generated code** - Large auto-generated files

### Token Estimation
```
Average token counts:
- Small file (< 100 lines): ~500-1000 tokens
- Medium file (100-500 lines): ~1000-5000 tokens
- Large file (> 500 lines): ~5000-15000+ tokens
- Dashboard HTML: ~15000-20000 tokens
- README.md: ~5000-8000 tokens
```

---

## 1. Codebase Analysis for Token Reduction

### 1.1 Identify Large Files
**Find token-heavy files:**
```bash
# Find files by line count
find src -name "*.js" -o -name "*.html" | xargs wc -l | sort -rn | head -20

# Find files by character count (closer to token count)
find src -name "*.js" -o -name "*.html" | xargs wc -c | sort -rn | head -20

# Detailed analysis
for file in $(find src -name "*.js"); do
  lines=$(wc -l < "$file")
  chars=$(wc -c < "$file")
  echo "$lines lines, $chars chars: $file"
done | sort -rn
```

**Review files over 500 lines:**
- [ ] `src/views/dashboard.html` - Check if can be split
- [ ] `src/routes/api.js` - Consider breaking into smaller modules
- [ ] `src/services/semantic-search.js` - Review for splitting opportunities

**Questions to Ask:**
- Can this file be split into logical modules?
- Are there large comment blocks that could be condensed?
- Is there dead code that should be removed?
- Are there repeated patterns that could be abstracted?

### 1.2 Find Redundant Content
**Check for duplication:**
```bash
# Find duplicate code blocks
npx jscpd src/

# Find similar files
fdupes -r src/

# Check for repeated comments
grep -r "TODO" src/ | wc -l
grep -r "FIXME" src/ | wc -l
grep -r "HACK" src/ | wc -l
```

**Common Redundancies:**
- [ ] Same utility functions in multiple files
- [ ] Duplicated validation logic
- [ ] Repeated error handling patterns
- [ ] Copy-pasted comment blocks
- [ ] Similar route handlers

**Remediation:**
- Extract to shared utilities
- Create validation middleware
- Standardize error handling
- Reference docs instead of repeating

### 1.3 Verbose Comments Audit
**Find overly verbose comments:**
```bash
# Find files with high comment-to-code ratio
for file in $(find src -name "*.js"); do
  total=$(wc -l < "$file")
  comments=$(grep -c "^\s*\/\/" "$file" || echo 0)
  if [ $total -gt 0 ]; then
    ratio=$((comments * 100 / total))
    if [ $ratio -gt 30 ]; then
      echo "$ratio% comments: $file"
    fi
  fi
done
```

**Comment Guidelines:**
- ✅ **Good**: Explain *why*, not *what*
- ✅ **Good**: Document complex algorithms
- ✅ **Good**: Note non-obvious edge cases
- ❌ **Bad**: Repeat what code already says
- ❌ **Bad**: Multi-paragraph essays
- ❌ **Bad**: Outdated or wrong comments

**Example - Before (verbose):**
```javascript
/**
 * This function takes a user ID and workspace ID as parameters
 * and then queries the database to find all decisions that belong
 * to that workspace. It filters the results to only include decisions
 * created by the specified user. It then sorts them by timestamp
 * in descending order so the newest decisions appear first.
 * Finally, it returns the sorted array of decisions.
 *
 * @param {string} userId - The ID of the user
 * @param {string} workspaceId - The ID of the workspace
 * @returns {Array} Array of decision objects
 */
async function getUserDecisions(userId, workspaceId) {
  const decisions = await db.collection('decisions')
    .find({ workspace_id: workspaceId, user_id: userId })
    .sort({ timestamp: -1 })
    .toArray();
  return decisions;
}
```
**Tokens: ~200**

**Example - After (concise):**
```javascript
/**
 * Get user's decisions sorted by recency
 */
async function getUserDecisions(userId, workspaceId) {
  return await db.collection('decisions')
    .find({ workspace_id: workspaceId, user_id: userId })
    .sort({ timestamp: -1 })
    .toArray();
}
```
**Tokens: ~60 (70% reduction)**

### 1.4 Auto-Generated Files
**Find files that shouldn't be in git:**
```bash
# Check for common auto-generated patterns
find . -name "*.min.js" -o -name "*.map" -o -name "dist/*" -o -name "build/*"

# Check for IDE files
find . -name ".vscode" -o -name ".idea" -o -name "*.swp"

# Check for OS files
find . -name ".DS_Store" -o -name "Thumbs.db"

# Check for logs
find . -name "*.log" -o -name "logs/*"
```

**Update .gitignore:**
```gitignore
# Dependencies
node_modules/
package-lock.json  # (or keep it, be consistent)

# Environment
.env
.env.local
.env.*.local

# Logs
logs/
*.log
npm-debug.log*

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Build
dist/
build/
*.min.js
*.map

# Temporary
tmp/
temp/
*.tmp

# AI/Test artifacts
.claude/
coverage/
.nyc_output/
```

### 1.5 Large Data Files
**Find data files in repo:**
```bash
# Find files over 1MB
find . -type f -size +1M

# Find JSON/CSV data files
find . -name "*.json" -o -name "*.csv" | grep -v node_modules

# Check for media files
find . -name "*.png" -o -name "*.jpg" -o -name "*.mp4" -o -name "*.pdf"
```

**Data File Checklist:**
- [ ] Are there test fixtures over 100KB?
- [ ] Are there sample data files committed?
- [ ] Are there screenshots/images over 500KB?
- [ ] Are there PDFs or videos in the repo?

**Remediation:**
- Move large test data to external storage (S3, CDN)
- Use smaller sample datasets
- Compress images (use TinyPNG, ImageOptim)
- Reference external URLs for large assets
- Use Git LFS for necessary large files

---

## 2. Code Clarity Improvements

### 2.1 Ambiguous Naming
**Find potential naming issues:**
```bash
# Single-letter variables (outside loops)
grep -rn "\b[a-z]\s*=" src/ | grep -v "for ("

# Generic names
grep -rn "data\|info\|temp\|var\|result\|value" src/

# Inconsistent naming
grep -rn "get_" src/  # snake_case
grep -rn "get[A-Z]" src/  # camelCase (should be consistent)
```

**Naming Guidelines:**
- ✅ **Good**: `getUserDecisions`, `workspaceId`, `isAdmin`
- ❌ **Bad**: `getData`, `x`, `temp`, `result1`

**Impact on Token Usage:**
- Ambiguous names → AI asks for clarification → extra tokens
- Clear names → AI understands immediately → fewer tokens

**Example - Before:**
```javascript
async function process(d, w) {
  const r = await db.find({ w: w });
  return r.filter(x => x.u === d);
}
```
**AI needs to ask: "What are d, w, r, x, u?"** → Extra round trip

**Example - After:**
```javascript
async function getUserDecisions(userId, workspaceId) {
  const allDecisions = await db.find({ workspace_id: workspaceId });
  return allDecisions.filter(decision => decision.user_id === userId);
}
```
**AI understands immediately** → No extra questions

### 2.2 Missing Docstrings
**Find functions without docs:**
```bash
# Find exported functions without JSDoc
grep -A1 "^async function\|^function" src/**/*.js | grep -B1 -v "/\*\*"

# Check for public API endpoints without comments
grep -n "expressApp\.(get\|post\|put\|delete)" src/index.js | while read line; do
  linenum=$(echo $line | cut -d: -f1)
  if ! sed -n "$((linenum-2)),$((linenum-1))p" src/index.js | grep -q "//"; then
    echo "No comment: $line"
  fi
done
```

**Functions That Need Docs:**
- [ ] All exported functions
- [ ] All API route handlers
- [ ] Complex algorithms
- [ ] Functions with > 3 parameters
- [ ] Functions with non-obvious behavior

**Minimal Docstring Template:**
```javascript
/**
 * Brief description of what function does
 * @param {Type} paramName - What this parameter is
 * @returns {Type} What function returns
 */
```

**Impact:**
- Missing docs → AI reads entire function → more tokens
- Clear docs → AI reads summary → fewer tokens

### 2.3 Complex Logic Without Explanation
**Find complex functions:**
```bash
# Find long functions (> 50 lines)
for file in src/**/*.js; do
  awk '/^function |^async function / {start=NR; name=$2}
       /^}/ && start>0 {
         if (NR-start > 50)
           print FILENAME":"start": "name" ("NR-start" lines)"
         start=0
       }' "$file"
done

# Find deep nesting (> 3 levels)
grep -n "^\s\{12,\}" src/**/*.js  # 4+ levels of indentation

# Find high cyclomatic complexity
npx complexity-report src/
```

**When to Add Explanatory Comments:**
- Nested conditions > 3 levels
- Functions > 50 lines
- Non-obvious algorithms
- Workarounds for bugs
- Performance optimizations
- Security-critical code

**Example - Before:**
```javascript
function calculate(items) {
  return items.reduce((acc, item) => {
    if (item.type === 'a') {
      return acc + (item.value * 1.1);
    } else if (item.type === 'b') {
      return acc + (item.value * 0.9);
    }
    return acc + item.value;
  }, 0);
}
```
**AI might ask: "Why 1.1 and 0.9? What's the business logic?"**

**Example - After:**
```javascript
/**
 * Calculate total with type-based multipliers
 * Type 'a' gets 10% premium, type 'b' gets 10% discount
 */
function calculateTotalWithMultipliers(items) {
  const PREMIUM_MULTIPLIER = 1.1;  // Type 'a' premium
  const DISCOUNT_MULTIPLIER = 0.9; // Type 'b' discount

  return items.reduce((total, item) => {
    const multiplier =
      item.type === 'a' ? PREMIUM_MULTIPLIER :
      item.type === 'b' ? DISCOUNT_MULTIPLIER :
      1.0;

    return total + (item.value * multiplier);
  }, 0);
}
```
**AI understands business logic immediately**

### 2.4 Inconsistent Code Patterns
**Find inconsistencies:**
```bash
# Check for mixed async patterns
grep -rn "\.then(" src/  # Promise chains
grep -rn "async/await" src/  # Should be consistent

# Check for mixed error handling
grep -rn "try {" src/
grep -rn "\.catch(" src/

# Check for mixed imports
grep -rn "^const.*= require(" src/  # CommonJS
grep -rn "^import.*from" src/  # ES6 (shouldn't mix)
```

**Standardize Patterns:**
- ✅ Use async/await consistently (not mixing with .then())
- ✅ Use try/catch consistently
- ✅ Use CommonJS OR ES6, not both
- ✅ Use same validation library everywhere
- ✅ Use same error response format

**Impact:**
- Inconsistent patterns → AI needs to track multiple styles → more context
- Consistent patterns → AI learns once → less context needed

---

## 3. Project Structure Optimization

### 3.1 .gitignore Audit
**Check what's being tracked unnecessarily:**
```bash
# See what's actually in git
git ls-files | head -50

# Check for large files
git ls-files | xargs ls -lh | sort -k5 -rh | head -20

# Find files that should be ignored
git status --ignored

# Check ignore rules
cat .gitignore
```

**Essential .gitignore Entries:**
```gitignore
# Dependencies (HUGE token savings)
node_modules/

# Environment (security + no need to track)
.env
.env.*

# Build artifacts
dist/
build/
*.min.js

# IDE settings (personal preference, wastes tokens)
.vscode/
.idea/
*.swp

# OS files
.DS_Store

# Logs
*.log

# Test coverage
coverage/

# Temporary files
tmp/
*.tmp
```

**Token Savings:**
- Excluding node_modules: **-50,000+ tokens per session**
- Excluding .vscode: **-2,000 tokens**
- Excluding logs: **-5,000 tokens**

### 3.2 Binary Files Check
**Find binary files in git:**
```bash
# Find files git considers binary
git grep -I --name-only -e '' | git check-attr binary --stdin

# Find images
find . -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.gif" \)

# Find videos/media
find . -type f \( -name "*.mp4" -o -name "*.mov" -o -name "*.avi" \)

# Find PDFs
find . -type f -name "*.pdf"
```

**Remediation:**
- Move screenshots to docs/ folder in .gitignore
- Use external hosting for videos (YouTube, Loom)
- Link to PDFs instead of committing them
- Use SVG instead of PNG where possible (text-based)

### 3.3 Configuration Documentation
**Check if configs are clear:**
- [ ] Is `package.json` well-organized?
- [ ] Is `.env.example` comprehensive?
- [ ] Are all config files commented?
- [ ] Is there a config/README.md?

**Example - Before:**
```json
{
  "scripts": {
    "s": "node src/index.js",
    "d": "nodemon src/index.js"
  }
}
```
**AI might ask: "What do 's' and 'd' mean?"**

**Example - After:**
```json
{
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  }
}
```
**Clear without explanation**

### 3.4 README Structure Check
**Verify README covers:**
- [ ] Clear project overview (1-2 sentences)
- [ ] Quick start (5 minutes to running)
- [ ] Project structure diagram
- [ ] Common commands
- [ ] Environment variables list
- [ ] Link to detailed docs (don't put everything in README)

**Optimization:**
- Keep README under 500 lines
- Link to separate docs for details
- Use clear section headers
- Include table of contents for long READMEs

---

## 4. Workflow Efficiency Recommendations

### 4.1 Batch Similar Operations
**Instead of:**
```
"Update the user schema in database.js"
[AI reads file, makes change]

"Update the decision schema too"
[AI reads file again, makes change]

"And the workspace schema"
[AI reads file again, makes change]
```
**3 separate context loads**

**Better:**
```
"Update three schemas in database.js:
1. Add email field to user schema
2. Add category field to decision schema
3. Add settings field to workspace schema"
```
**1 context load, 3 changes**

**Token Savings: ~60-70% for batch operations**

### 4.2 Use Task Files for Repeated Operations
**Common repeated tasks:**
- Running security audits
- Updating documentation
- Deploying to production
- Creating new features
- Code reviews

**Create task files:**
```markdown
# tasks/deploy.md
1. Run tests
2. Update CHANGELOG
3. Bump version
4. Git tag
5. Push to Railway
```

**Usage:**
```
"Run the deploy task"
```
**vs**
```
"First run the tests, then update the changelog with... then bump the version in package.json to... then create a git tag... then push to Railway making sure to..."
```

**Token Savings: ~80-90% for repeated workflows**

### 4.3 Shell Scripts vs AI
**Use shell scripts for:**
- ✅ Repetitive file operations
- ✅ Simple find/replace across multiple files
- ✅ Running sequences of commands
- ✅ Data transformations

**Use AI for:**
- ✅ Complex logic changes
- ✅ Refactoring code
- ✅ Writing new features
- ✅ Debugging issues

**Example - Use Shell:**
```bash
# Rename all .jsx to .tsx
find src -name "*.jsx" -exec sh -c 'mv "$1" "${1%.jsx}.tsx"' _ {} \;

# Add header to all files
for file in src/**/*.js; do
  cat header.txt "$file" > temp && mv temp "$file"
done
```
**Don't ask AI to do this file by file**

### 4.4 Specific File References
**Instead of:**
```
"Update the authentication logic"
```
**AI searches entire codebase for auth files → many tokens**

**Better:**
```
"Update src/middleware/auth.js line 45 to add rate limiting"
```
**AI reads one specific file → fewer tokens**

**Token Savings: ~50-70% when being specific**

---

## 5. Context Management Strategies

### 5.1 File Co-location Analysis
**Find frequently modified together:**
```bash
# Check git history for co-changed files
git log --name-only --pretty=format: | sort | uniq -c | sort -rn | head -20

# Find files that change together
git log --format=format: --name-only | grep -v "^$" | sort | uniq -c | sort -rn
```

**If files change together often, consider:**
- Combining into single file
- Creating shared module they both import
- Batch updates to both files in single request

### 5.2 Large File Splitting Opportunities
**Identify candidates for splitting:**
```bash
# Find files > 500 lines
find src -name "*.js" -exec wc -l {} \; | awk '$1 > 500 {print}'

# Find files with multiple responsibilities
# (functions with different prefixes)
for file in src/**/*.js; do
  prefixes=$(grep "^function\|^async function" "$file" | sed 's/function //' | sed 's/(.*$//' | sed 's/[A-Z].*//' | sort -u)
  count=$(echo "$prefixes" | wc -l)
  if [ $count -gt 3 ]; then
    echo "$file has $count different function prefixes"
  fi
done
```

**Consider splitting if:**
- File > 500 lines
- Multiple distinct responsibilities
- Only parts of file needed at a time
- High change frequency

**Example:**
```
src/routes/api.js (800 lines)
→ Split into:
  - src/routes/decisions.js (200 lines)
  - src/routes/analytics.js (150 lines)
  - src/routes/admin.js (150 lines)
  - src/routes/gdpr.js (100 lines)
```

**Token Savings: ~75% per operation (only load relevant file)**

### 5.3 When to Use Project-Wide Context
**Use full project context when:**
- Planning new features
- Refactoring architecture
- Understanding data flow
- First-time codebase exploration

**Use specific file context when:**
- Bug fixes in known files
- Small feature additions
- Documentation updates
- Code reviews

**Optimization Strategy:**
```
Phase 1: "Analyze project structure and suggest where to add feature X"
[Uses full context once]

Phase 2: "Implement feature X in src/routes/newFeature.js"
[Uses specific file context]

Phase 3: "Update tests in tests/newFeature.test.js"
[Uses specific file context]
```

**vs**

**Inefficient:**
```
Every request: "Looking at the whole project, update this one file..."
[Loads full context every time]
```

---

## 6. Output Format

### Quick Wins (Immediate Impact)

#### 1. Update .gitignore
**Action:** Add missing entries to .gitignore
**Files:** `.gitignore`
**Effort:** 5 minutes
**Token Savings:** ~50,000 tokens per session (excludes node_modules from context)

```gitignore
# Add these:
node_modules/
.vscode/
.DS_Store
*.log
coverage/
```

#### 2. Remove Verbose Comments
**Action:** Condense overly detailed comments in dashboard.html
**Files:** `src/views/dashboard.html`
**Effort:** 30 minutes
**Token Savings:** ~2,000-3,000 tokens per dashboard read

**Example:**
```html
<!-- Before: 200 token comment -->
<!-- This section displays the user's decisions. It fetches data from the API,
     renders each decision as a card with edit/delete buttons, and updates
     dynamically when new decisions are added. The cards are styled with
     CSS classes defined in the style section above. -->

<!-- After: 50 token comment -->
<!-- Decision cards with edit/delete actions -->
```

#### 3. Batch Related Requests
**Action:** Group related changes into single requests
**Example:** Instead of 3 separate "update schema" requests, combine into one
**Effort:** Habit change (0 time cost)
**Token Savings:** ~60-70% on multi-file operations

#### 4. Use Specific File References
**Action:** Always specify file paths when known
**Example:** "Update src/routes/api.js" vs "Update the API"
**Effort:** Habit change (0 time cost)
**Token Savings:** ~50% on targeted operations

**Total Quick Win Savings: ~55,000+ tokens per session**

---

### Medium-Term Improvements

#### 1. Split Large Dashboard HTML
**Action:** Break dashboard.html into components
**Current:** 1 file, ~800 lines (~15,000 tokens)
**Proposed:**
```
src/views/
  ├── dashboard.html (main, 200 lines)
  ├── components/
  │   ├── decision-list.html (150 lines)
  │   ├── search-interface.html (100 lines)
  │   ├── stats-cards.html (100 lines)
  │   └── modals.html (250 lines)
```

**Benefits:**
- Only load relevant component
- ~75% token reduction when updating specific sections
- Easier maintenance

**Effort:** 3-4 hours
**Token Savings:** ~11,000 tokens per component update (vs full dashboard)

#### 2. Extract Shared Utilities
**Action:** Create src/utils/ for repeated functions
**Current:** Validation logic duplicated across 5 files
**Proposed:**
```javascript
// src/utils/validation.js
export function validateEmail(email) { ... }
export function validateWorkspaceId(id) { ... }
```

**Benefits:**
- Single source of truth
- Read once, use many times
- Consistent behavior

**Effort:** 2-3 hours
**Token Savings:** ~3,000-5,000 tokens (avoid reading duplicates)

#### 3. Create Task Files for Common Operations
**Action:** Document all repeated workflows
**Tasks to Create:**
- Deployment checklist
- Security review
- Documentation update
- Feature release
- Bug triage

**Effort:** 1 hour per task file
**Token Savings:** ~80% on repeated operations

#### 4. Standardize Code Patterns
**Action:** Pick one pattern for each concern
**Areas:**
- Error handling (try/catch everywhere)
- Async (async/await, no .then())
- Imports (CommonJS throughout)
- Validation (use Joi or Zod consistently)

**Effort:** 4-6 hours to refactor
**Token Savings:** ~20-30% overall (AI loads less context when patterns are consistent)

**Total Medium-Term Savings: ~15,000-20,000 tokens per session**

---

### Long-Term Strategy

#### 1. Microservice Architecture (if needed)
**Current:** Monolith in src/
**Proposed:** Split into services
```
services/
  ├── auth-service/
  ├── decision-service/
  ├── search-service/
  └── analytics-service/
```

**When to Consider:**
- Codebase > 10,000 lines
- Team > 5 developers
- Distinct business domains

**Benefits:**
- Work on one service at a time
- ~90% token reduction for service-specific work

**Effort:** 2-3 weeks
**Applicability:** Only if scaling significantly

#### 2. Documentation-First Development
**Strategy:**
- Write design doc before coding
- Reference doc during implementation
- AI reads doc instead of exploring code

**Example:**
```
"Implement the user authentication flow as described in docs/auth-design.md"
```
**vs**
```
"Implement user authentication. It should handle login, signup, sessions..."
[AI has to ask many questions]
```

**Effort:** Add 20% to planning time
**Token Savings:** ~40-50% on implementation (clear requirements upfront)

#### 3. Automated Context Summarization
**Strategy:**
- Generate architectural decision records (ADRs)
- Maintain architecture diagrams
- Auto-generate API docs from code

**Tools:**
- JSDoc → API docs
- TypeScript → Type docs
- Mermaid → Architecture diagrams

**Benefits:**
- AI reads high-level docs instead of all code
- Single source of truth

**Effort:** Set up tooling (1-2 days initially)
**Token Savings:** ~30-40% for architecture questions

#### 4. AI-Optimized Coding Style Guide
**Create style guide focused on AI readability:**
- Maximum function length: 50 lines
- Maximum file length: 500 lines
- Required docstrings for all exports
- Clear naming conventions
- Standard project structure

**Effort:** Create guide (1 day), enforce via linting (ongoing)
**Token Savings:** ~25-35% through better clarity and structure

**Total Long-Term Savings: ~50,000-70,000 tokens per session**

---

## Token Usage Metrics

### Before Optimization (Estimated)
```
Typical Session:
- Load project context: 80,000 tokens
- Read node_modules accidentally: +50,000 tokens
- Read verbose dashboard: 15,000 tokens
- Multiple clarification rounds: +10,000 tokens
- Re-reading same files: +20,000 tokens
Total: ~175,000 tokens per session
```

### After Quick Wins
```
Typical Session:
- Load project context: 80,000 tokens
- node_modules excluded: 0 tokens (saved 50,000)
- Condensed dashboard: 12,000 tokens (saved 3,000)
- Specific file refs: 5,000 tokens (saved 15,000)
- Batched operations: minimal re-reads (saved 15,000)
Total: ~97,000 tokens per session (45% reduction)
```

### After Medium-Term Improvements
```
Typical Session:
- Load only relevant files: 30,000 tokens (saved 50,000)
- Componentized dashboard: 3,000 tokens (saved 9,000)
- Shared utilities: minimal duplication (saved 5,000)
- Task files: no clarifications needed (saved 8,000)
Total: ~55,000 tokens per session (68% reduction)
```

### After Long-Term Strategy
```
Typical Session:
- Read design doc: 2,000 tokens
- Load specific service: 10,000 tokens
- Generated API docs: 3,000 tokens
- Clear patterns, no confusion: minimal extras
Total: ~20,000-30,000 tokens per session (83% reduction)
```

---

## Implementation Checklist

### Phase 1: Immediate (This Week)
- [ ] Update .gitignore with all exclusions
- [ ] Remove node_modules from git if tracked
- [ ] Condense verbose comments in HTML files
- [ ] Start using specific file references
- [ ] Batch related requests together

### Phase 2: Short-Term (This Month)
- [ ] Identify and split files > 500 lines
- [ ] Extract shared utilities
- [ ] Create task files for common operations
- [ ] Standardize async/error patterns
- [ ] Add docstrings to all exports

### Phase 3: Long-Term (This Quarter)
- [ ] Consider service architecture if needed
- [ ] Implement documentation-first workflow
- [ ] Set up automated doc generation
- [ ] Create AI-optimized style guide
- [ ] Train team on credit-efficient practices

---

## Monitoring & Measurement

### Track These Metrics
```bash
# Average session token usage
# (Check Claude Code usage dashboard)

# Codebase size
find src -name "*.js" -o -name "*.html" | xargs wc -l | tail -1

# Number of large files (> 500 lines)
find src -name "*.js" -o -name "*.html" | xargs wc -l | awk '$1 > 500' | wc -l

# Comment density
total_lines=$(find src -name "*.js" | xargs wc -l | tail -1 | awk '{print $1}')
comment_lines=$(find src -name "*.js" | xargs grep -h "^\s*//" | wc -l)
echo "Comment ratio: $((comment_lines * 100 / total_lines))%"
```

### Set Goals
- Reduce average session tokens by 50% in 1 month
- Keep all files under 500 lines
- Maintain < 20% comment-to-code ratio
- Have task files for 80% of repeated operations

---

## Notes

- **Balance:** Don't sacrifice code quality for token savings
- **Clarity First:** Clear code reduces tokens AND improves maintainability
- **Document Savings:** Track before/after metrics to validate improvements
- **Team Training:** Educate team on credit-efficient practices
- **Iterate:** Start with quick wins, measure, then do more

## Related Tasks

- `tasks/tech-debt.md` - May identify token-heavy code
- `tasks/update-docs.md` - Better docs reduce clarification rounds
- `tasks/security-review.md` - Can be task file instead of exploratory

---

**Work smarter, not harder. Optimize for both AI and humans!**
