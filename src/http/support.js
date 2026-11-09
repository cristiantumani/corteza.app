const express = require('express');
const { aiRateLimiter } = require('../middleware/auth');
const { requireAiBudget } = require('../core/usage/ai-usage');
const support = require('../core/support/support-agent');
const { requestLanguage } = require('../core/i18n/i18n');
const { track } = require('../integrations/posthog/client');
const { reportError } = require('../integrations/sentry/client');

/**
 * Help inside Corteza (core/support/support-agent, docs/specs/2026-10-support-agent.md)
 *
 *   POST /api/support/messages  { conversation_id?, text, page? }
 *     → an event stream: `text` events with pieces of the reply, then `done`
 *       { conversation_id, escalated, limit_reached }, or `error` { error }.
 *     Errors before the reply starts (help off, empty text, today's limit) come back as JSON.
 */
const router = express.Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

router.post('/api/support/messages', aiRateLimiter, express.json(), requireSession, requireAiBudget, async (req, res) => {
  const user = req.session.user;
  const body = req.body || {};
  let streaming = false;
  const send = (event, data) => {
    if (!streaming) {
      streaming = true;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // compression() holds output back until flushed
    if (typeof (/** @type {any} */ (res).flush) === 'function') /** @type {any} */ (res).flush();
  };

  try {
    const page = typeof body.page === 'string' && /^\/[a-z0-9/_-]{0,60}$/i.test(body.page) ? body.page : null;
    const result = await support.sendMessage({
      user,
      text: body.text,
      conversationId: body.conversation_id,
      context: { firstName: (user.user_name || '').split(' ')[0] || null, language: requestLanguage(req), page },
      onText: text => send('text', { text })
    });
    if (result.error) {
      if (streaming) {
        send('error', { error: result.error });
        return res.end();
      }
      return res.status(result.status || 400).json({ success: false, error: result.error, limit_reached: !!result.limit_reached });
    }
    track('support_message_sent', { escalated: !!result.escalated }, user.user_id);
    if (result.escalated) track('support_escalated', {}, user.user_id);
    send('done', { conversation_id: result.conversation_id, escalated: !!result.escalated, limit_reached: !!result.limit_reached });
    res.end();
  } catch (error) {
    console.error('❌ Support message failed:', error.message);
    reportError(error, { job: 'support', workspace_id: user.workspace_id });
    if (streaming) {
      send('error', { error: 'Help is not answering right now' });
      return res.end();
    }
    res.status(502).json({ success: false, error: 'Help is not answering right now' });
  }
});

module.exports = router;
