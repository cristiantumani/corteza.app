const crypto = require('crypto');
const { sendMagicLinkEmail } = require('../utils/n8n-client');
const rateLimiter = require('../utils/rate-limiter');
const { generateLoginToken } = require('./dashboard-auth');

/**
 * Handles email magic link request
 * POST /auth/send-magic-link
 */
async function handleSendMagicLink(req, res) {
  const { email, workspace_name, user_name } = req.body;

  // Validate email
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({
      error: 'Valid email address required'
    });
  }

  // Validate workspace name
  if (!workspace_name || workspace_name.trim().length < 2) {
    return res.status(400).json({
      error: 'Workspace name required (minimum 2 characters)'
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedWorkspace = workspace_name.toLowerCase().trim()
    .replace(/[^a-z0-9-]/g, '-'); // Sanitize workspace name

  // Rate limiting (3 requests per email per 15 minutes)
  if (!rateLimiter.isAllowed(normalizedEmail, 3, 15 * 60 * 1000)) {
    return res.status(429).json({
      error: 'Too many requests. Please try again in 15 minutes.',
      remaining: 0
    });
  }

  try {
    // Generate workspace ID (auto-create workspace)
    const workspaceId = `W${normalizedWorkspace.toUpperCase().substring(0, 10)}`;

    // Generate user ID from email hash
    const userId = `U${crypto.createHash('md5').update(normalizedEmail).digest('hex').substring(0, 8).toUpperCase()}`;

    // Use provided name or derive from email
    const displayName = user_name || normalizedEmail.split('@')[0];

    // Generate one-time login token (reuse existing logic)
    const token = generateLoginToken(
      userId,
      displayName,
      workspaceId,
      normalizedWorkspace
    );

    // Build magic link
    const baseUrl = process.env.BASE_URL || 'https://app.corteza.app';
    const magicLink = `${baseUrl}/auth/token?token=${token}`;

    // Send email via n8n
    await sendMagicLinkEmail({
      email: normalizedEmail,
      user_name: displayName,
      workspace_name: normalizedWorkspace,
      workspace_id: workspaceId,
      magic_link: magicLink,
      expires_in_minutes: 5
    });

    console.log(`✅ Magic link sent to ${normalizedEmail} for workspace ${normalizedWorkspace}`);

    res.json({
      success: true,
      message: `Magic link sent to ${normalizedEmail}. Check your inbox!`,
      remaining: rateLimiter.getRemaining(normalizedEmail, 3)
    });

  } catch (error) {
    console.error('❌ Error sending magic link:', error);
    res.status(500).json({
      error: 'Failed to send magic link. Please try again.'
    });
  }
}

/**
 * Validates email format
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

module.exports = {
  handleSendMagicLink
};
