# Update Documentation

Review and update all project documentation to ensure accuracy and completeness.

## Description
This task systematically reviews all documentation files to ensure they accurately reflect the current state of the codebase, recent features, and implementation details.

## When to Use
- After major feature additions
- Before beta launches or releases
- When onboarding new team members
- After significant refactoring
- Quarterly maintenance cycles
- When user feedback indicates confusion

## README.md Review

### 1. Features Section
- [ ] Verify all current features are listed
- [ ] Check for removed features that should be deleted
- [ ] Update feature descriptions to match actual implementation
- [ ] Verify memory types are accurate (decision, explanation, context, learning, risk, assumption)
- [ ] Check that multi-entry point architecture is documented (Slack, Dashboard, API)
- [ ] Verify API Keys section is mentioned
- [ ] Check Settings page is documented

### 2. Installation Instructions
- [ ] Test installation steps from scratch
- [ ] Verify all commands work as documented
- [ ] Check Node.js version requirement is current
- [ ] Verify npm install works without errors
- [ ] Test environment setup instructions
- [ ] Verify Railway deployment steps are accurate

### 3. Environment Variables
- [ ] Compare .env.example with actual required variables
- [ ] Check that all new variables are documented (API keys, encryption keys, etc.)
- [ ] Verify SECRET generation instructions are correct
- [ ] Check for deprecated variables that should be removed
- [ ] Ensure SLACK_STATE_SECRET is documented
- [ ] Ensure ENCRYPTION_KEY is documented
- [ ] Verify BRAINTRUST_API_KEY is in .env.example

### 4. Usage Examples
- [ ] Test all slash command examples
- [ ] Verify modal field descriptions match actual implementation
- [ ] Check dashboard usage examples are accurate
- [ ] Update screenshots if UI has changed significantly
- [ ] Verify API endpoint examples work

### 5. Architecture Diagram
- [ ] Check diagram reflects current architecture
- [ ] Verify all integrations are shown (Slack, MongoDB, Anthropic, OpenAI, Jira)
- [ ] Add new components (API Keys, Settings page, multi-entry points)
- [ ] Update data flow if changed

### 6. Project Structure
- [ ] Compare documented structure with actual src/ directory
- [ ] Add new files created (settings.html, api-keys.js, api-key-auth.js, dashboard-auth.js, etc.)
- [ ] Remove files that no longer exist
- [ ] Verify directory descriptions are accurate
- [ ] Check that routes are correctly categorized

### 7. Database Schema
- [ ] Verify all collections are documented
- [ ] Check field names match actual implementation
- [ ] Add new collections (api_keys)
- [ ] Update existing collection schemas if changed
- [ ] Document new fields (source, category, etc.)

### 8. Links and References
- [ ] Test all markdown links work
- [ ] Verify external links are not broken
- [ ] Check internal file references point to existing files
- [ ] Update GitHub repository URLs if changed

## CHANGELOG.md Review

### 1. Recent Changes
- [ ] Add latest features to changelog
- [ ] Document multi-entry point architecture
- [ ] Document dashboard memory logging
- [ ] Document API Keys feature
- [ ] Document Settings page
- [ ] Document expanded memory types (6 types now)
- [ ] Document source tracking
- [ ] Document Coda Pack integration (if public)

### 2. Version Numbering
- [ ] Determine current version number
- [ ] Follow semantic versioning (MAJOR.MINOR.PATCH)
- [ ] Update version in package.json to match
- [ ] Create new version section for unreleased changes

### 3. Migration Guides
- [ ] Document breaking changes (if any)
- [ ] Provide migration steps for major updates
- [ ] List required environment variable updates
- [ ] Document database migration steps (if needed)

### 4. Categorization
- [ ] Use consistent categories (Added, Changed, Deprecated, Removed, Fixed, Security)
- [ ] Group related changes together
- [ ] Use clear, user-friendly descriptions

## Code Documentation

### 1. Module Docstrings
- [ ] Check all major modules have file-level comments
- [ ] Verify purpose and usage are clear
- [ ] Document module dependencies
- [ ] Add examples for complex modules

### 2. Function Documentation
- [ ] Review functions in src/routes/ for JSDoc comments
- [ ] Review functions in src/services/ for JSDoc comments
- [ ] Review functions in src/middleware/ for JSDoc comments
- [ ] Document parameters and return types
- [ ] Add usage examples for complex functions
- [ ] Document error conditions and exceptions

### 3. Inline Comments
- [ ] Check for outdated comments referencing old behavior
- [ ] Remove commented-out code blocks
- [ ] Add comments for complex logic
- [ ] Verify TODO/FIXME comments are still relevant
- [ ] Check that comments explain "why" not "what"

### 4. API Endpoint Documentation
- [ ] List all public API endpoints
- [ ] Document request parameters
- [ ] Document response formats
- [ ] Include authentication requirements
- [ ] Provide curl examples
- [ ] Document error responses

## Additional Documentation Files

### 1. BETA_TESTER_GUIDE.md
- [ ] Verify setup steps are current
- [ ] Test onboarding flow as new user
- [ ] Update feature descriptions
- [ ] Check troubleshooting section
- [ ] Verify screenshots are current

### 2. SELF_HOSTING_GUIDE.md
- [ ] Test deployment steps on Railway
- [ ] Verify MongoDB Atlas setup instructions
- [ ] Check Slack app configuration steps
- [ ] Update environment variable list
- [ ] Verify OAuth setup instructions
- [ ] Test troubleshooting steps

### 3. .env.example
- [ ] Add all new environment variables
- [ ] Remove deprecated variables
- [ ] Add helpful comments for each variable
- [ ] Include generation commands for secrets
- [ ] Group related variables together

### 4. API Documentation
- [ ] Create API.md if public API exists
- [ ] Document all /api/* endpoints
- [ ] Document authentication methods (session vs API key)
- [ ] Provide request/response examples
- [ ] Document rate limiting
- [ ] Include integration examples (Coda Pack)

### 5. Architecture Documents
- [ ] Review ARCHITECTURE.md if exists
- [ ] Update system diagrams
- [ ] Document design decisions
- [ ] Explain key technical choices
- [ ] Document security model

## New Documentation Needed

### 1. Missing Guides
- [ ] Multi-Entry Point Guide (Slack vs Dashboard vs API)
- [ ] API Integration Guide (for Coda, Zapier, etc.)
- [ ] Memory Types Guide (when to use each type)
- [ ] Search Best Practices
- [ ] Admin Guide (permissions, settings, management)

### 2. Developer Documentation
- [ ] Local development setup
- [ ] Testing guide
- [ ] Contributing guidelines
- [ ] Code style guide
- [ ] Git workflow

### 3. User Documentation
- [ ] FAQ document
- [ ] Common use cases and patterns
- [ ] Video tutorials or GIFs
- [ ] Keyboard shortcuts
- [ ] Tips and tricks

## Output Format

Generate a comprehensive documentation gap report with:

### **Critical Gaps** (Must Fix Before Beta)
- Missing critical setup information
- Incorrect installation steps
- Broken links in main documentation
- Missing required environment variables
- Outdated security instructions

### **High Priority** (Fix This Week)
- Inaccurate feature descriptions
- Missing recent features in README
- Outdated architecture diagrams
- Missing API documentation
- Incorrect code examples

### **Medium Priority** (Fix This Sprint)
- Incomplete project structure
- Missing function documentation
- Outdated screenshots
- Missing usage examples
- Incomplete CHANGELOG

### **Low Priority** (Backlog)
- Missing developer guides
- Code style documentation
- Enhanced examples
- Video tutorials
- Additional architecture docs

## Documentation Gap Template

For each gap, provide:

```markdown
### [PRIORITY] Documentation Gap Title

**Location**: `path/to/file.md:section` or `NEW FILE NEEDED`

**Issue**:
Clear description of what's missing, outdated, or incorrect.

**Current State**:
What the documentation currently says (or "Not documented").

**Expected State**:
What it should say to be accurate and helpful.

**Impact**:
How this affects users, developers, or deployment.

**Recommended Fix**:
Specific steps to resolve the issue.

**Estimated Effort**: Small (< 30min) | Medium (30min-2hr) | Large (> 2hr)

**Code/Text Example** (if applicable):
```markdown
# Before
Old or missing content

# After
Corrected content
```
```

## Execution Steps

1. **Preparation**
   ```bash
   # Make sure you're on latest main
   git checkout main
   git pull origin main

   # Create documentation review branch
   git checkout -b docs/update-$(date +%Y%m%d)
   ```

2. **Systematic Review**
   - Review README.md section by section
   - Check all links (internal and external)
   - Compare documented structure with actual codebase
   - Test all example commands and code snippets
   - Review environment variable documentation

3. **CHANGELOG Update**
   - Review git commits since last release
   - Categorize changes appropriately
   - Write user-friendly descriptions
   - Update version numbers

4. **Code Documentation Review**
   - Scan all major modules for docstrings
   - Check critical functions have JSDoc comments
   - Verify API endpoints are documented
   - Look for outdated inline comments

5. **Generate Gap Report**
   - Create `docs-gap-report-YYYY-MM-DD.md`
   - Categorize by priority
   - Include specific file locations
   - Provide recommended fixes

6. **Create Issues**
   - For each Critical/High priority gap, create GitHub issue
   - Label as "documentation"
   - Assign to relevant milestone

## Validation

- [ ] All README links tested and working
- [ ] Installation steps tested from scratch
- [ ] Environment variables match .env.example and actual code
- [ ] CHANGELOG includes all recent changes
- [ ] Code examples tested and working
- [ ] No broken internal file references
- [ ] Gap report generated and reviewed

## Success Metrics

- All critical documentation gaps resolved
- README accurately reflects current features
- Installation success rate for new users: 95%+
- No broken links in main documentation
- CHANGELOG up to date with latest version
- All public APIs documented
- User feedback shows improved clarity

## Rollback

This is a documentation task, no code rollback needed. Git allows reverting documentation changes if needed.

## Notes

- **Frequency**: Run before each release and quarterly
- **Time Estimate**: 3-5 hours for full review
- **Collaboration**: Get feedback from beta testers on clarity
- **Balance**: Focus on accuracy over perfection
- **User-First**: Write for the audience (users, developers, admins)

## Related Tasks

- `tasks/tech-debt.md` - May identify code needing documentation
- `deployment/pre-release-checklist.md` - Documentation is part of release
- `development/feature-completion-checklist.md` - Features need docs

## Tools & Resources

- **Link Checking**: markdown-link-check, broken-link-checker
- **Markdown Linting**: markdownlint
- **Diagrams**: Mermaid.js, draw.io, Excalidraw
- **Screenshots**: CloudApp, Monosnap, Annotely
- **Documentation Hosting**: GitHub Pages, GitBook, Read the Docs

## Common Documentation Mistakes

- **Outdated examples**: Code examples that don't match current API
- **Broken links**: Internal references to renamed/moved files
- **Missing prerequisites**: Assuming user knowledge without stating it
- **Unclear instructions**: Steps that skip important details
- **No troubleshooting**: Common errors not documented
- **Missing visuals**: Complex concepts without diagrams
- **Inconsistent terminology**: Using different terms for same concept
- **Copy-paste errors**: Examples with placeholder values not updated

## Documentation Quality Checklist

### Clarity
- [ ] Technical terms are defined
- [ ] Jargon is minimized
- [ ] Steps are numbered and sequential
- [ ] Complex ideas have examples

### Completeness
- [ ] All features are documented
- [ ] All commands have examples
- [ ] Error messages are explained
- [ ] Edge cases are covered

### Accuracy
- [ ] Code examples are tested
- [ ] Links are working
- [ ] Version numbers are correct
- [ ] Screenshots are current

### Accessibility
- [ ] Clear table of contents
- [ ] Logical organization
- [ ] Good formatting (headers, lists, code blocks)
- [ ] Searchable keywords included

---

**Documentation is a feature. Keep it accurate, helpful, and current!**
