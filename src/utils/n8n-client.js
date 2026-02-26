/**
 * Sends emails via Resend REST API directly (no SDK dependency)
 */

// Use native fetch (Node 18+) or fall back to node-fetch v2
const fetch = globalThis.fetch || require('node-fetch');

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Corteza <noreply@corteza.app>',
        to: [to],
        subject,
        html
      }),
      signal: controller.signal
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Resend API error:', JSON.stringify(data));
      throw new Error(`Resend error: ${data.message || response.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Email service timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends magic link email via Resend
 */
async function sendMagicLinkEmail({ email, user_name, workspace_name, magic_link, expires_in_minutes }) {
  const result = await sendEmail({
    to: email,
    subject: 'Your Corteza login link',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">Your login link</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 32px;">
          Hi ${user_name || email.split('@')[0]}, click below to log into your <strong>${workspace_name}</strong> workspace. This link expires in ${expires_in_minutes || 5} minutes.
        </p>
        <a href="${magic_link}"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Log in to Corteza →
        </a>
        <p style="font-size: 13px; color: #999; margin: 32px 0 0;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `
  });

  console.log(`✅ Magic link email sent to ${email}`, result.id);
  return { success: true };
}

/**
 * Sends re-engagement email via Resend
 */
async function sendReengagementEmail({ email, workspace_name, install_date }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY not configured — skipping re-engagement email');
    return { success: false, reason: 'resend_not_configured' };
  }

  const dashboardUrl = process.env.BASE_URL || 'https://app.corteza.app';

  const result = await sendEmail({
    to: email,
    subject: 'Still interested in Corteza?',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #111;">
        <img src="https://corteza.app/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 24px;" />
        <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">You installed Corteza — here's how to get started</h1>
        <p style="font-size: 15px; color: #555; margin: 0 0 24px;">
          You installed the Corteza extension a few days ago but haven't logged in yet. It only takes 2 minutes to set up — and your team will stop losing decisions from day one.
        </p>
        <a href="${dashboardUrl}/auth/login"
           style="display: inline-block; background: #000; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
          Get started →
        </a>
        <p style="font-size: 13px; color: #999; margin: 32px 0 0;">
          If you've changed your mind, just ignore this email. No hard feelings.
        </p>
      </div>
    `
  });

  console.log(`✅ Re-engagement email sent to ${email}`, result.id);
  return { success: true };
}

module.exports = {
  sendMagicLinkEmail,
  sendReengagementEmail
};
