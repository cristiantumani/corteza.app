const crypto = require('crypto');
const { getDatabase } = require('../../config/database');

/**
 * Private beta: who may create a new Corteza workspace.
 *
 * While BETA_REQUIRED=true, Google sign-in only creates a workspace for people on the
 * approved list (`beta_access`: an email, or a whole Google Workspace domain). Existing
 * members, invited people and colleagues joining their company's workspace are not
 * affected (see signInWithGoogle in auth/google-signin.js).
 *
 * People are approved from the team's "new early access request" email: the website
 * (Corteza_website, edge function trigger-webhook) adds an Approve link signed with
 * BETA_APPROVAL_SECRET, handled by http/beta.js. Or with scripts/beta-approve.js.
 */

const TOKEN_PREFIX = 'beta-approve:';

function collection() {
  return getDatabase().collection('beta_access');
}

/** @returns {boolean} true when new workspaces need beta approval */
function isBetaRequired() {
  return process.env.BETA_REQUIRED === 'true';
}

/** Where people who aren't in the beta are sent to request access */
function earlyAccessUrl(email) {
  const url = new URL(process.env.EARLY_ACCESS_URL || 'https://corteza.app/early-access');
  if (email) url.searchParams.set('email', email);
  url.searchParams.set('from', 'signin');
  return url.toString();
}

/**
 * Whether this person may create a new workspace
 * @param {string} email - verified Google email
 * @param {string|null} domain - Google's `hd` claim (Workspace accounts only)
 * @returns {Promise<boolean>}
 */
async function isApproved(email, domain) {
  if (!isBetaRequired()) return true;
  const or = [{ email: String(email).toLowerCase() }];
  if (domain) or.push({ domain: String(domain).toLowerCase() });
  return !!(await collection().findOne({ $or: or }, { projection: { _id: 1 } }));
}

/**
 * Adds an email or a Google Workspace domain to the approved list (idempotent)
 * @param {Object} params
 * @param {string} [params.email]
 * @param {string} [params.domain]
 * @param {string} [params.name] - first name, for the welcome email
 * @param {string} [params.company]
 * @param {string} params.approvedVia - 'email_link' | 'script'
 * @returns {Promise<{ entry: Object, alreadyApproved: boolean }>}
 */
async function approve({ email, domain, name = null, company = null, approvedVia }) {
  const key = email ? { email: email.trim().toLowerCase() } : { domain: domain.trim().toLowerCase() };
  const result = await collection().findOneAndUpdate(
    key,
    { $setOnInsert: { ...key, name, company, approved_at: new Date(), approved_via: approvedVia } },
    { upsert: true, returnDocument: 'before', includeResultMetadata: true }
  );
  const alreadyApproved = !!result.value;
  const entry = result.value || await collection().findOne(key);
  return { entry, alreadyApproved };
}

/**
 * Marks the welcome email as sent. Returns false if it was already marked, so two
 * clicks at the same time send it only once.
 * @param {string} email
 * @returns {Promise<boolean>}
 */
async function claimWelcome(email) {
  const result = await collection().updateOne(
    { email: email.toLowerCase(), welcome_sent_at: null },
    { $set: { welcome_sent_at: new Date() } }
  );
  return result.modifiedCount === 1;
}

/** Undoes claimWelcome when the email couldn't be sent, so it can be tried again */
async function releaseWelcome(email) {
  await collection().updateOne({ email: email.toLowerCase() }, { $set: { welcome_sent_at: null } });
}

function hmac(payload) {
  const secret = process.env.BETA_APPROVAL_SECRET;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(TOKEN_PREFIX + payload).digest('base64url');
}

/**
 * Signs an approval link token (the website signs the same format in Deno)
 * @param {{ email: string, name?: string, company?: string }} data
 * @param {number} [ttlDays]
 * @returns {string} "<base64url JSON>.<base64url HMAC-SHA256>"
 */
function signApprovalToken({ email, name, company }, ttlDays = 30) {
  const payload = Buffer.from(JSON.stringify({
    email, name, company, exp: Date.now() + ttlDays * 24 * 60 * 60 * 1000
  })).toString('base64url');
  const signature = hmac(payload);
  if (!signature) throw new Error('BETA_APPROVAL_SECRET is not configured');
  return `${payload}.${signature}`;
}

/**
 * Checks an approval link token
 * @param {string} token
 * @returns {{ email: string, name: string|null, company: string|null }|null} null when invalid or expired
 */
function verifyApprovalToken(token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expected = hmac(payload);
  if (!expected) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return null;
  if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  return {
    email: data.email.toLowerCase(),
    name: typeof data.name === 'string' ? data.name.slice(0, 100) : null,
    company: typeof data.company === 'string' ? data.company.slice(0, 200) : null
  };
}

module.exports = {
  isBetaRequired,
  earlyAccessUrl,
  isApproved,
  approve,
  claimWelcome,
  releaseWelcome,
  signApprovalToken,
  verifyApprovalToken
};
