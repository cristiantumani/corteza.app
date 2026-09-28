const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { verifyApprovalToken } = require('../core/beta/beta-access');
const { approveBetaTester } = require('../core/beta/approve');
const { escapeHtml } = require('../utils/n8n-client');

/**
 * Approve a beta tester from the team's "new early access request" email.
 *
 *   GET  /beta/approve?t=<token>   confirmation page (email scanners open links: GET changes nothing)
 *   POST /beta/approve?t=<token>   approves and sends the tester the welcome email
 *
 * The token is signed with BETA_APPROVAL_SECRET by the website (see core/beta/beta-access.js),
 * so only the people who get that email can approve.
 */
const router = express.Router();

function page(title, body) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; color: #111; line-height: 1.5;">
  <img src="/favicon-96x96.png" alt="Corteza" width="40" style="margin-bottom: 16px;" />
  <h1 style="font-size: 22px;">${title}</h1>
  ${body}
</body>
</html>`;
}

const invalidLink = page('Link not valid', '<p style="color: #555;">This approval link is invalid or has expired (links last 30 days). You can still approve with <code>node scripts/beta-approve.js &lt;email&gt; --welcome</code>.</p>');

function who(tester) {
  const name = tester.name ? `${escapeHtml(tester.name)} &lt;${escapeHtml(tester.email)}&gt;` : `<strong>${escapeHtml(tester.email)}</strong>`;
  return tester.company ? `${name} from <strong>${escapeHtml(tester.company)}</strong>` : name;
}

router.get('/beta/approve', apiRateLimiter, (req, res) => {
  const tester = verifyApprovalToken(req.query.t);
  if (!tester) return res.status(400).send(invalidLink);

  res.send(page('Approve for the beta?', `
  <p style="color: #555;">${who(tester)} will be able to sign in with Google and create their workspace. They’ll get a welcome email inviting them to sign in.</p>
  <form method="POST" action="/beta/approve?${new URLSearchParams({ t: req.query.t })}">
    <button type="submit" style="background: #000; color: #fff; border: 0; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px; cursor: pointer;">Approve and send welcome</button>
  </form>`));
});

router.post('/beta/approve', apiRateLimiter, async (req, res) => {
  const tester = verifyApprovalToken(req.query.t);
  if (!tester) return res.status(400).send(invalidLink);

  try {
    const result = await approveBetaTester({ ...tester, approvedVia: 'email_link' });
    const email = `<strong>${escapeHtml(tester.email)}</strong>`;
    const messages = {
      sent: `Welcome email sent to ${email}.`,
      already_sent: `The welcome email had already been sent to ${email}.`,
      not_configured: `No welcome email was sent: RESEND_API_KEY isn’t set on the server. Let ${email} know they can sign in.`,
      failed: `The welcome email to ${email} couldn’t be sent. Open the approval link again to retry.`
    };
    const title = result.welcome === 'failed' ? 'Approved, but the email failed'
      : result.alreadyApproved ? 'Already approved' : 'Approved 🎉';
    res.status(result.welcome === 'failed' ? 502 : 200).send(page(title, `
  <p style="color: #555;">${who(tester)} can now sign in with Google and create their workspace.</p>
  <p style="color: #555;">${messages[result.welcome]}</p>`));
  } catch (error) {
    console.error('❌ Beta approval failed:', error);
    res.status(500).send(page('Something went wrong', '<p style="color: #555;">Please try again in a moment.</p>'));
  }
});

module.exports = router;
