const express = require('express');
const { getWorkspaceMembersCollection } = require('../config/database');
const { verifyUnsubscribe } = require('../jobs/weekly-digest');
const { escapeHtml } = require('../utils/n8n-client');
const { requestLanguage, translate } = require('../core/i18n/i18n');

const router = express.Router();

/** Unsubscribe pages in the browser's language (core/i18n) */
function page(lang, title, body) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; color: #111;">
  <h1 style="font-size: 22px;">${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
}

/** Which digest a link turns off: ?k=daily for the daily summary, else the weekly digest */
function digestKind(query) {
  return query.k === 'daily'
    ? { k: 'daily', key: 'daily', name: 'daily summaries', flag: 'daily_digest_opt_out' }
    : { k: null, key: 'weekly', name: 'weekly digests', flag: 'digest_opt_out' };
}

const invalidLink = lang => page(lang, translate(lang, 'unsubscribe.invalidTitle'), `<p style="color: #555;">${escapeHtml(translate(lang, 'unsubscribe.invalidBody'))}</p>`);

/**
 * GET /digest/unsubscribe?w=&u=&t=[&k=daily]
 * Confirmation page. The change happens on POST so email link scanners can't unsubscribe people.
 */
router.get('/digest/unsubscribe', (req, res) => {
  const lang = requestLanguage(req);
  const t = (key, vars) => translate(lang, key, vars);
  const { w, u, t: token } = req.query;
  if (typeof w !== 'string' || typeof u !== 'string' || !verifyUnsubscribe(w, u, token)) {
    return res.status(400).send(invalidLink(lang));
  }

  const kind = digestKind(req.query);
  const params = new URLSearchParams({ w, u, t: token, ...(kind.k ? { k: kind.k } : {}) });
  res.send(page(lang, t(`unsubscribe.${kind.key}.confirmTitle`), `
  <p style="color: #555;">${escapeHtml(t(`unsubscribe.${kind.key}.confirmBody`))}</p>
  <form method="POST" action="/digest/unsubscribe?${params}">
    <button type="submit" style="background: #000; color: #fff; border: 0; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px; cursor: pointer;">${escapeHtml(t('unsubscribe.button'))}</button>
  </form>`));
});

/**
 * POST /digest/unsubscribe?w=&u=&t=[&k=daily]
 * Also used by mail clients for one-click unsubscribe (List-Unsubscribe-Post header)
 */
router.post('/digest/unsubscribe', express.urlencoded({ extended: false }), async (req, res) => {
  const lang = requestLanguage(req);
  const t = (key, vars) => translate(lang, key, vars);
  try {
    const { w, u, t: token } = req.query;
    if (typeof w !== 'string' || typeof u !== 'string' || !verifyUnsubscribe(w, u, token)) {
      return res.status(400).send(invalidLink(lang));
    }

    const kind = digestKind(req.query);
    const membersCollection = getWorkspaceMembersCollection();
    const member = await membersCollection.findOne({ workspace_id: w, user_id: u, removed_at: null });
    await membersCollection.updateMany(
      { workspace_id: w, user_id: u, removed_at: null },
      { $set: { [kind.flag]: true, [`${kind.flag}_at`]: new Date().toISOString() } }
    );
    console.log(`📭 Unsubscribed from ${kind.name}: ${u} in ${w}`);

    const workspaceName = member?.workspace_name ? `<strong>${escapeHtml(member.workspace_name)}</strong>` : escapeHtml(t('unsubscribe.thisWorkspace'));
    res.send(page(lang, t('unsubscribe.doneTitle'), `<p style="color: #555;">${escapeHtml(t(`unsubscribe.${kind.key}.doneBody`)).replace('{workspace}', workspaceName)}</p>`));
  } catch (error) {
    console.error('❌ Digest unsubscribe failed:', error);
    res.status(500).send(page(lang, t('unsubscribe.errorTitle'), `<p style="color: #555;">${escapeHtml(t('unsubscribe.errorBody'))}</p>`));
  }
});

module.exports = router;
