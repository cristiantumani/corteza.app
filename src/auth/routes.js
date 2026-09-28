const path = require('path');
const express = require('express');
const { getWorkspaceMembersCollection } = require('../config/database');
const { authRateLimiter } = require('../middleware/auth');
const google = require('../integrations/google/oauth');
const { signInWithGoogle } = require('./google-signin');
const { earlyAccessUrl } = require('../core/beta/beta-access');

/**
 * Sign-in routes. Google is the only way to log in.
 *
 *   GET  /auth/login               login page ("Continue with Google")
 *   GET  /auth/google              start Google sign-in (?invite=<id>&return=<path>)
 *   GET  /auth/google/callback     Google redirects back here
 *   GET  /auth/onboarding          first-run questions for a new workspace's creator
 *   POST /auth/complete-onboarding
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
      console.log(`🚪 Sign-in without beta access: ${result.email} → early access form`);
      return res.redirect(earlyAccessUrl(result.email));
    }

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
        console.log(`✅ Google sign-in: ${result.sessionUser.email} → ${result.sessionUser.workspace_id}`);
        const destination = result.needsOnboarding ? '/auth/onboarding' : (oauth.returnTo || '/dashboard');
        res.redirect(destination);
      });
    });
  } catch (error) {
    console.error('❌ Google sign-in failed:', error.message);
    loginErrorRedirect(res, 'Google sign-in failed. Please try again.');
  }
});

router.get('/auth/onboarding', async (req, res) => {
  if (!req.session?.user) return res.redirect('/auth/login');

  try {
    const member = await getWorkspaceMembersCollection().findOne({
      user_id: req.session.user.user_id,
      workspace_id: req.session.user.workspace_id,
      removed_at: null
    });
    if (member && member.onboarding_completed) return res.redirect('/dashboard');
  } catch (error) {
    console.error('Failed to check onboarding status:', error);
  }

  res.sendFile(path.join(__dirname, '../views/onboarding.html'));
});

router.post('/auth/complete-onboarding', express.json(), async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { full_name, role, company_size, use_case, heard_about, early_access } = req.body || {};
    if (!full_name || !role || !company_size || !use_case || !heard_about) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const { user_id, workspace_id } = req.session.user;
    const result = await getWorkspaceMembersCollection().updateOne(
      { user_id, workspace_id, removed_at: null },
      {
        $set: {
          user_name: String(full_name).slice(0, 100),
          full_name: String(full_name).slice(0, 100),
          role_title: role,
          company_size,
          use_case,
          heard_about,
          early_access: early_access === true,
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString()
        }
      }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    req.session.user.user_name = String(full_name).slice(0, 100);
    res.json({ success: true, message: 'Onboarding completed successfully' });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete onboarding. Please try again.' });
  }
});

module.exports = router;
module.exports.safeReturnPath = safeReturnPath;
