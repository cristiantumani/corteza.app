const fs = require('fs');
const path = require('path');

/**
 * The app's languages: English and Spanish (docs/specs/2026-10-i18n.md).
 *
 * Texts live in public/i18n/<lang>.json, nested by area ("home.summary.caughtUp"). The same
 * files serve the server (pages, emails) and the browser (public/scripts/i18n.js).
 * - Values may hold {name} placeholders, filled from `vars`.
 * - A value that's an object with `one`/`other` (and `zero`) is a plural, picked with `vars.count`.
 * - Static page text is written {{t:key}} in src/views ({{tu:key}} inside a URL); localizeHtml fills it per language.
 *
 * The person's language: what they picked in Settings (workspace_members.language, kept in the
 * session), else their browser's (Accept-Language), else English.
 */

const LANGUAGES = /** @type {const} */ (['en', 'es']);
const DEFAULT_LANGUAGE = 'en';
const dir = path.join(__dirname, '../../../public/i18n');
/** @type {Record<string, Object>} */
const MESSAGES = Object.fromEntries(LANGUAGES.map(lang => [lang, JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8'))]));

/** @param {unknown} value @returns {value is 'en'|'es'} */
function isLanguage(value) {
  return typeof value === 'string' && LANGUAGES.includes(/** @type {any} */ (value));
}

/**
 * The first supported language in an Accept-Language header ("es-CL,es;q=0.9,en;q=0.8" → 'es')
 * @param {string|undefined} header
 * @returns {'en'|'es'}
 */
function languageFromHeader(header) {
  const ranked = String(header || '').split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
      return { lang: tag.toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, index };
    })
    .filter(entry => entry.lang)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const match = ranked.find(entry => isLanguage(entry.lang));
  return match ? /** @type {'en'|'es'} */ (match.lang) : DEFAULT_LANGUAGE;
}

/**
 * The language to answer a request in
 * @param {{ session?: any, headers?: Record<string, any> }} req
 * @returns {'en'|'es'}
 */
function requestLanguage(req) {
  const chosen = req.session && req.session.user && req.session.user.language;
  if (isLanguage(chosen)) return chosen;
  return languageFromHeader(req.headers && req.headers['accept-language']);
}

/** @param {Object} messages @param {string} key */
function lookup(messages, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), messages);
}

/**
 * A text in a language, with {placeholders} filled; English when the key is missing in that language,
 * the key itself when it's missing everywhere
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, any>} [vars]
 * @returns {string} plain text (escape it before putting it in HTML)
 */
function translate(lang, key, vars = {}) {
  const language = isLanguage(lang) ? lang : DEFAULT_LANGUAGE;
  let value = lookup(MESSAGES[language], key);
  if (value === undefined) value = lookup(MESSAGES[DEFAULT_LANGUAGE], key);
  if (value && typeof value === 'object') {
    const count = Number(vars.count) || 0;
    const form = count === 0 && value.zero !== undefined ? 'zero' : new Intl.PluralRules(language).select(count);
    value = value[form] !== undefined ? value[form] : value.other;
  }
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined || vars[name] === null ? match : String(vars[name])));
}

/** @param {string} text */
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON that is safe inside a <script> tag */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A page in one language: {{t:key}} filled (escaped), <html lang> set, and the browser's
 * dictionary and t() added before </head>
 * @param {string} html
 * @param {string} lang
 * @returns {string}
 */
function localizeHtml(html, lang) {
  const language = isLanguage(lang) ? lang : DEFAULT_LANGUAGE;
  const dictionary = `<script>window.__CORTEZA_I18N__ = ${scriptJson({ lang: language, messages: MESSAGES[language], fallback: language === DEFAULT_LANGUAGE ? null : MESSAGES[DEFAULT_LANGUAGE] })};</script>\n<script src="/scripts/i18n.js?v=1"></script>\n`;
  return html
    .replace(/\{\{t:([\w.]+)\}\}/g, (match, key) => escapeHtml(translate(language, key)))
    .replace(/\{\{tu:([\w.]+)\}\}/g, (match, key) => encodeURIComponent(translate(language, key)))
    .replace(/<html([^>]*?) lang="[^"]*"/, (match, attributes) => `<html${attributes} lang="${language}"`)
    .replace('</head>', () => `${dictionary}</head>`);
}

/**
 * A page rendered once per language at startup
 * @param {string} html - with {{t:key}} placeholders
 * @returns {(req: Object) => string} the page in the request's language
 */
function localizedPage(html) {
  const pages = Object.fromEntries(LANGUAGES.map(lang => [lang, localizeHtml(html, lang)]));
  return req => pages[requestLanguage(req)];
}

module.exports = {
  LANGUAGES, DEFAULT_LANGUAGE, MESSAGES,
  isLanguage, languageFromHeader, requestLanguage, translate, localizeHtml, localizedPage, escapeHtml
};
