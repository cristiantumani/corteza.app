# Claude Code Workflow Best Practices

**Updated:** 2026-02-06
**Purpose:** Maximize productivity while minimizing credit usage

---

## Quick Reference

### ✅ DO THIS (Credit-Efficient)

**1. Batch Related Changes**
```
✅ GOOD: "Update these 3 schemas in src/config/database.js:
1. Add email field to user schema
2. Add category field to decision schema
3. Add settings field to workspace schema"

❌ BAD: Three separate requests for each schema
```
**Savings: 60-70% tokens**

**2. Use Specific File Paths**
```
✅ GOOD: "Update src/middleware/auth.js:45 to add rate limiting"

❌ BAD: "Update the authentication logic"
```
**Savings: 50% tokens**

**3. Reference Task Files**
```
✅ GOOD: "Run the security review task from tasks/security-review.md"

❌ BAD: "Check for hardcoded secrets, verify input validation, scan dependencies..."
```
**Savings: 80% tokens**

**4. Combine Read-Only Operations**
```
✅ GOOD: "Review these files for security issues:
- src/middleware/auth.js
- src/routes/api.js
- src/config/database.js
Focus on: hardcoded secrets, injection vulnerabilities"

❌ BAD: Three separate "review this file" requests
```
**Savings: 40% tokens**

---

## Detailed Best Practices

### 1. Request Batching

#### When to Batch
- Multiple changes to the same file
- Related changes across 2-3 files
- Sequential operations (create → test → document)
- All changes for a single feature

#### Example Scenarios

**Scenario A: Multi-File Feature**
```
Instead of:
1. "Create auth endpoint in api.js"
2. "Add auth middleware in auth.js"
3. "Add session config in session.js"

Do this:
"Implement authentication across three files:
1. src/routes/api.js - POST /auth/login and /auth/logout endpoints
2. src/middleware/auth.js - requireAuth middleware
3. src/config/session.js - Add session duration config"
```

**Scenario B: Database Schema Updates**
```
Instead of:
1. "Add field to users"
2. "Add field to decisions"
3. "Add field to workspaces"

Do this:
"Update three MongoDB schemas in src/config/database.js:
- users: add 'email_verified' boolean
- decisions: add 'category' enum field
- workspaces: add 'settings' object field"
```

**Scenario C: UI Component Updates**
```
Instead of:
1. "Update dashboard header"
2. "Update dashboard stats cards"
3. "Update dashboard modals"

Do this:
"Update dashboard.html in three sections:
1. Header (line 940): Add logout button
2. Stats cards (line 1050): Add velocity metric
3. Modals (line 1145): Add category dropdown"
```

### 2. Specific File References

#### Always Include
- Exact file path: `src/routes/api.js`
- Line number if known: `line 45`
- Function name if applicable: `getUserDecisions()`
- Context about what needs changing

#### Examples

**Instead of:** "Update the API"
**Use:** "Update src/routes/api.js"

**Instead of:** "Fix the authentication bug"
**Use:** "Fix authentication in src/middleware/auth.js:45 where session check fails"

**Instead of:** "Add validation"
**Use:** "Add email validation in src/middleware/validation.js before database insert"

### 3. Task File Usage

#### Available Task Files
```
tasks/
├── tech-debt.md - Code quality and cleanup
├── update-docs.md - Documentation review
├── lovable-prompt.md - Generate landing page prompts
├── security-review.md - Security audit
├── credit-optimization.md - Token usage analysis
└── session-planning.md - Plan efficient sessions
```

#### Usage Pattern
```
"Run the [task name] task from tasks/[filename].md"

Examples:
- "Run the security review task from tasks/security-review.md"
- "Run the tech debt task from tasks/tech-debt.md"
- "Run the update docs task from tasks/update-docs.md"
```

#### Benefits
- Comprehensive checklists (nothing forgotten)
- Consistent execution (same quality every time)
- Massive token savings (80% vs describing task each time)
- Repeatable (run monthly/quarterly)

### 4. Context Management

#### Start Broad → End Narrow

**Phase 1: Planning (High Context)**
```
"Analyze project structure and plan where to add user authentication feature"
[Uses full project context]
```

**Phase 2: Implementation (Medium Context)**
```
"Implement authentication endpoints in src/routes/auth.js based on plan"
[Uses specific file context + plan]
```

**Phase 3: Testing (Low Context)**
```
"Add tests for auth endpoints in tests/auth.test.js"
[Uses single file context]
```

#### Avoid Repeated Context Loads
```
❌ BAD:
"Looking at the whole project, update this one line in api.js"
[Loads all files unnecessarily]

✅ GOOD:
"Update src/routes/api.js:150 to add rate limiting"
[Loads only necessary file]
```

### 5. Session Planning

#### Before Starting Any Session

**Define Goal (One Sentence)**
```
✅ "Implement user authentication with login, logout, and session persistence"

❌ "Work on auth stuff and fix some bugs"
```

**List All Tasks**
```
Must-Have:
- Create auth endpoints
- Add session management
- Add auth middleware

Should-Have:
- Add rate limiting
- Write tests

Nice-to-Have:
- Update documentation
```

**Estimate & Prioritize**
```
1. Session management (Complex, 60 min) - MUST DO FIRST
2. Auth endpoints (Medium, 45 min) - DEPENDS ON #1
3. Auth middleware (Medium, 30 min) - DEPENDS ON #2
4. Rate limiting (Simple, 15 min)
5. Tests (Medium, 40 min)
```

**Set Break Points**
```
- After task 3: Test auth flow, commit
- After task 5: Full test suite, final commit
```

#### Use Session Planning Template
```
"Plan a session to implement [feature name]"
→ Refer to tasks/session-planning.md for structure
```

---

## Credit Usage Estimates

### Operation Types & Token Costs

| Operation | Inefficient | Efficient | Savings |
|-----------|-------------|-----------|---------|
| Multi-file update (3 files) | 15,000 | 5,000 | 67% |
| Vague request ("update auth") | 20,000 | 10,000 | 50% |
| Task execution | 10,000 | 2,000 | 80% |
| Sequential reads (3 files) | 12,000 | 5,000 | 58% |
| Full context when specific needed | 80,000 | 10,000 | 87% |

### Typical Session Examples

**Bad Session (No Planning)**
```
Total: ~175,000 tokens
├─ Load full context each request: 80,000
├─ Vague requests need clarification: +25,000
├─ Re-read same files: +30,000
├─ Multiple small requests: +40,000
└─ No batching: extra overhead
```

**Good Session (Planned & Efficient)**
```
Total: ~50,000 tokens (71% savings)
├─ Load context once: 30,000
├─ Specific file paths: no searching
├─ Batched operations: minimal re-reads
├─ Task files: no clarifications
└─ Clear break points: efficient commits
```

---

## Common Mistakes to Avoid

### 1. Scope Creep
```
❌ Original: "Add login endpoint"
   Then: "Oh, also add logout"
   Then: "And password reset"
   Then: "And email verification"

✅ Plan upfront: "Implement authentication with:
   - Login endpoint
   - Logout endpoint
   Deferred to next session:
   - Password reset (separate feature)
   - Email verification (future enhancement)"
```

### 2. Vague Descriptions
```
❌ "Make it better"
❌ "Fix the bug"
❌ "Update the database"

✅ "Reduce dashboard load time by lazy-loading charts"
✅ "Fix null pointer error in src/routes/api.js:145 when user_id is missing"
✅ "Add email field to user schema in src/config/database.js"
```

### 3. Not Using Available Context
```
❌ "How do I implement feature X?"
   [Ignores existing similar code in codebase]

✅ "Implement feature X similar to existing feature Y in src/routes/example.js"
   [Leverages existing patterns]
```

### 4. Missing Prerequisites
```
❌ Start coding with:
   - Git conflicts unresolved
   - Environment broken
   - Dependencies out of date
   - No clear goal

✅ Before coding:
   - git status clean
   - npm install up to date
   - Tests passing
   - Clear session plan
```

---

## Workflow Checklist

### Before Each Session
- [ ] Git status clean (or intentional WIP)
- [ ] Clear goal defined (one sentence)
- [ ] Tasks listed and prioritized
- [ ] Break points planned
- [ ] Estimated time vs available time

### During Session
- [ ] Batch related changes
- [ ] Use specific file paths
- [ ] Reference task files when applicable
- [ ] Commit at break points
- [ ] Stay focused on must-haves

### After Session
- [ ] All must-haves completed?
- [ ] Code committed with clear messages?
- [ ] Tests passing?
- [ ] No regressions introduced?
- [ ] Notes for next session?

---

## Quick Tips

**💡 Batch Everything You Can**
Group related changes into single requests. 60-70% savings.

**💡 Be Specific**
Always use exact file paths and line numbers. 50% savings.

**💡 Plan Before Coding**
5-10 minutes of planning saves hours of credit waste.

**💡 Use Task Files**
Leverage existing task files for repeated operations. 80% savings.

**💡 Set Break Points**
Natural stopping points = safer commits = less rework.

**💡 Know When to Stop**
Better to end early than force bad code when tired.

---

## Measuring Success

### Track These Metrics
```bash
# Session duration
Start: [time]
End: [time]
Duration: [hours]

# Credit usage (check Claude Code dashboard)
Tokens used: [number]
Budget: [number]
Efficiency: [%]

# Work completed
Must-haves: [X/Y completed]
Should-haves: [X/Y completed]
Nice-to-haves: [X/Y completed]
```

### Goals
- Complete 100% of must-haves
- Complete 80%+ of should-haves
- Stay within credit budget
- No regressions introduced
- Clear commits with working code

---

## Examples from Corteza

### Example 1: Authentication Implementation

**Inefficient Approach**
```
Request 1: "Add authentication"
Request 2: "What endpoints do I need?"
Request 3: "How should sessions work?"
Request 4: "Create login endpoint"
Request 5: "Create logout endpoint"
Request 6: "Add middleware"
Request 7: "Test the auth flow"

Tokens: ~120,000
Time: 3 hours
```

**Efficient Approach**
```
Request 1: "Plan authentication implementation based on existing patterns in src/routes/"

Request 2: "Implement authentication in three files:
1. src/routes/auth.js - POST /login, /logout, GET /me endpoints
2. src/middleware/auth.js - requireAuth middleware
3. src/config/session.js - Configure express-session with 24h duration

Use patterns from existing routes. Include basic error handling."

Request 3: "Write tests for auth endpoints in tests/auth.test.js covering login success, login failure, logout, and protected route access"

Tokens: ~40,000 (67% savings)
Time: 2 hours
```

### Example 2: Dashboard UI Update

**Inefficient Approach**
```
"Update the dashboard"
[AI asks: "What needs updating?"]
"Add a new section"
[AI asks: "What kind of section?"]
"A stats section"
[AI asks: "What stats?"]
...
```

**Efficient Approach**
```
"Update src/views/dashboard.html line 1050 (stats section):
Add new stat card showing 'Decisions This Week' metric.
Use existing stat card pattern (lines 1051-1065 as template).
Fetch data from existing /api/stats endpoint."
```

### Example 3: Bug Fix

**Inefficient Approach**
```
"There's a bug"
[AI asks: "Where?"]
"In the API"
[AI asks: "Which endpoint?"]
"The decisions one"
[AI asks: "What's the error?"]
...
```

**Efficient Approach**
```
"Fix null pointer error in src/routes/api.js:145.
Bug: When user_id is missing from session, getUserDecisions crashes.
Fix: Add validation before database query, return 401 if missing."
```

---

## Additional Resources

- **Session Planning Template:** `tasks/session-planning.md`
- **Credit Optimization Guide:** `tasks/credit-optimization.md`
- **Credit Usage Report:** `credit-optimization-report-2026-02-06.md`

---

**Remember:** 5-10 minutes of planning saves hours of work and thousands of credits!
