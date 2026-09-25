const express = require('express');
const { getWorkspaceMembersCollection } = require('../config/database');
const { verifyUnsubscribe } = require('../jobs/weekly-digest');
const { escapeHtml } = require('../utils/n8n-client');

const router = express.Router();

function page(title, body) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; color: #111;">
  <h1 style="font-size: 22px;">${title}</h1>
  ${body}
</body>
</html>`;
}

const invalidLink = page('Link not valid', '<p style="color: #555;">This unsubscribe link is invalid or incomplete. Please use the link from your most recent digest email.</p>');

/**
 * GET /digest/unsubscribe?w=&u=&t=
 * Confirmation page. The change happens on POST so email link scanners can't unsubscribe people.
 */
router.get('/digest/unsubscribe', (req, res) => {
  const { w, u, t } = req.query;
  if (typeof w !== 'string' || typeof u !== 'string' || !verifyUnsubscribe(w, u, t)) {
    return res.status(400).send(invalidLink);
  }

  res.send(page('Unsubscribe from weekly digests?', `
  <p style="color: #555;">You'll stop getting the weekly decision digest for this workspace.</p>
  <form method="POST" action="/digest/unsubscribe?${new URLSearchParams({ w, u, t })}">
    <button type="submit" style="background: #000; color: #fff; border: 0; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px; cursor: pointer;">Unsubscribe</button>
  </form>`));
});

/**
 * POST /digest/unsubscribe?w=&u=&t=
 * Also used by mail clients for one-click unsubscribe (List-Unsubscribe-Post header)
 */
router.post('/digest/unsubscribe', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { w, u, t } = req.query;
    if (typeof w !== 'string' || typeof u !== 'string' || !verifyUnsubscribe(w, u, t)) {
      return res.status(400).send(invalidLink);
    }

    const membersCollection = getWorkspaceMembersCollection();
    const member = await membersCollection.findOne({ workspace_id: w, user_id: u, removed_at: null });
    await membersCollection.updateMany(
      { workspace_id: w, user_id: u, removed_at: null },
      { $set: { digest_opt_out: true, digest_opt_out_at: new Date().toISOString() } }
    );
    console.log(`📭 Weekly digest unsubscribed: ${u} in ${w}`);

    const workspaceName = member?.workspace_name ? `<strong>${escapeHtml(member.workspace_name)}</strong>` : 'this workspace';
    res.send(page('You’re unsubscribed', `<p style="color: #555;">You won't get weekly digests for ${workspaceName} anymore.</p>`));
  } catch (error) {
    console.error('❌ Digest unsubscribe failed:', error);
    res.status(500).send(page('Something went wrong', '<p style="color: #555;">Please try again in a moment.</p>'));
  }
});

module.exports = router;
