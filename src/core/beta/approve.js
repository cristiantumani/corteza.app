const config = require('../../config/environment');
const mailer = require('../../utils/n8n-client');
const beta = require('./beta-access');

/**
 * Approves a beta tester and sends them the welcome email, once.
 * Safe to repeat: a second approval doesn't send a second email, and a failed
 * email is sent on the next try.
 * @param {Object} params
 * @param {string} params.email
 * @param {string} [params.name]
 * @param {string} [params.company]
 * @param {string} params.approvedVia - 'email_link' | 'script'
 * @param {'en'|'es'} [params.lang] - language of the welcome email
 * @returns {Promise<{ alreadyApproved: boolean, welcome: 'sent'|'already_sent'|'failed'|'not_configured', error?: string }>}
 */
async function approveBetaTester({ email, name, company, approvedVia, lang = 'en' }) {
  const { entry, alreadyApproved } = await beta.approve({ email, name, company, approvedVia });
  console.log(`🎟️  Beta ${alreadyApproved ? 'already approved' : 'approved'}: ${entry.email} (${approvedVia})`);

  if (!process.env.RESEND_API_KEY) return { alreadyApproved, welcome: 'not_configured' };
  if (!(await beta.claimWelcome(entry.email))) return { alreadyApproved, welcome: 'already_sent' };

  try {
    await mailer.sendBetaWelcomeEmail({
      email: entry.email,
      name: entry.name || name,
      login_url: `${config.app.baseUrl}/auth/login`,
      // Sent from Cristian's address, so replies reach him; BETA_REPLY_TO sends them elsewhere
      reply_to: (process.env.BETA_REPLY_TO || '').split(',')[0].trim() || undefined,
      lang
    });
    return { alreadyApproved, welcome: 'sent' };
  } catch (error) {
    console.error(`❌ Beta welcome email to ${entry.email} failed:`, error.message);
    await beta.releaseWelcome(entry.email);
    return { alreadyApproved, welcome: 'failed', error: error.message };
  }
}

module.exports = { approveBetaTester };
