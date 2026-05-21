# Technical Debt Cleanup

Perform a comprehensive technical debt analysis and cleanup for Corteza.

## Description
This task systematically reviews the codebase to identify and prioritize technical debt, code quality issues, security vulnerabilities, and opportunities for improvement.

## When to Use
- Before major releases or beta launches
- After rapid development sprints
- When code quality metrics decline
- Before significant refactoring efforts
- Quarterly maintenance cycles

## Code Quality Scan

### 1. Unused Code
- [ ] Identify unused imports, variables, and functions
- [ ] Find and remove commented-out code blocks
- [ ] Remove dead code paths
- [ ] Identify unused dependencies in package.json

### 2. Code Documentation
- [ ] Locate all TODO, FIXME, and HACK comments
- [ ] Verify all public functions have JSDoc comments
- [ ] Check for missing README sections
- [ ] Ensure API endpoints are documented

### 3. Code Complexity
- [ ] Flag duplicate code patterns (DRY violations)
- [ ] Identify overly complex functions (>50 lines or high cyclomatic complexity)
- [ ] Check for deeply nested conditionals (>3 levels)
- [ ] Look for long parameter lists (>5 parameters)

### 4. Code Consistency
- [ ] Check for inconsistent naming conventions (camelCase vs snake_case)
- [ ] Verify consistent file structure and organization
- [ ] Ensure consistent error handling patterns
- [ ] Check for consistent async/await vs callback usage

## Code Health Checks

### 1. Linting & Formatting
- [ ] Run ESLint and fix auto-fixable issues
- [ ] Check for console.log statements in production code
- [ ] Verify consistent indentation and spacing
- [ ] Remove trailing whitespace

### 2. Error Handling
- [ ] Look for missing or inadequate error handling
- [ ] Check for proper try-catch blocks in async operations
- [ ] Verify all API endpoints have error responses
- [ ] Ensure database operations have error handling

### 3. Logging
- [ ] Check for proper logging instead of console.log
- [ ] Verify sensitive data is not logged
- [ ] Ensure error logs include context
- [ ] Add structured logging where missing

## Dependencies & Security

### 1. Dependency Audit
- [ ] Check for unused packages in package.json
- [ ] Identify outdated dependencies
- [ ] Run `npm audit` to find security vulnerabilities
- [ ] Check for deprecated package usage
- [ ] Remove unused devDependencies

### 2. Security Review
- [ ] Verify environment variables are not hardcoded
- [ ] Check for SQL injection vulnerabilities
- [ ] Verify API keys are properly secured
- [ ] Check for XSS vulnerabilities
- [ ] Ensure CSRF protection is in place
- [ ] Review authentication and authorization logic

## Database & Data Quality

- [ ] Check for missing indexes on frequently queried fields
- [ ] Identify slow queries or N+1 problems
- [ ] Verify proper data validation
- [ ] Check for database connection leaks
- [ ] Ensure proper transaction handling

## Performance

- [ ] Identify memory leaks
- [ ] Check for inefficient loops or algorithms
- [ ] Look for missing pagination on large datasets
- [ ] Verify proper caching strategies
- [ ] Check bundle sizes and optimize if needed

## Testing

- [ ] Calculate test coverage
- [ ] Identify untested critical paths
- [ ] Check for flaky tests
- [ ] Verify test isolation
- [ ] Ensure tests run quickly (<30s for unit tests)

## Output Format

Generate a prioritized summary report with:

### **Critical** (Fix Immediately)
- Security vulnerabilities
- Broken functionality
- Data corruption risks
- Memory leaks
- Authentication/authorization issues

### **High** (Fix This Sprint)
- Performance bottlenecks
- Missing error handling in critical paths
- Deprecated dependencies with breaking changes
- Major code smells
- Missing tests for core features

### **Medium** (Fix Next Sprint)
- Missing documentation
- Minor refactoring opportunities
- Non-critical TODO items
- Code duplication
- Moderate complexity issues

### **Low** (Backlog)
- Style inconsistencies
- Optional improvements
- Nice-to-have features
- Minor optimizations

## Issue Report Template

For each issue, provide:

```markdown
### [PRIORITY] Issue Title

**Location**: `path/to/file.js:123`

**Problem**:
Clear description of what's wrong.

**Impact**:
How this affects users, performance, or maintainability.

**Recommended Fix**:
Specific steps to resolve the issue.

**Estimated Effort**: Small (< 1hr) | Medium (1-4hrs) | Large (> 4hrs)

**Code Example** (if applicable):
```javascript
// Before
badCode();

// After
goodCode();
```
```

## Execution Steps

1. **Preparation**
   ```bash
   # Make sure you're on latest main
   git checkout main
   git pull origin main

   # Create analysis branch
   git checkout -b tech-debt/analysis-$(date +%Y%m%d)
   ```

2. **Run Automated Tools**
   ```bash
   # Run linter
   npm run lint

   # Check for security issues
   npm audit

   # Check for outdated packages
   npm outdated
   ```

3. **Manual Review**
   - Review each file in src/ directory
   - Check for patterns mentioned above
   - Document findings in a report

4. **Generate Report**
   - Create `tech-debt-report-YYYY-MM-DD.md` in `/docs` directory
   - Categorize issues by priority
   - Include metrics (LOC, complexity, coverage)

5. **Create Tracking Issues**
   - For each Critical/High priority item, create a GitHub issue
   - Label appropriately (tech-debt, bug, security, performance)
   - Assign to relevant milestone

## Validation

- [ ] Report generated with all sections completed
- [ ] GitHub issues created for Critical/High priority items
- [ ] Team review meeting scheduled
- [ ] Action plan created with timeline

## Success Metrics

- Reduction in TODO/FIXME comments
- Improved test coverage (target: >80%)
- Reduced cyclomatic complexity
- No critical security vulnerabilities
- All dependencies up to date
- Improved load times (if performance issues found)

## Rollback

This is an analysis task, no rollback needed. Implementation of fixes will be done in separate tasks.

## Notes

- **Frequency**: Run this analysis quarterly or before major releases
- **Time Estimate**: 4-8 hours for full analysis
- **Collaboration**: Involve the full team in prioritization
- **Balance**: Don't let perfect be the enemy of good - prioritize ruthlessly
- **Documentation**: Keep the report for historical reference and tracking improvements

## Related Tasks

- `deployment/pre-release-checklist.md`
- `maintenance/security-audit.md`
- `development/code-review-guidelines.md`

## Tools & Resources

- ESLint: JavaScript linting
- npm audit: Security vulnerability scanning
- Lighthouse: Performance auditing (for frontend)
- CodeClimate / SonarQube: Code quality metrics
- GitHub Dependabot: Automated dependency updates
