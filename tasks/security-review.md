# Security Review

Perform a comprehensive security audit of the Corteza codebase to identify vulnerabilities, security misconfigurations, and potential attack vectors.

## Description
This task systematically reviews the application for security vulnerabilities across code, configuration, dependencies, and deployment. It produces a prioritized list of security issues with remediation guidance.

## When to Use
- Before production launches or major releases
- After significant feature additions
- Quarterly security audits
- After security incidents or vulnerability disclosures
- Before security certifications (SOC 2, ISO 27001)
- When onboarding security-sensitive customers

## Security Review Checklist

---

## 1. Secrets & Credentials Management

### 1.1 Hardcoded Secrets
**Check for:**
- [ ] API keys hardcoded in source files
- [ ] Database passwords in code
- [ ] Encryption keys committed to git
- [ ] Session secrets in code
- [ ] OAuth client secrets in code
- [ ] Private keys or certificates

**Commands:**
```bash
# Search for common secret patterns
grep -r "api_key\s*=\s*['\"]" src/
grep -r "password\s*=\s*['\"]" src/
grep -r "secret\s*=\s*['\"]" src/
grep -r "token\s*=\s*['\"]xox" src/
grep -r "AKIA" src/  # AWS access keys
grep -r "sk-" src/   # OpenAI/Anthropic keys

# Check git history for leaked secrets
git log -p | grep -i "api_key\|password\|secret"

# Use automated tools
npx secretlint "**/*"
```

**Critical Issues:**
- Any hardcoded secrets in `src/` directory
- Secrets committed to git history
- `.env` file committed to repository

**Remediation:**
- Move all secrets to environment variables
- Use `.env.example` with placeholder values
- Add `.env` to `.gitignore`
- Rotate any exposed credentials immediately
- Use secret management tools (AWS Secrets Manager, Vault)

### 1.2 Environment Variable Usage
**Verify:**
- [ ] All sensitive data uses `process.env.*`
- [ ] No default fallback values for secrets (e.g., `process.env.API_KEY || 'default-key'`)
- [ ] Environment validation on startup
- [ ] Required secrets documented in README

**Check files:**
- `src/config/environment.js` - Validate all secrets are loaded from env
- `.env.example` - Contains all required variables with placeholders
- `README.md` - Documents all environment variables

**Example - Good:**
```javascript
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is required');
}
const apiKey = process.env.ANTHROPIC_API_KEY;
```

**Example - Bad:**
```javascript
const apiKey = process.env.ANTHROPIC_API_KEY || 'sk-default-key'; // NEVER do this
```

### 1.3 Git History Scan
**Check for:**
- [ ] Secrets in previous commits
- [ ] `.env` files ever committed
- [ ] Credential files in history

**Commands:**
```bash
# Scan git history for secrets
git log --all --full-history --source -- **/.env
git log -p --all -S "ANTHROPIC_API_KEY" | grep "+"

# Use tools
npm install -g gitleaks
gitleaks detect --source . --verbose
```

**Remediation if secrets found:**
1. Rotate all exposed credentials immediately
2. Use `git filter-branch` or BFG Repo-Cleaner to remove from history
3. Force push to all branches (coordinate with team)
4. Notify affected services

---

## 2. Injection Vulnerabilities

### 2.1 SQL/NoSQL Injection
**MongoDB Injection Checks:**
- [ ] User input used directly in MongoDB queries
- [ ] Proper use of parameterized queries
- [ ] Input validation before database operations
- [ ] No use of `$where` operator with user input

**Check files:**
- `src/routes/api.js` - All database queries
- `src/routes/semantic-search-api.js` - Search queries
- `src/services/semantic-search.js` - Hybrid search

**Example - Vulnerable:**
```javascript
// BAD - User input directly in query
const user = await db.collection('users').findOne({
  email: req.body.email  // If email is an object: { $ne: null }, bypasses auth!
});
```

**Example - Secure:**
```javascript
// GOOD - Validate input type first
const email = String(req.body.email).trim();
if (!email || typeof email !== 'string') {
  return res.status(400).json({ error: 'Invalid email' });
}
const user = await db.collection('users').findOne({ email });
```

**Critical Patterns to Find:**
```bash
# Search for potentially unsafe MongoDB queries
grep -r "findOne({" src/ | grep "req.body\|req.query\|req.params"
grep -r "find({" src/ | grep "req.body\|req.query\|req.params"
grep -r "\$where" src/
grep -r "eval(" src/
```

**Remediation:**
- Always validate and sanitize user input
- Use TypeScript or runtime type checking (Zod, Joi)
- Never use `$where` operator with user input
- Use MongoDB's built-in sanitization

### 2.2 XSS (Cross-Site Scripting)
**Check for:**
- [ ] Unescaped user input in HTML templates
- [ ] Use of `innerHTML` with user data
- [ ] User input in JavaScript contexts
- [ ] Proper Content-Security-Policy headers

**Check files:**
- `src/views/dashboard.html` - All user data rendering
- `src/views/settings.html` - Settings display
- `src/views/ai-analytics.html` - Analytics rendering

**Example - Vulnerable:**
```html
<!-- BAD - Directly inserting user input -->
<div id="decision-text">
  <script>
    document.getElementById('decision-text').innerHTML = decisionData.text;
  </script>
</div>
```

**Example - Secure:**
```html
<!-- GOOD - Using textContent -->
<div id="decision-text">
  <script>
    document.getElementById('decision-text').textContent = decisionData.text;
  </script>
</div>
```

**Critical Patterns to Find:**
```bash
# Search for XSS vulnerabilities
grep -r "innerHTML" src/views/
grep -r "document.write" src/views/
grep -r "eval(" src/
grep -r "dangerouslySetInnerHTML" src/
```

**Content-Security-Policy Check:**
```javascript
// Verify CSP headers in src/middleware/auth.js
// Should NOT allow 'unsafe-inline' or 'unsafe-eval'
```

**Remediation:**
- Use `textContent` instead of `innerHTML`
- Implement strict CSP headers
- Sanitize HTML input (use DOMPurify if needed)
- Escape user data in templates
- Enable XSS protection headers

### 2.3 Command Injection
**Check for:**
- [ ] User input passed to `exec`, `spawn`, or `eval`
- [ ] File paths constructed from user input
- [ ] Shell commands with user data

**Critical Patterns to Find:**
```bash
grep -r "exec(" src/
grep -r "spawn(" src/
grep -r "eval(" src/
grep -r "Function(" src/
```

**Example - Vulnerable:**
```javascript
// BAD - User input in shell command
const filename = req.body.filename;
exec(`cat ${filename}`, callback);  // Can execute: cat file.txt; rm -rf /
```

**Example - Secure:**
```javascript
// GOOD - Use libraries, not shell commands
const filename = path.basename(req.body.filename);  // Sanitize path
if (!/^[a-zA-Z0-9_-]+\.txt$/.test(filename)) {
  return res.status(400).json({ error: 'Invalid filename' });
}
const content = await fs.readFile(path.join('/safe/dir', filename));
```

---

## 3. Authentication & Authorization

### 3.1 Authentication Security
**Check for:**
- [ ] All protected routes require authentication
- [ ] Session secrets are strong and rotated
- [ ] Session cookies have secure flags
- [ ] No authentication bypass vulnerabilities
- [ ] Proper logout functionality

**Check files:**
- `src/middleware/auth.js` - Auth middleware
- `src/routes/auth.js` - Auth endpoints
- `src/config/session.js` - Session configuration

**Session Security Checklist:**
```javascript
// Verify in src/config/session.js
{
  secret: process.env.SESSION_SECRET,  // Strong, random, 32+ chars
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,        // HTTPS only (should be true in production)
    httpOnly: true,      // Prevent XSS access
    sameSite: 'lax',     // CSRF protection
    maxAge: 24 * 60 * 60 * 1000  // Reasonable expiry
  }
}
```

**Critical Issues:**
- `secure: false` in production
- Missing `httpOnly` flag
- No session secret or weak secret
- Sessions never expire

**Test for Authentication Bypass:**
```bash
# Try accessing protected endpoints without auth
curl http://localhost:3000/api/decisions
curl http://localhost:3000/dashboard

# Try with invalid session
curl -H "Cookie: connect.sid=invalid" http://localhost:3000/api/decisions

# Verify proper 401 responses
```

### 3.2 Authorization Security
**Check for:**
- [ ] Users can only access their workspace data
- [ ] Admin checks are properly enforced
- [ ] No vertical privilege escalation (user → admin)
- [ ] No horizontal privilege escalation (workspace A → workspace B)
- [ ] Proper permission checks on edit/delete operations

**Check files:**
- `src/middleware/auth.js` - `requireWorkspaceAccess`
- `src/middleware/admin-check.js` - `requireWorkspaceAdmin`
- `src/routes/api.js` - Edit/delete decision endpoints

**Critical Checks:**
```javascript
// Every sensitive operation should verify:
// 1. User is authenticated
// 2. User belongs to workspace
// 3. User has permission for action

// Example - DELETE /api/decisions/:id
// Must check:
// - User is logged in (requireAuth)
// - Decision belongs to user's workspace
// - User is admin OR decision creator
```

**Test for Authorization Bypass:**
```bash
# As User A, try to access User B's workspace data
# As non-admin, try to access admin endpoints
# As user from Workspace 1, try to edit Workspace 2 decision
```

**Common Vulnerabilities:**
- Missing workspace_id check in queries
- Admin checks not enforced on sensitive endpoints
- Direct object reference without permission check

### 3.3 OAuth Security
**Check for:**
- [ ] State parameter used for CSRF protection
- [ ] Proper redirect URI validation
- [ ] OAuth tokens stored securely
- [ ] No OAuth token leakage in logs or errors

**Check files:**
- `src/index.js` - OAuth configuration
- `src/config/installationStore.js` - Token storage

**Verify:**
```javascript
// In src/index.js OAuth config
installerOptions: {
  stateVerification: true,  // Must be true
  stateSecret: process.env.SLACK_STATE_SECRET  // Must be set
}
```

**Critical Issues:**
- `stateVerification: false`
- Missing or weak `stateSecret`
- OAuth tokens logged to console
- Tokens transmitted over HTTP

---

## 4. API Security

### 4.1 Rate Limiting
**Check for:**
- [ ] Rate limiting on all API endpoints
- [ ] Different limits for different endpoint types
- [ ] Rate limiting per user/IP
- [ ] Proper response codes (429)

**Check files:**
- `src/middleware/auth.js` - Rate limiter configuration

**Verify Rate Limiters:**
```javascript
// Should have different limits for:
// - Auth endpoints (stricter): authRateLimiter
// - API endpoints (moderate): apiRateLimiter
// - AI endpoints (strictest): aiRateLimiter
```

**Test Rate Limiting:**
```bash
# Send rapid requests to test rate limiting
for i in {1..150}; do
  curl http://localhost:3000/api/decisions
done

# Should return 429 after limit exceeded
```

**Critical Issues:**
- No rate limiting on critical endpoints
- Rate limits too high (allow brute force)
- No distinction between public/protected endpoints

### 4.2 Input Validation
**Check for:**
- [ ] All user inputs validated
- [ ] Type checking on request parameters
- [ ] Length limits on text fields
- [ ] Whitelist validation for enums
- [ ] File upload validation (type, size)

**Check files:**
- All files in `src/routes/` - Input validation

**Example - Good Validation:**
```javascript
// POST /api/memory/create
const { text, type, category } = req.body;

// Validate required fields
if (!text || typeof text !== 'string') {
  return res.status(400).json({ error: 'Text is required and must be string' });
}

// Validate length
if (text.length > 5000) {
  return res.status(400).json({ error: 'Text too long (max 5000 chars)' });
}

// Validate enum values
const validTypes = ['decision', 'explanation', 'context', 'learning', 'risk', 'assumption'];
if (type && !validTypes.includes(type)) {
  return res.status(400).json({ error: 'Invalid type' });
}
```

**Critical Patterns to Find:**
```bash
# Find endpoints with missing validation
grep -r "req.body\." src/routes/ | grep -v "if ("
grep -r "req.params\." src/routes/ | grep -v "if ("
```

### 4.3 CORS Configuration
**Check for:**
- [ ] CORS properly configured
- [ ] No wildcard origins in production (`*`)
- [ ] Credentials allowed only for trusted origins
- [ ] Proper preflight handling

**Check files:**
- `src/index.js` - CORS configuration

**Secure CORS Config:**
```javascript
// GOOD - Whitelist specific origins
const allowedOrigins = [
  'https://corteza.app',
  'https://www.corteza.app',
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
```

**Critical Issues:**
- `origin: '*'` with `credentials: true`
- No CORS configuration at all
- Overly permissive origins

### 4.4 API Key Security
**Check for:**
- [ ] API keys are randomly generated (crypto.randomBytes)
- [ ] API keys stored hashed or encrypted
- [ ] API key prefix for identification
- [ ] Revocation mechanism works
- [ ] Rate limiting per API key

**Check files:**
- `src/middleware/api-key-auth.js` - API key generation and validation
- `src/routes/api-keys.js` - API key management

**Verify Generation:**
```javascript
// Should use cryptographically secure random
const apiKey = 'corteza_' + crypto.randomBytes(32).toString('hex');

// Should NOT use:
// Math.random() - Not cryptographically secure
// Date.now() - Predictable
```

**Test API Keys:**
```bash
# Try reusing revoked key
# Try key from different workspace
# Try malformed keys
# Verify rate limiting per key
```

---

## 5. Data Security

### 5.1 Encryption at Rest
**Check for:**
- [ ] Sensitive data encrypted in database
- [ ] Proper encryption algorithm (AES-256-GCM)
- [ ] Encryption keys managed securely
- [ ] No plaintext sensitive data

**Check files:**
- `src/config/encryption.js` or `src/utils/encryption.js`
- `src/routes/settings-api.js` - Jira token encryption

**Verify Jira Token Encryption:**
```javascript
// Should use strong encryption
const algorithm = 'aes-256-gcm';  // Not AES-128 or weaker
const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);

// Check tokens are never logged or exposed
console.log(jiraSettings.api_token);  // Should NEVER see this
```

**Critical Issues:**
- Jira tokens stored in plaintext
- Weak encryption algorithm
- Encryption key hardcoded

### 5.2 Data Transmission Security
**Check for:**
- [ ] HTTPS enforced in production
- [ ] No sensitive data in URLs (use POST body)
- [ ] Proper TLS configuration
- [ ] No mixed content warnings

**Check files:**
- `src/index.js` - HTTPS redirect middleware
- `src/middleware/auth.js` - Secure cookie settings

**Verify HTTPS Enforcement:**
```javascript
// Should redirect HTTP to HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

**Critical Issues:**
- HTTP allowed in production
- Sensitive data in GET parameters
- `secure: false` on session cookies in production

### 5.3 Logging Security
**Check for:**
- [ ] No sensitive data in logs
- [ ] Passwords not logged
- [ ] API keys not logged
- [ ] PII properly redacted

**Scan Logs:**
```bash
# Search for potential sensitive data in logs
grep -r "console.log" src/ | grep -i "password\|api_key\|token\|secret"
grep -r "logger." src/ | grep -i "email\|ssn\|credit"

# Check specific files
grep "console.log" src/routes/api-keys.js
grep "console.log" src/routes/auth.js
grep "console.log" src/config/encryption.js
```

**Example - Bad:**
```javascript
console.log('User logged in:', user);  // May contain email, tokens
console.log('API Key generated:', apiKey);  // NEVER log full keys
```

**Example - Good:**
```javascript
console.log('User logged in:', user.id);  // Log ID only
console.log('API Key generated:', apiKey.slice(-8));  // Log last 8 chars only
```

---

## 6. Dependency Security

### 6.1 Known Vulnerabilities
**Scan for:**
- [ ] Vulnerable packages
- [ ] Outdated security-critical dependencies
- [ ] High/critical severity issues

**Commands:**
```bash
# NPM audit
npm audit

# Check for high/critical only
npm audit --audit-level=high

# Generate detailed report
npm audit --json > audit-report.json

# Use Snyk for deeper analysis
npx snyk test

# Check specific package
npm audit --package=express
```

**Critical Severity Response:**
1. Review vulnerability details
2. Check if exploitable in your context
3. Update package immediately if critical
4. Test after update
5. Deploy hotfix if needed

**Remediation:**
```bash
# Auto-fix if possible
npm audit fix

# Force fix (may introduce breaking changes)
npm audit fix --force

# Manual update
npm update package-name

# Check for breaking changes
npm outdated
```

### 6.2 Dependency Hygiene
**Check for:**
- [ ] Unused packages in package.json
- [ ] Dependencies from untrusted sources
- [ ] Lock file committed (package-lock.json)
- [ ] No wildcard versions in package.json

**Commands:**
```bash
# Find unused dependencies
npx depcheck

# Check for outdated packages
npm outdated

# Verify lock file integrity
npm ci
```

**Critical Issues:**
- Critical vulnerability in production dependency
- No package-lock.json committed
- Wildcard versions (`"express": "*"`)
- Dependencies from private/unknown registries

### 6.3 Supply Chain Security
**Check for:**
- [ ] Packages from npm registry only
- [ ] No git dependencies
- [ ] No local file dependencies in production
- [ ] Verify package integrity (checksums)

**Check package.json:**
```bash
# Look for suspicious sources
grep "git+" package.json
grep "file:" package.json
grep "http://" package.json  # Should be https://
```

---

## 7. Multi-Tenancy Security

### 7.1 Workspace Isolation
**Check for:**
- [ ] All queries filter by workspace_id
- [ ] No cross-workspace data access
- [ ] Workspace ID from session, not request
- [ ] No workspace enumeration attacks

**Critical Checks:**
```javascript
// Every database query MUST include workspace_id check
const decisions = await decisionsCollection.find({
  workspace_id: req.session.user.workspace_id  // From session, not req.body!
}).toArray();

// BAD - Allows workspace enumeration
const workspace = await db.collection('workspaces').findOne({
  id: req.params.workspace_id  // User controls this!
});

// GOOD - Use session
const workspace = await db.collection('workspaces').findOne({
  id: req.session.user.workspace_id  // Trusted source
});
```

**Test Workspace Isolation:**
```bash
# As user in Workspace A, try to:
# 1. Access Workspace B decisions
# 2. Modify workspace_id in request
# 3. Enumerate other workspace IDs
```

### 7.2 Admin Privilege Checks
**Check for:**
- [ ] Admin-only endpoints verify admin status
- [ ] No client-side admin checks only
- [ ] Admin status from database, not session directly
- [ ] Proper permission inheritance

**Check files:**
- `src/middleware/admin-check.js` - Admin verification
- `src/routes/permissions.js` - Permission management
- `src/routes/settings-api.js` - Settings (admin-only)

**Verify Admin Check:**
```javascript
// Must query database, not just trust session
const isAdmin = await db.collection('workspace_admins').findOne({
  workspace_id: workspace_id,
  user_id: user_id,
  deactivated_at: null
});

if (!isAdmin) {
  return res.status(403).json({ error: 'Admin access required' });
}
```

---

## 8. Application Security Headers

### 8.1 Security Headers
**Check for:**
- [ ] Content-Security-Policy
- [ ] X-Frame-Options
- [ ] X-Content-Type-Options
- [ ] Strict-Transport-Security (HSTS)
- [ ] X-XSS-Protection
- [ ] Referrer-Policy

**Check files:**
- `src/middleware/auth.js` - `addSecurityHeaders` function

**Verify Headers:**
```javascript
// Should include:
res.setHeader('Content-Security-Policy',
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
);
res.setHeader('X-Frame-Options', 'DENY');
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
res.setHeader('X-XSS-Protection', '1; mode=block');
res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
```

**Test Headers:**
```bash
curl -I https://your-app.railway.app/dashboard

# Should see security headers in response
# Use securityheaders.com for automated check
```

**Critical Issues:**
- Missing CSP header
- CSP with 'unsafe-inline' 'unsafe-eval' everywhere
- No HSTS in production
- X-Frame-Options allowing framing

---

## 9. File Upload Security

### 9.1 File Upload Validation
**Check for:**
- [ ] File type validation (whitelist, not blacklist)
- [ ] File size limits
- [ ] No direct execution of uploaded files
- [ ] Virus scanning (if applicable)
- [ ] Proper MIME type checking

**Check files:**
- `src/routes/ai-decisions.js` - File upload handling

**Verify File Validation:**
```javascript
// Check MIME type AND extension
const allowedTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const allowedExtensions = ['.txt', '.pdf', '.docx'];

if (!allowedTypes.includes(file.mimetype)) {
  throw new Error('Invalid file type');
}

const ext = path.extname(file.originalname).toLowerCase();
if (!allowedExtensions.includes(ext)) {
  throw new Error('Invalid file extension');
}

// Check file size
if (file.size > 10 * 1024 * 1024) {  // 10MB
  throw new Error('File too large');
}
```

**Critical Issues:**
- No file type validation
- Unrestricted file sizes
- Uploaded files executable
- No virus scanning on untrusted files

---

## 10. Slack Integration Security

### 10.1 Slack Request Verification
**Check for:**
- [ ] All Slack requests verify signing secret
- [ ] Timestamp validation (prevent replay attacks)
- [ ] Proper signature verification

**Verify in Bolt SDK:**
```javascript
// Slack Bolt handles this automatically, but verify:
const receiverConfig = {
  signingSecret: config.slack.signingSecret  // Must be from env
};

// Should reject requests with:
// - Invalid signature
// - Timestamp > 5 minutes old
// - Missing headers
```

### 10.2 Slack OAuth Security
**Check for:**
- [ ] State parameter validation
- [ ] Redirect URI validation
- [ ] Token storage security
- [ ] Scope minimization

**Check files:**
- `src/index.js` - OAuth configuration
- `src/config/installationStore.js` - Token storage

---

## Automated Security Scanning

### Run Security Tools
```bash
# NPM audit
npm audit --audit-level=moderate

# Snyk vulnerability scan
npx snyk test
npx snyk monitor  # Continuous monitoring

# ESLint security rules
npm install eslint-plugin-security --save-dev
# Add to .eslintrc: "plugins": ["security"]

# OWASP Dependency Check
npm install -g dependency-check
dependency-check --project "Corteza" --scan .

# Git secrets scanning
npm install -g gitleaks
gitleaks detect --source . --verbose

# License compliance
npx license-checker --summary
```

---

## Output Format

Generate a security audit report with:

### **Critical** (Fix Immediately - Within 24 hours)
```markdown
### [CRITICAL] Hardcoded API Key in Source Code

**Location**: `src/services/jira.js:45`

**Vulnerability**:
Anthropic API key is hardcoded in source file instead of using environment variable.

**Risk**:
- API key exposed in git repository
- Anyone with code access can use the key
- Potential unauthorized API usage and cost

**Proof of Concept**:
```javascript
// Line 45
const apiKey = 'sk-ant-api03-xxxxxxx';  // EXPOSED!
```

**Remediation**:
1. Immediately rotate the exposed API key
2. Replace with: `const apiKey = process.env.ANTHROPIC_API_KEY;`
3. Add validation: `if (!apiKey) throw new Error('API key required');`
4. Remove from git history using BFG Repo-Cleaner
5. Add pre-commit hook to prevent future commits

**Effort**: Small (30 minutes)
**Priority**: 1 (Highest)
```

### **High** (Fix Before Next Deployment)
```markdown
### [HIGH] Missing Input Validation on Decision Creation

**Location**: `src/routes/api.js:150`

**Vulnerability**:
User input from `req.body.text` is not validated before database insertion, allowing:
- NoSQL injection attacks
- Extremely large payloads
- Type confusion attacks

**Risk**:
- Database corruption
- Denial of service via large inputs
- Potential data exfiltration

**Attack Scenario**:
```bash
curl -X POST /api/memory/create \
  -H "Content-Type: application/json" \
  -d '{"text": {"$ne": null}, "type": "decision"}'

# text is object instead of string, may bypass security checks
```

**Remediation**:
```javascript
// Add validation
const { text, type } = req.body;

if (!text || typeof text !== 'string') {
  return res.status(400).json({ error: 'Text must be a string' });
}

if (text.length > 5000) {
  return res.status(400).json({ error: 'Text too long (max 5000 chars)' });
}

const sanitizedText = text.trim();
```

**Effort**: Small (1 hour)
**Priority**: 2
```

### **Medium** (Plan to Fix This Sprint)
```markdown
### [MEDIUM] Missing Rate Limiting on OAuth Callback

**Location**: `src/index.js:136`

**Vulnerability**:
OAuth callback endpoint `/slack/oauth_redirect` has no rate limiting.

**Risk**:
- Brute force attacks on state parameter
- Denial of service
- Resource exhaustion

**Remediation**:
Add rate limiting to OAuth endpoints:
```javascript
const oauthRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,  // 10 attempts per window
  message: 'Too many OAuth attempts'
});

expressApp.get('/slack/oauth_redirect', oauthRateLimiter, ...);
```

**Effort**: Small (30 minutes)
**Priority**: 3
```

### **Low** (Consider for Future Improvement)
```markdown
### [LOW] Verbose Error Messages in Production

**Location**: Multiple locations in `src/routes/`

**Vulnerability**:
Error messages in production expose internal implementation details.

**Risk**:
- Information disclosure
- Easier reconnaissance for attackers

**Example**:
```javascript
catch (error) {
  res.status(500).json({ error: error.message });  // May expose DB schema
}
```

**Remediation**:
```javascript
catch (error) {
  console.error('Internal error:', error);  // Log full error
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error.message
  });
}
```

**Effort**: Medium (2-3 hours to update all error handlers)
**Priority**: 4
```

---

## Security Metrics

Track these metrics over time:

### Code Quality
- **Secret Leaks**: 0 (always)
- **npm audit high/critical**: 0
- **ESLint security warnings**: < 5
- **Code coverage**: > 80%

### Deployment Security
- **HTTPS enforcement**: 100%
- **Security headers present**: 6/6
- **Authentication required**: 100% of protected routes
- **Rate limiting**: All public endpoints

### Incident Response
- **Time to patch critical**: < 24 hours
- **Time to patch high**: < 7 days
- **Dependency updates**: Monthly
- **Security reviews**: Quarterly

---

## Validation

- [ ] All critical vulnerabilities fixed
- [ ] npm audit shows 0 high/critical
- [ ] No hardcoded secrets in code or git history
- [ ] All endpoints have authentication/authorization
- [ ] Rate limiting implemented on all routes
- [ ] Security headers present
- [ ] Input validation on all user inputs
- [ ] HTTPS enforced in production
- [ ] Multi-tenancy isolation verified
- [ ] File upload validation working
- [ ] Security report generated and reviewed

---

## Rollback Plan

Security fixes should not be rolled back. Instead:

1. **If fix breaks functionality:**
   - Deploy temporary workaround
   - Fix properly in next iteration
   - Keep security fix in place

2. **If false positive:**
   - Document why it's not a real vulnerability
   - Update review checklist to skip in future
   - Keep any defensive code added

---

## Notes

- **Frequency**: Full review quarterly, critical checks monthly
- **Time Estimate**: 4-6 hours for comprehensive review
- **Collaboration**: Involve senior engineers for critical findings
- **Disclosure**: Responsible disclosure for any discovered vulnerabilities
- **Documentation**: Maintain security runbook

## Related Tasks

- `tasks/tech-debt.md` - May identify security-related technical debt
- `deployment/pre-release-checklist.md` - Security checks before release
- `maintenance/dependency-updates.md` - Keep dependencies secure

## Tools & Resources

### Security Scanners
- **npm audit** - Built-in vulnerability scanner
- **Snyk** - Advanced dependency scanning
- **ESLint Security Plugin** - Code security rules
- **Gitleaks** - Secret scanning
- **OWASP Dependency Check** - Comprehensive dependency analysis

### Testing Tools
- **Burp Suite** - Web application security testing
- **OWASP ZAP** - Automated security scanner
- **Postman** - API security testing
- **SQLMap** - SQL injection testing

### Resources
- **OWASP Top 10** - https://owasp.org/www-project-top-ten/
- **Node.js Security Best Practices** - https://nodejs.org/en/docs/guides/security/
- **Express Security Guide** - https://expressjs.com/en/advanced/best-practice-security.html
- **MongoDB Security Checklist** - https://docs.mongodb.com/manual/administration/security-checklist/

---

**Security is not a feature, it's a requirement. Review regularly and fix promptly!**
