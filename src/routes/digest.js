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

/** Which digest a link turns off: ?k=daily for the daily summary, else the weekly digest */
function digestKind(query) {
  return query.k === 'daily'
    ? { k: 'daily', name: 'daily summaries', flag: 'daily_digest_opt_out' }
    : { k: null, name: 'weekly digests', flag: 'digest_opt_out' };
}

const invalidLink = page('Link not valid', '<p style="color: #555;">This unsubscribe link is invalid or incomplete. Please use the link from your most recent digest email.</p>');

/**
 * GET /digest/unsubscribe?w=&u=&t=[&k=daily]
 * Confirmation page. The change happens on POST so email link scanners can't unsubscribe people.
 */
router.get('/digest/unsubscribe', (req, res) => {
  const { w, u, t } = req.query;
  if (typeof w !== 'string' || typeof u !== 'string' || !verifyUnsubscribe(w, u, t)) {
    return res.status(400).send(invalidLink);
  }

  const kind = digestKind(req.query);
  const params = new URLSearchParams({ w, u, t, ...(kind.k ? { k: kind.k } : {}) });
  res.send(page(`Unsubscribe from ${kind.name}?`, `
  <p style="color: #555;">You'll stop getting ${kind.name} for this workspace.</p>
  <form method="POST" action="/digest/unsubscribe?${params}">
    <button type="submit" style="background: #000; color: #fff; border: 0; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px; cursor: pointer;">Unsubscribe</button>
  </form>`));
});

/**
 * POST /digest/unsubscribe?w=&u=&t=[&k=daily]
 * Also used by mail clients for one-click unsubscribe (List-Unsubscribe-Post header)
 */
router.post('/digest/unsubscribe', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { w, u, t } = req.query;
    if (typeof w !== 'string' || typeof u !== 'string' || !verifyUnsubscribe(w, u, t)) {
      return res.status(400).send(invalidLink);
    }

    const kind = digestKind(req.query);
    const membersCollection = getWorkspaceMembersCollection();
    const member = await membersCollection.findOne({ workspace_id: w, user_id: u, removed_at: null });
    await membersCollection.updateMany(
      { workspace_id: w, user_id: u, removed_at: null },
      { $set: { [kind.flag]: true, [`${kind.flag}_at`]: new Date().toISOString() } }
    );
    console.log(`📭 Unsubscribed from ${kind.name}: ${u} in ${w}`);

    const workspaceName = member?.workspace_name ? `<strong>${escapeHtml(member.workspace_name)}</strong>` : 'this workspace';
    res.send(page('You’re unsubscribed', `<p style="color: #555;">You won't get ${kind.name} for ${workspaceName} anymore.</p>`));
  } catch (error) {
    console.error('❌ Digest unsubscribe failed:', error);
    res.status(500).send(page('Something went wrong', '<p style="color: #555;">Please try again in a moment.</p>'));
  }
});

module.exports = router;
