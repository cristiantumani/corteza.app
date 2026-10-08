const fs = require('fs');
const path = require('path');
const express = require('express');
const { apiRateLimiter } = require('../middleware/auth');
const { LANGUAGES, isLanguage, requestLanguage } = require('../core/i18n/i18n');

/**
 * The privacy policy and terms of service, public (no sign-in): Google's OAuth verification and
 * the consent screen link to them.
 *
 *   GET /privacy   Privacy Policy (with the Google API Services "Limited Use" statement)
 *   GET /terms     Terms of Service
 *
 * In the language of ?lang=en|es, else the person's or the browser's (core/i18n). The texts live in
 * src/views/legal/<doc>.<lang>.html; English is the binding version.
 */
const router = express.Router();

const DOCS = /** @type {const} */ (['privacy', 'terms']);
const TITLES = {
  privacy: { en: 'Privacy Policy', es: 'Política de privacidad' },
  terms: { en: 'Terms of Service', es: 'Términos del servicio' }
};
const LANGUAGE_NAMES = { en: 'English', es: 'Español' };

const views = path.join(__dirname, '../views/legal');
const template = fs.readFileSync(path.join(views, 'page.html'), 'utf8');

/**
 * One legal page, ready to send
 * @param {'privacy'|'terms'} doc
 * @param {string} lang
 * @returns {string}
 */
function renderLegalPage(doc, lang) {
  const language = isLanguage(lang) ? lang : 'en';
  const other = language === 'en' ? 'es' : 'en';
  const content = fs.readFileSync(path.join(views, `${doc}.${language}.html`), 'utf8');
  const values = {
    lang: language,
    title: TITLES[doc][language],
    otherLang: other,
    otherLabel: LANGUAGE_NAMES[other],
    otherHref: `/${doc}?lang=${other}`,
    privacyLabel: TITLES.privacy[language],
    termsLabel: TITLES.terms[language]
  };
  return template
    .replace(/\{\{(\w+)\}\}/g, (match, key) => (key in values ? values[key] : match))
    .replace('<!-- CONTENT -->', () => content);
}

// Rendered once per language
const pages = Object.fromEntries(DOCS.map(doc => [doc, Object.fromEntries(LANGUAGES.map(lang => [lang, renderLegalPage(doc, lang)]))]));

for (const doc of DOCS) {
  router.get(`/${doc}`, apiRateLimiter, (req, res) => {
    const lang = isLanguage(req.query.lang) ? req.query.lang : requestLanguage(req);
    res.type('html').send(pages[doc][lang]);
  });
}

module.exports = router;
module.exports.renderLegalPage = renderLegalPage;
