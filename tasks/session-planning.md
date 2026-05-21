# Session Planning

Plan efficient Claude Code sessions to maximize productivity while minimizing credit usage and avoiding context fatigue.

## Description
This task helps you structure your Claude Code sessions with clear goals, prioritized tasks, and optimal execution order. Good planning leads to faster completion, lower credit usage, and better outcomes.

## When to Use
- Before starting any significant development work
- When you have multiple tasks to accomplish
- When managing limited credits
- When working on complex features
- Before each work session (daily planning)
- When coordinating multiple team members using Claude

## Session Planning Framework

---

## 1. Define Session Goal

### Primary Objective
Answer these questions clearly:

**What is the goal?**
- One sentence: "Implement user authentication system"
- Not: "Work on auth stuff and maybe fix some bugs"

**What does "done" look like?**
- Specific, measurable outcome
- Example: "Users can log in, sessions persist, admin dashboard shows user list"
- Not: "Auth mostly working"

**Success Criteria:**
- [ ] Specific functionality works
- [ ] Tests pass
- [ ] No regressions introduced
- [ ] Code committed with clear messages

**Out of Scope (for this session):**
- List what you're explicitly NOT doing
- Helps avoid scope creep
- Example: "NOT implementing password reset (next session)"

### Blocker Check
**Before starting, verify:**
- [ ] No git conflicts or uncommitted changes
- [ ] Environment variables set correctly
- [ ] Dependencies installed (npm install ran recently)
- [ ] Database/services accessible
- [ ] No critical bugs blocking progress
- [ ] External dependencies available (API keys, design files, etc.)

**If blockers exist:**
1. List them explicitly
2. Estimate time to resolve each
3. Decide: resolve now or defer session?
4. Don't start coding until blockers are cleared

---

## 2. Task Inventory & Prioritization

### Brain Dump All Tasks
Write down everything you want to accomplish:
```
- Add login form to dashboard
- Create authentication API endpoint
- Set up session management
- Add logout functionality
- Write tests for auth flow
- Update documentation
- Add rate limiting to login
- Create admin panel
- Fix bug in decision export
- Refactor database connection
```

### Categorize by Priority

#### Critical (Must-Have)
Tasks that MUST be done for the session goal to be achieved.

**Criteria:**
- Blocks other critical work
- Affects users in production
- Has external deadline
- Required for feature to work

**Example:**
```
✅ CRITICAL
- Create authentication API endpoint (core functionality)
- Add login form to dashboard (user-facing)
- Set up session management (security requirement)
```

#### High Value (Should-Have)
Important tasks that significantly improve the feature but aren't strictly required.

**Criteria:**
- Adds substantial value
- Prevents future problems
- Improves user experience notably
- Good practice (security, testing)

**Example:**
```
⚡ HIGH VALUE
- Add rate limiting to login (security best practice)
- Write tests for auth flow (prevent regressions)
- Add logout functionality (expected UX)
```

#### Nice-to-Have (Could-Have)
Tasks that would be nice but can wait if time runs short.

**Criteria:**
- Minor improvements
- Cleanup/refactoring
- Documentation (if not critical)
- Nice UX touches

**Example:**
```
💡 NICE-TO-HAVE
- Update documentation with auth instructions
- Add "Remember me" checkbox
- Create admin panel for user management
```

#### Unrelated (Defer)
Tasks not related to session goal. Move to backlog.

**Example:**
```
🚫 DEFER
- Fix bug in decision export (different feature)
- Refactor database connection (not blocking)
```

### Estimate Complexity

For each task, assess effort and context needs:

**Simple (S)** - 15-30 minutes
- Single file change
- Clear implementation path
- Minimal context needed
- Low risk

**Medium (M)** - 30-60 minutes
- 2-3 file changes
- Some design decisions
- Moderate context
- Some testing needed

**Complex (C)** - 60+ minutes
- Multiple files/components
- Architectural decisions
- High context requirements
- Extensive testing

**Example:**
```
✅ Create auth API endpoint - Medium (M) - 45 min
✅ Add login form - Simple (S) - 20 min
✅ Session management - Complex (C) - 90 min
⚡ Rate limiting - Simple (S) - 15 min
⚡ Auth tests - Medium (M) - 45 min
⚡ Logout functionality - Simple (S) - 20 min
```

---

## 3. Optimal Execution Strategy

### Batching Opportunities

**Group tasks by:**

1. **Same files/components**
   ```
   Batch: Dashboard changes
   - Add login form
   - Add logout button
   - Update header with user info
   ```
   **Why:** Load context once, make all changes

2. **Same domain/feature**
   ```
   Batch: Authentication flow
   - Create auth API endpoints
   - Set up session management
   - Add middleware checks
   ```
   **Why:** Related logic, shared understanding

3. **Same type of work**
   ```
   Batch: Testing
   - Write auth tests
   - Write API tests
   - Write integration tests
   ```
   **Why:** Same mental mode, same tools

4. **Same context level**
   ```
   Batch: High-context architectural
   - Design auth architecture
   - Plan database schema
   - Design API structure

   Batch: Low-context implementation
   - Fix typo in README
   - Update .env.example
   - Add rate limiter config
   ```
   **Why:** Minimize context switching

### Dependencies & Ordering

**Identify task dependencies:**
```
Task A → Task B → Task C
(B depends on A, C depends on B)

Example:
Create auth endpoint → Add login form → Write tests
(Can't test login without endpoint)
```

**Execution principles:**
1. ✅ Do blocking tasks first (unblock others)
2. ✅ Do high-context tasks early (when fresh)
3. ✅ Do risky tasks before safe ones (easier to rollback)
4. ✅ Do complex before simple (mental energy)
5. ✅ Do must-haves before nice-to-haves (scope protection)

### Context Efficiency Strategy

**Start Broad → End Narrow**

```
Phase 1: High Context (First 30%)
├─ Architecture decisions
├─ Cross-cutting changes
└─ Feature planning

Phase 2: Medium Context (Middle 50%)
├─ Feature implementation
├─ API endpoints
└─ Component changes

Phase 3: Low Context (Final 20%)
├─ Config updates
├─ Documentation
└─ Single-file fixes
```

**Why this order:**
- Early: Fresh mental state, handle complexity
- Middle: Focused implementation with clear direction
- Late: Low-stakes tasks when fatigued

### Break Points

**Plan natural stopping points:**

```
✅ After completing auth endpoint
   → Test endpoint works
   → Commit "Add authentication endpoint"
   → BREAK POINT (can stop here if needed)

✅ After adding login form
   → Test full login flow
   → Commit "Add login UI and flow"
   → BREAK POINT

✅ After adding tests
   → Run full test suite
   → Commit "Add auth tests"
   → BREAK POINT (feature complete)
```

**Why break points:**
- Natural commit boundaries
- Can stop without losing work
- Testing/validation moments
- Switch to manual work if needed

---

## 4. Pre-Session Checklist

### Code State
- [ ] Git status clean (or intentional WIP)
- [ ] On correct branch
- [ ] Latest changes pulled
- [ ] No merge conflicts
- [ ] Dependencies up to date (`npm install`)

### Environment
- [ ] All environment variables set
- [ ] Database accessible
- [ ] External services reachable
- [ ] Tests passing (baseline)
- [ ] Local dev server runs

### Context & Information
- [ ] Design files/mockups ready (if UI work)
- [ ] API documentation available (if integration)
- [ ] Requirements clearly understood
- [ ] Acceptance criteria defined
- [ ] Example data/fixtures ready (if needed)

### Time & Focus
- [ ] Estimated time available
- [ ] Minimal distractions
- [ ] Energy level adequate for complex work
- [ ] No urgent meetings interrupting

**If checklist incomplete:**
- Resolve issues before starting session
- OR adjust session plan to work around gaps
- Don't start complex work unprepared

---

## 5. Session Structure Templates

### Template A: Feature Implementation

**Best for:** Building new features from scratch

```
Session Goal: Implement [feature name]
Duration: 2-3 hours

Phase 1: Architecture & Planning (30 min)
├─ Review requirements
├─ Design data models
├─ Plan API endpoints
└─ Sketch component structure

BREAK: Commit design decisions to docs

Phase 2: Core Implementation (90 min)
├─ Create database schema/models
├─ Implement API endpoints
├─ Build UI components
└─ Wire up data flow

BREAK: Test feature manually, commit

Phase 3: Polish & Testing (45 min)
├─ Add error handling
├─ Write tests
├─ Update documentation
└─ Final testing

BREAK: Full test suite, final commit
```

### Template B: Bug Fix Session

**Best for:** Fixing multiple bugs

```
Session Goal: Fix [X] critical bugs
Duration: 1-2 hours

Phase 1: Investigation (20 min)
├─ Reproduce all bugs
├─ Identify root causes
└─ Estimate complexity

Phase 2: Fix High-Impact Bugs (60 min)
├─ Fix bug #1 (critical)
├─ Test thoroughly
├─ Commit
├─ Fix bug #2 (high)
├─ Test
└─ Commit

Phase 3: Fix Low-Impact Bugs (40 min)
├─ Fix bug #3 (medium)
├─ Fix bug #4 (low)
└─ Commit all

No breaks until critical bugs fixed
```

### Template C: Refactoring Session

**Best for:** Code quality improvements

```
Session Goal: Refactor [component/module]
Duration: 2 hours

Phase 1: Analysis (30 min)
├─ Read current implementation
├─ Identify issues
├─ Design better structure
└─ Write tests for current behavior

BREAK: Commit tests (safety net)

Phase 2: Refactor (75 min)
├─ Extract utilities
├─ Simplify logic
├─ Improve naming
└─ Update documentation

BREAK: Run tests, verify no regressions

Phase 3: Cleanup (15 min)
├─ Remove dead code
├─ Update comments
└─ Final review

BREAK: Commit, deploy if safe
```

### Template D: Sprint Planning / Analysis

**Best for:** Understanding codebase, planning features

```
Session Goal: Plan implementation of [feature]
Duration: 1 hour

Phase 1: Codebase Exploration (30 min)
├─ Understand current architecture
├─ Find relevant files/patterns
├─ Identify integration points
└─ Note dependencies

Phase 2: Design (20 min)
├─ Sketch data models
├─ Design API contracts
├─ Plan UI components
└─ Identify risks

Phase 3: Documentation (10 min)
├─ Write implementation plan
├─ List tasks with estimates
└─ Note open questions

Output: Design doc for next session (implementation)
```

---

## 6. Credit Optimization During Session

### Minimize Context Reloading

**Instead of:**
```
Request 1: "Add login endpoint"
[Loads full context, creates endpoint]

Request 2: "Now add logout endpoint"
[Reloads full context, creates endpoint]

Request 3: "Add session refresh endpoint"
[Reloads full context again]
```

**Do this:**
```
Request: "Add three auth endpoints to src/routes/auth.js:
1. POST /login - authenticate user
2. POST /logout - clear session
3. POST /refresh - refresh session token"

[Loads context once, creates all three]
```

**Savings: ~60-70% tokens**

### Use Specific File References

**Instead of:**
```
"Update the authentication logic to add rate limiting"
[AI searches entire codebase]
```

**Do this:**
```
"Update src/middleware/auth.js line 45 to add rate limiting using express-rate-limit"
[AI reads one specific file]
```

**Savings: ~50% tokens**

### Leverage Task Files

**Instead of:**
```
"I need to run security audit. Check for hardcoded secrets, verify input validation, scan dependencies, check authentication..."
[Long instructions each time]
```

**Do this:**
```
"Run the security review task from tasks/security-review.md"
[Clear, repeatable, comprehensive]
```

**Savings: ~80% tokens**

### Batch Read-Only Operations

**Instead of:**
```
Request 1: "Review auth.js for security issues"
Request 2: "Review api.js for security issues"
Request 3: "Review database.js for security issues"
```

**Do this:**
```
"Review these files for security issues:
- src/middleware/auth.js
- src/routes/api.js
- src/config/database.js

Focus on: hardcoded secrets, injection vulnerabilities, auth bypasses"
```

**Savings: ~40% tokens**

---

## 7. Session Plan Output Format

### Example Session Plan: Auth Implementation

```markdown
# Session Plan: User Authentication System

**Date:** 2026-02-06
**Estimated Duration:** 2.5 hours
**Credits Budgeted:** 50,000 tokens

---

## Session Goal
Implement basic user authentication with login, logout, and session management. Users can log in with Slack credentials, sessions persist for 24 hours, and protected routes require authentication.

**Success Criteria:**
- [ ] Login endpoint created and works
- [ ] Sessions persist across page refreshes
- [ ] Protected routes redirect to login
- [ ] Logout clears session
- [ ] Tests passing
- [ ] No security vulnerabilities introduced

**Out of Scope:**
- Password reset (next session)
- Multi-factor authentication (future)
- OAuth providers beyond Slack (future)

---

## Task List (Priority Order)

### ✅ Critical (Must Complete)
1. **Create auth API endpoints** - Medium - 45 min
   - POST /auth/login, POST /auth/logout, GET /auth/me
   - Why now: Core functionality, blocks UI work

2. **Set up session management** - Complex - 60 min
   - Configure express-session with MongoDB store
   - Add session middleware
   - Why now: Required for login to work

3. **Add authentication middleware** - Medium - 30 min
   - requireAuth middleware for protected routes
   - Redirect to login if not authenticated
   - Why now: Secures protected routes

4. **Create login UI** - Simple - 20 min
   - Login page with Slack OAuth button
   - Why now: User-facing, needed to test flow

### ⚡ High Value (Should Complete)
5. **Add rate limiting** - Simple - 15 min
   - Prevent brute force on login endpoint
   - Why: Security best practice

6. **Write auth tests** - Medium - 40 min
   - Test login flow, logout, protected routes
   - Why: Prevent regressions

### 💡 Nice-to-Have (If Time Permits)
7. **Update documentation** - Simple - 20 min
   - Document auth flow in README
   - Why: Help other developers

8. **Add "Remember me"** - Simple - 15 min
   - Extend session duration
   - Why: Better UX

---

## Batching Strategy

**Batch A: Backend Auth (Tasks 1-3)**
- All in src/routes/auth.js and src/middleware/
- Share context about session management
- Execute together in Phase 2

**Batch B: Frontend Auth (Task 4)**
- Separate from backend, different files
- Execute after backend is working

**Batch C: Security & Testing (Tasks 5-6)**
- Both enhance reliability
- Execute together at end

---

## Execution Plan

### Phase 1: Planning & Setup (15 min)
- Review current codebase structure
- Verify express-session is installed
- Check MongoDB connection working
- Plan API contract

**Break Point:** Commit design decisions

### Phase 2: Core Backend (90 min)
- Create auth endpoints (Task 1)
- Set up session management (Task 2)
- Add auth middleware (Task 3)
- Test with curl/Postman

**Break Point:** Test auth flow, commit "Add authentication backend"

### Phase 3: Frontend (20 min)
- Create login UI (Task 4)
- Test full user flow in browser

**Break Point:** Manual testing, commit "Add login UI"

### Phase 4: Security & Quality (55 min)
- Add rate limiting (Task 5)
- Write auth tests (Task 6)
- Run full test suite

**Break Point:** All tests passing, commit "Add auth security and tests"

### Phase 5: Polish (20 min, if time allows)
- Update docs (Task 7)
- Add "Remember me" (Task 8)

**Break Point:** Final commit, deploy to staging

---

## Dependencies

```
Task 1 (endpoints) → Task 4 (UI needs working endpoints)
Task 2 (sessions) → Task 1 (endpoints need sessions)
Task 3 (middleware) → Task 2 (middleware uses sessions)
Tasks 5-6 (testing) → Tasks 1-3 (need working auth to test)
```

**Execution Order:**
2 (sessions) → 1 (endpoints) → 3 (middleware) → 4 (UI) → 5,6 (security/tests) → 7,8 (polish)

---

## Break Points & Testing

**After Session Setup (15 min)**
✋ Verify environment ready, design clear

**After Backend Complete (90 min)**
✋ Test: `curl -X POST /auth/login` works
✋ Test: Protected routes require auth
✋ Commit: "Add authentication backend"

**After Frontend Complete (20 min)**
✋ Test: Full login flow in browser
✋ Test: Session persists on refresh
✋ Commit: "Add login UI"

**After Security (55 min)**
✋ Test: Rate limiting blocks rapid attempts
✋ Test: All test suite passes
✋ Commit: "Add auth security and tests"

---

## Deferred to Next Session

**Not doing today:**
- Password reset flow (separate feature)
- Social login beyond Slack (not urgent)
- Admin user management UI (separate session)
- Two-factor authentication (future enhancement)

**Backlog items:**
- Fix unrelated bug in decision export
- Refactor database connection pooling
- Update landing page copy

---

## Session Notes

**If running behind:**
1. Skip Phase 5 (polish) - defer Tasks 7-8
2. Skip Task 6 (tests) if really tight - but prioritize for next session
3. DO NOT skip rate limiting (Task 5) - security critical

**If ahead of schedule:**
1. Add more comprehensive tests
2. Start documentation updates
3. Begin admin panel planning (research only)

**Credit Usage Strategy:**
- Batch Tasks 1-3 in single request (save ~40%)
- Use specific file paths (save ~50% per request)
- Leverage existing patterns from codebase (faster)

**Estimated Token Usage:**
- Phase 1: ~5,000 tokens (planning)
- Phase 2: ~20,000 tokens (backend implementation)
- Phase 3: ~5,000 tokens (frontend)
- Phase 4: ~15,000 tokens (testing/security)
- Phase 5: ~3,000 tokens (polish)
- **Total: ~48,000 tokens** (within budget)
```

---

## 8. Session Types & Strategies

### Deep Work Session (2-4 hours)
**Best for:** Complex features, architecture work
**Strategy:**
- Block calendar, minimize interruptions
- Start with highest-context work
- Take 10-min breaks every 90 minutes
- Plan for fatigue in later phases

### Quick Win Session (30-60 min)
**Best for:** Bug fixes, small features, config updates
**Strategy:**
- Pick 3-5 simple tasks
- All low-context, independent
- No architecture work
- Commit each task separately

### Exploration Session (1-2 hours)
**Best for:** Understanding codebase, planning, research
**Strategy:**
- Read-only operations (no coding)
- Document findings
- Create implementation plans
- Generate task lists for future sessions

### Cleanup Session (1-2 hours)
**Best for:** Tech debt, refactoring, documentation
**Strategy:**
- Pick one area to clean
- Tests first (safety net)
- Incremental improvements
- Commit frequently

---

## 9. Warning Signs & Adjustments

### Session Going Off Track

**Warning Signs:**
- ⚠️ Still on first task after 30% of time
- ⚠️ Unclear what "done" means
- ⚠️ Scope keeps expanding
- ⚠️ No commits after 60 minutes
- ⚠️ Getting frustrated or confused

**Immediate Actions:**
1. **STOP** - Don't keep digging
2. **Assess** - What's blocking progress?
3. **Decide:**
   - Simplify scope (cut nice-to-haves)
   - Take break (mental reset)
   - Defer complex task (do simple ones)
   - End session early (avoid bad commits)

### Scope Creep

**Example:**
```
Original: "Add login endpoint"
↓
"Oh, also need logout"
↓
"And password reset"
↓
"And email verification"
↓
"And OAuth providers"
```

**Prevention:**
- Write explicit out-of-scope list
- Capture new ideas in backlog
- Finish original scope first
- Review scope before each task

### Context Fatigue

**Symptoms:**
- Making careless mistakes
- Re-reading same code multiple times
- Forgetting what you just did
- Slower progress on each task

**Response:**
1. Take 15-minute break (walk, water, snack)
2. Switch to low-context tasks
3. Commit current work
4. Consider ending session

---

## 10. Post-Session Review

### After Each Session

**What Went Well:**
- Tasks completed as planned?
- Credit usage within budget?
- Code quality maintained?
- No regressions introduced?

**What Went Wrong:**
- Tasks took longer than estimated?
- Scope creep occurred?
- Credit usage higher than expected?
- Unexpected blockers?

**Lessons Learned:**
- Better task estimation
- Improved batching strategies
- Context management insights
- Planning improvements

**Capture Metrics:**
```
Session Date: 2026-02-06
Duration: 2.5 hours (planned 2.5)
Credits Used: 52,000 (budgeted 50,000)
Tasks Completed: 6/8 (75%)
Must-haves: 4/4 (100%) ✅
Should-haves: 2/2 (100%) ✅
Nice-to-haves: 0/2 (0%)

Deferred to Next Session:
- Documentation update
- "Remember me" feature
```

---

## 11. Templates & Quick Reference

### Quick Session Planner (5-Minute Version)

```markdown
**Goal:** [One sentence]

**Must-Haves:**
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

**Should-Haves:**
- [ ] Task 4
- [ ] Task 5

**Order:** [Numbered execution order]

**Break Points:** After task X, Y, Z

**Estimated Time:** X hours

**Credit Budget:** X tokens
```

### Pre-Session Checklist (2-Minute Version)

```markdown
- [ ] Git clean
- [ ] Environment ready
- [ ] Tests passing
- [ ] Goal clear
- [ ] Tasks prioritized
- [ ] Time allocated
```

### Mid-Session Check (1-Minute Version)

```markdown
- [ ] On track with time?
- [ ] Must-haves still achievable?
- [ ] Scope still controlled?
- [ ] Code committed recently?
- [ ] Energy level okay?
```

---

## Notes

- **Planning time:** 5-15 minutes pays off in 2-4 hour sessions
- **Flexibility:** Plans should guide, not constrain
- **Commit often:** Every 30-60 minutes or after each complete task
- **Know when to stop:** Better to end early than force bad code
- **Learn from sessions:** Review and adjust planning over time

## Related Tasks

- `tasks/credit-optimization.md` - Minimize token usage during session
- `tasks/tech-debt.md` - Cleanup session planning
- `tasks/update-docs.md` - Documentation session planning

---

**Proper planning prevents poor performance. Plan your work, work your plan!**
