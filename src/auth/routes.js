const path = require('path');
const express = require('express');
const { authRateLimiter } = require('../middleware/auth');
const google = require('../integrations/google/oauth');
const { signInWithGoogle } = require('./google-signin');
const { earlyAccessUrl } = require('../core/beta/beta-access');
const analytics = require('../integrations/posthog/client');

/**
 * Sign-in routes. Google is the only way to log in.
 *
 *   GET  /auth/login               login page ("Continue with Google")
 *   GET  /auth/google              start Google sign-in (?invite=<id>&return=<path>)
 *   GET  /auth/google/callback     Google redirects back here (then straight to the dashboard:
 *                                  no onboarding questions, the early access form already asked them)
 *   GET  /auth/onboarding          old link: redirects to the dashboard
 *
 * /auth/me and /auth/logout live in routes/auth.js.
 */
const router = express.Router();

/** Only allow same-site relative paths as post-login destinations */
function safeReturnPath(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : null;
}

function loginErrorRedirect(res, message) {
  return res.redirect(`/auth/login?error=${encodeURIComponent(message)}`);
}

router.get('/auth/login', authRateLimiter, (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

router.get('/auth/google', authRateLimiter, (req, res) => {
  if (!google.isGoogleConfigured()) {
    return loginErrorRedirect(res, 'Google sign-in is not configured on this server.');
  }

  const state = google.randomToken();
  const nonce = google.randomToken();
  req.session.oauth = {
    state,
    nonce,
    inviteId: typeof req.query.invite === 'string' ? req.query.invite : null,
    returnTo: safeReturnPath(req.query.return),
    started_at: Date.now()
  };

  req.session.save(err => {
    if (err) {
      console.error('❌ Failed to save OAuth state:', err);
      return loginErrorRedirect(res, 'Could not start sign-in. Please try again.');
    }
    res.redirect(google.buildSignInUrl({ state, nonce }));
  });
});

router.get('/auth/google/callback', authRateLimiter, async (req, res) => {
  const oauth = req.session?.oauth;
  if (req.session) delete req.session.oauth;

  if (req.query.error) {
    return loginErrorRedirect(res, req.query.error === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in failed.');
  }
  if (!oauth || !req.query.state || req.query.state !== oauth.state || Date.now() - oauth.started_at > 10 * 60 * 1000) {
    return loginErrorRedirect(res, 'Your sign-in session expired. Please try again.');
  }

  try {
    const identity = await google.verifySignInCode({ code: req.query.code, nonce: oauth.nonce });
    const result = await signInWithGoogle(identity, { inviteId: oauth.inviteId });
    if (result.error) return loginErrorRedirect(res, result.error);
    if (result.notInBeta) {
      console.log(`🚪 Sign-in without beta access (${String(result.email || '').split('@')[1] || 'unknown domain'}) → early access form`);
      return res.redirect(earlyAccessUrl());
    }

    // The language they picked in Settings (else the app follows their browser)
    const language = await require('../core/users/language').getLanguage(result.sessionUser.workspace_id, result.sessionUser.user_id).catch(() => null);
    if (language) result.sessionUser.language = language;

    // New session ID on login (prevents session fixation)
    req.session.regenerate(err => {
      if (err) {
        console.error('❌ Failed to regenerate session:', err);
        return loginErrorRedirect(res, 'Could not create your session. Please try again.');
      }
      req.session.user = result.sessionUser;
      req.session.save(saveErr => {
        if (saveErr) {
          console.error('❌ Failed to save session:', saveErr);
          return loginErrorRedirect(res, 'Could not create your session. Please try again.');
        }
        analytics.identify(result.sessionUser.user_id, {
          email: result.sessionUser.email,
          name: result.sessionUser.user_name,
          workspace_id: result.sessionUser.workspace_id
        });
        analytics.track('user_signed_in', { invited: Boolean(oauth.inviteId), $session_id: req.sessionID }, result.sessionUser.user_id);
        console.log(`✅ Google sign-in: ${result.sessionUser.email} → ${result.sessionUser.workspace_id}`);
        const destination = oauth.returnTo || '/dashboard';
        res.redirect(destination);
      });
    });
  } catch (error) {
    console.error('❌ Google sign-in failed:', error.message);
    loginErrorRedirect(res, 'Google sign-in failed. Please try again.');
  }
});

router.get('/auth/onboarding', (req, res) => res.redirect('/dashboard'));

module.exports = router;
module.exports.safeReturnPath = safeReturnPath;
