const crypto = require('crypto');
const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { requestLanguage, translate, escapeHtml } = require('../core/i18n/i18n');
const oauth = require('../auth/oauth-server');
const { track } = require('../integrations/posthog/client');

/**
 * The consent page of the MCP connector's OAuth flow (docs/specs/2026-10-mcp-connector.md).
 *
 *   GET  /oauth/consent?request=<id>   signs the person in with Google if needed, then asks
 *                                      "<assistant> wants to connect to your Corteza" (Allow / Cancel)
 *   POST /oauth/consent                { request, csrf, decision: 'allow'|'deny' } → back to the assistant
 *
 * /authorize (the SDK's, in src/auth/oauth-server.js) parks the request and redirects here.
 * The wording lists what each granted scope lets the assistant do, so it stays true when write
 * scopes are added.
 */
const router = express.Router();

/** @param {string} lang @param {string} title @param {string} body */
function page(lang, title, body) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)} · Corteza</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root { --bg: #fafafa; --card: #fff; --text: #1d1d1f; --muted: #6b6b6b; --line: #e5e5e5; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0d0d0d; --card: #171717; --text: #ececec; --muted: #a3a3a3; --line: #2a2a2a; } }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; }
    main { max-width: 480px; margin: 48px auto; padding: 0 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px 24px; }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; margin-bottom: 20px; }
    .brand img { width: 24px; height: 24px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p, li { font-size: 15px; }
    ul { padding-left: 20px; margin: 8px 0 16px; }
    .muted { color: var(--muted); font-size: 14px; }
    .actions { display: flex; gap: 12px; margin-top: 24px; flex-wrap: wrap; }
    button { font: inherit; font-weight: 600; border-radius: 8px; padding: 10px 18px; cursor: pointer; }
    .allow { background: #000; color: #fff; border: 1px solid #000; }
    .deny { background: transparent; color: var(--text); border: 1px solid var(--line); }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <div class="brand"><img src="/favicon.svg" alt="">Corteza</div>
      ${body}
    </div>
  </main>
</body>
</html>`;
}

/** A page with just a message (expired request, assistants off) */
function messagePage(lang, titleKey, textKey) {
  const t = (key, vars) => translate(lang, key, vars);
  return page(lang, t(titleKey), `<h1>${escapeHtml(t(titleKey))}</h1><p>${escapeHtml(t(textKey))}</p>`);
}

router.get('/oauth/consent', apiRateLimiter, async (req, res) => {
  const lang = requestLanguage(req);
  const requestId = typeof req.query.request === 'string' ? req.query.request : '';
  const request = await oauth.getRequest(requestId);
  if (!request) return res.status(400).type('html').send(messagePage(lang, 'mcp.consent.expiredTitle', 'mcp.consent.expired'));

  const user = req.session && req.session.user;
  if (!user || user.is_demo) {
    // Google sign-in first, then back here
    return res.redirect(`/auth/google?return=${encodeURIComponent(`/oauth/consent?request=${requestId}`)}`);
  }
  if (!(await oauth.assistantsEnabled(user.workspace_id))) {
    return res.status(403).type('html').send(messagePage(lang, 'mcp.consent.offTitle', 'mcp.consent.off'));
  }

  const csrf = crypto.randomBytes(16).toString('hex');
  req.session.mcpConsent = { request: requestId, csrf };
  const t = (key, vars) => translate(lang, key, vars);
  const abilities = request.scopes.map(scope => `<li>${escapeHtml(t(`mcp.consent.scope.${scope}`))}</li>`).join('');
  const title = t('mcp.consent.title', { client: request.client_name });
  req.session.save(() => {
    res.type('html').send(page(lang, title, `
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(t('mcp.consent.canDo'))}</p>
      <ul>${abilities}</ul>
      <p class="muted">${escapeHtml(t('mcp.consent.asYou', { email: user.email || user.user_name || '', workspace: user.workspace_name || user.workspace_id }))}</p>
      <p class="muted">${escapeHtml(t('mcp.consent.disconnect'))}</p>
      <form method="post" action="/oauth/consent">
        <input type="hidden" name="request" value="${escapeHtml(requestId)}">
        <input type="hidden" name="csrf" value="${csrf}">
        <div class="actions">
          <button type="submit" name="decision" value="allow" class="allow">${escapeHtml(t('mcp.consent.allow'))}</button>
          <button type="submit" name="decision" value="deny" class="deny">${escapeHtml(t('common.cancel'))}</button>
        </div>
      </form>`));
  });
});

router.post('/oauth/consent', apiRateLimiter, express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
  const lang = requestLanguage(req);
  const user = req.session && req.session.user;
  const pending = req.session && req.session.mcpConsent;
  const body = req.body || {};
  const requestId = typeof body.request === 'string' ? body.request : '';
  const csrfOk = pending && typeof body.csrf === 'string' && pending.request === requestId &&
    body.csrf.length === pending.csrf.length && crypto.timingSafeEqual(Buffer.from(body.csrf), Buffer.from(pending.csrf));
  if (!user || user.is_demo || !csrfOk) return res.status(400).type('html').send(messagePage(lang, 'mcp.consent.expiredTitle', 'mcp.consent.expired'));
  delete req.session.mcpConsent;

  try {
    if (body.decision !== 'allow') {
      const denied = await oauth.denyRequest(requestId);
      return denied ? res.redirect(denied.redirect) : res.type('html').send(messagePage(lang, 'mcp.consent.expiredTitle', 'mcp.consent.expired'));
    }
    if (!(await oauth.assistantsEnabled(user.workspace_id))) {
      return res.status(403).type('html').send(messagePage(lang, 'mcp.consent.offTitle', 'mcp.consent.off'));
    }
    const { redirect } = await oauth.approveRequest(requestId, user);
    track('mcp_connected', {}, user.user_id);
    console.log(`🔌 MCP assistant connected for ${user.user_id} in ${user.workspace_id}`);
    res.redirect(redirect);
  } catch (error) {
    res.status(400).type('html').send(messagePage(lang, 'mcp.consent.expiredTitle', 'mcp.consent.expired'));
  }
});

module.exports = router;
