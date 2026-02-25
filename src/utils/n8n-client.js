const fetch = require('node-fetch');

/**
 * Sends magic link email via n8n webhook
 */
async function sendMagicLinkEmail(emailData) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!webhookUrl) {
    throw new Error('N8N_WEBHOOK_URL not configured');
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  // Optional: Add authentication header
  if (webhookSecret) {
    headers['X-Webhook-Secret'] = webhookSecret;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(emailData),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n webhook failed: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Magic link email sent to ${emailData.email}`);
    return { success: true };
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('❌ n8n webhook timed out after 10s');
      throw new Error('Email service timed out. Please try again.');
    }
    console.error('❌ Failed to send magic link email:', error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends re-engagement email via n8n webhook to users who installed
 * the extension but haven't activated after 3 days
 */
async function sendReengagementEmail({ email, workspace_name, install_date }) {
  const webhookUrl = process.env.N8N_REENGAGEMENT_WEBHOOK_URL;
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!webhookUrl) {
    console.warn('⚠️  N8N_REENGAGEMENT_WEBHOOK_URL not configured — skipping re-engagement email');
    return { success: false, reason: 'webhook_not_configured' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (webhookSecret) {
    headers['X-Webhook-Secret'] = webhookSecret;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        workspace_name: workspace_name || '',
        install_date: install_date ? new Date(install_date).toISOString() : null,
        chrome_store_url: 'https://chromewebstore.google.com/detail/corteza-team-memory/YOUR_EXTENSION_ID',
        dashboard_url: process.env.BASE_URL || 'https://app.corteza.app'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n webhook failed: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Re-engagement email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to send re-engagement email to ${email}:`, error.message);
    throw error;
  }
}

module.exports = {
  sendMagicLinkEmail,
  sendReengagementEmail
};
