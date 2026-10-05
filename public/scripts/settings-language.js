/**
 * Settings → Language: the app's language for this person (English, Español, or the browser's).
 * Talks to /api/me/language (src/http/language.js); the page reloads in the new language.
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const $ = id => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', async () => {
    const select = $('language-select');
    if (!select) return;
    try {
      const response = await fetch('/api/me/language', { credentials: 'include' });
      const data = await response.json();
      if (response.ok && data.success) select.value = data.chosen || '';
    } catch (error) { /* keeps "Follow my browser" */ }

    select.addEventListener('change', async () => {
      const status = $('language-status');
      status.textContent = t('common.saving');
      select.disabled = true;
      try {
        const response = await fetch('/api/me/language', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ language: select.value || null })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || t('common.couldNotSave'));
        // Reload so the whole page shows in the new language
        window.location.hash = 'language';
        window.location.reload();
      } catch (error) {
        select.disabled = false;
        status.textContent = t('common.tryAgain', { error: error.message });
      }
    });
  });
})();
