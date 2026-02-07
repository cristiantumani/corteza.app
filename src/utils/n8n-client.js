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

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(emailData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n webhook failed: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Magic link email sent to ${emailData.email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Failed to send magic link email:', error);
    throw error;
  }
}

module.exports = {
  sendMagicLinkEmail
};
