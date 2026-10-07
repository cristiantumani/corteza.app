/**
 * Google Drive for Settings → Context for the AI: a `drive.file` token (Google Identity
 * Services) and Google's file Picker. The token stays in this page's memory for its hour and
 * is only sent to our server to read the picked file; Corteza never stores it.
 * Spec: docs/specs/2026-10-context-from-drive.md. Used by settings-context.js.
 */
(function() {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  let config = null;
  let ready = null;
  let failed = false; // Google's scripts didn't load (offline, an ad blocker)
  let tokenClient = null;
  let token = null; // { value, expiresAt }
  let pending = null; // { resolve, reject } of the token request in flight

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('script'));
      document.head.appendChild(script);
    });
  }

  /**
   * Loads Google's scripts ahead of the click (the sign-in popup must open on the click itself)
   * @param {{ client_id: string, api_key: string, app_id: string, mime_types: string[] }} driveConfig
   */
  function setup(driveConfig) {
    if (ready || !driveConfig) return ready;
    config = driveConfig;
    ready = Promise.all([
      loadScript('https://accounts.google.com/gsi/client'),
      loadScript('https://apis.google.com/js/api.js').then(() => new Promise(resolve => window.gapi.load('picker', resolve)))
    ]).then(() => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.client_id,
        scope: SCOPE,
        callback: response => {
          const request = pending;
          pending = null;
          if (!request) return;
          if (response.error || !response.access_token) return request.reject(new Error(response.error || 'denied'));
          token = { value: response.access_token, expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60000 };
          request.resolve(token.value);
        },
        error_callback: error => {
          const request = pending;
          pending = null;
          if (request) request.reject(new Error((error && error.type) || 'popup'));
        }
      });
    });
    ready.catch(() => { failed = true; });
    return ready;
  }

  /** @returns {'ready'|'loading'|'failed'} whether the button can work yet */
  function status() {
    return tokenClient ? 'ready' : failed ? 'failed' : 'loading';
  }

  /**
   * A token: the one in memory, or Google's popup (call it straight from a click)
   * @returns {Promise<string>}
   */
  function getToken() {
    if (token && token.expiresAt > Date.now()) return Promise.resolve(token.value);
    if (!tokenClient) return Promise.reject(new Error('not ready'));
    return new Promise((resolve, reject) => {
      if (pending) pending.reject(new Error('replaced'));
      pending = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /** Forgets the token (Drive said it expired) */
  function forgetToken() {
    token = null;
  }

  /**
   * Opens Google's Picker
   * @param {string} accessToken
   * @param {{ title: string, locale?: string }} options
   * @returns {Promise<string|null>} the picked file id, or null when cancelled
   */
  function pick(accessToken, { title, locale }) {
    const picker = window.google.picker;
    return new Promise(resolve => {
      const view = new picker.DocsView(picker.ViewId.DOCS)
        .setMimeTypes(config.mime_types.join(','))
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const builder = new picker.PickerBuilder()
        .addView(view)
        .enableFeature(picker.Feature.SUPPORT_DRIVES)
        .setOAuthToken(accessToken)
        .setDeveloperKey(config.api_key)
        .setAppId(config.app_id)
        .setOrigin(window.location.origin)
        .setTitle(title)
        .setCallback(data => {
          if (data.action === picker.Action.PICKED) resolve(data.docs && data.docs[0] ? data.docs[0].id : null);
          else if (data.action === picker.Action.CANCEL) resolve(null);
        });
      if (locale) builder.setLocale(locale);
      builder.build().setVisible(true);
    });
  }

  window.CortezaDrive = { setup, status, getToken, forgetToken, pick };
})();
