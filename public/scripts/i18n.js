/**
 * Texts in the person's language for the browser (src/core/i18n/i18n.js has the rules).
 * The page carries the dictionary in window.__CORTEZA_I18N__ (added by the server).
 *
 *   t('nav.home')                            → "Inicio"
 *   t('home.summary.overdue', { count: 2 })  → plural form for 2
 *   CortezaI18n.lang                         → 'en' | 'es' (also for dates: toLocaleDateString(CortezaI18n.locale))
 *
 * t() returns plain text: escape it (escapeHtml) before innerHTML, or use textContent.
 */
(function() {
  'use strict';
  const data = window.__CORTEZA_I18N__ || { lang: 'en', messages: {}, fallback: null };
  const lookup = (messages, key) => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), messages);

  function t(key, vars) {
    vars = vars || {};
    let value = lookup(data.messages, key);
    if (value === undefined && data.fallback) value = lookup(data.fallback, key);
    if (value && typeof value === 'object') {
      const count = Number(vars.count) || 0;
      const form = count === 0 && value.zero !== undefined ? 'zero' : new Intl.PluralRules(data.lang).select(count);
      value = value[form] !== undefined ? value[form] : value.other;
    }
    if (typeof value !== 'string') return key;
    return value.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined || vars[name] === null ? match : String(vars[name])));
  }

  window.t = t;
  window.CortezaI18n = { t, lang: data.lang, locale: data.lang === 'es' ? 'es' : 'en-US' };
})();
