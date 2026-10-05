const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const i18n = require('../../src/core/i18n/i18n');

const root = path.join(__dirname, '../..');
const PLURAL_FORMS = new Set(['zero', 'one', 'other']);
const isPlural = value => value && typeof value === 'object' && Object.keys(value).every(k => PLURAL_FORMS.has(k));

/** key → string or plural object */
function flatten(node, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(node)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' || isPlural(value)) out[name] = value;
    else flatten(value, name, out);
  }
  return out;
}
const placeholders = value => [...new Set((typeof value === 'string' ? [value] : Object.values(value)).flatMap(text => text.match(/\{\w+\}/g) || []))].sort();
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

test('English and Spanish have the same keys and plural forms; Spanish uses no placeholder English lacks', () => {
  const en = flatten(i18n.MESSAGES.en);
  const es = flatten(i18n.MESSAGES.es);
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort(), 'every text exists in both languages');
  for (const key of Object.keys(en)) {
    assert.equal(isPlural(es[key]), isPlural(en[key]), `${key}: plural in one language only`);
    if (isPlural(en[key])) assert.ok(en[key].other && es[key].other, `${key}: needs an "other" form`);
    // Spanish may leave one out ("Confirmar todo lo de esta reunión" has no count), never add one
    for (const name of placeholders(es[key])) assert.ok(placeholders(en[key]).includes(name), `${key}: ${name} is not in English`);
    for (const text of typeof es[key] === 'string' ? [es[key]] : Object.values(es[key])) assert.ok(text.trim(), `${key}: empty in Spanish`);
  }
});

test('every key the pages and scripts use exists', () => {
  const en = flatten(i18n.MESSAGES.en);
  const missing = [];
  for (const file of walk(path.join(root, 'src/views'))) {
    for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(/\{\{tu?:([\w.]+)\}\}/g)) if (!(key in en)) missing.push(`${path.basename(file)}: ${key}`);
  }
  for (const file of walk(path.join(root, 'public/scripts')).filter(f => f.endsWith('.js'))) {
    for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z][\w]*\.[\w.]+)'/g)) if (!(key in en)) missing.push(`${path.basename(file)}: ${key}`);
  }
  assert.deepEqual(missing, []);
});

test('the language: the person\'s pick, else the browser\'s, else English', () => {
  assert.equal(i18n.languageFromHeader('es-CL,es;q=0.9,en;q=0.8'), 'es');
  assert.equal(i18n.languageFromHeader('en-US,en;q=0.9,es;q=0.8'), 'en');
  assert.equal(i18n.languageFromHeader('fr-FR,es;q=0.7'), 'es', 'the first supported one');
  assert.equal(i18n.languageFromHeader('pt-BR'), 'en');
  assert.equal(i18n.languageFromHeader(undefined), 'en');
  assert.equal(i18n.requestLanguage({ session: { user: { language: 'es' } }, headers: { 'accept-language': 'en' } }), 'es');
  assert.equal(i18n.requestLanguage({ session: { user: { language: 'xx' } }, headers: { 'accept-language': 'es' } }), 'es');
  assert.equal(i18n.requestLanguage({ headers: {} }), 'en');
});

test('texts fill placeholders and pick plural forms; a missing key falls back to English, then to the key', () => {
  assert.equal(i18n.translate('es', 'home.summary.newOutcomes', { count: 1 }), '1 resultado nuevo');
  assert.equal(i18n.translate('es', 'home.summary.newOutcomes', { count: 4 }), '4 resultados nuevos');
  assert.equal(i18n.translate('en', 'home.summary.newOutcomes', { count: 0 }), '0 new outcomes');
  assert.equal(i18n.translate('es', 'detail.mitigatedBy', { name: 'Ana' }), 'Mitigado por Ana');
  assert.equal(i18n.translate('xx', 'nav.home'), 'Home');
  assert.equal(i18n.translate('es', 'nope.missing'), 'nope.missing');
});

test('a page in Spanish: texts filled and escaped, <html lang>, and the dictionary for the browser', () => {
  const html = '<!DOCTYPE html><html class="light" lang="en"><head><title>{{t:home.pageTitle}}</title></head><body><a href="/q?q={{tu:onboarding.q1}}">{{t:onboarding.q1}}</a></body></html>';
  const es = i18n.localizeHtml(html, 'es');
  assert.match(es, /<html class="light" lang="es"/);
  assert.match(es, /<title>Inicio · Corteza<\/title>/);
  assert.match(es, /href="\/q\?q=%C2%BFQu%C3%A9%20decidimos/);
  assert.match(es, /window\.__CORTEZA_I18N__ = \{"lang":"es"/);
  assert.match(es, /<script src="\/scripts\/i18n\.js\?v=\d+"><\/script>\n<\/head>/);
  assert.ok(!es.includes('{{t:'));
});

test('every app page renders in both languages with no key left unfilled', () => {
  const { renderView } = require('../../src/http/page-partials');
  const en = flatten(i18n.MESSAGES.en);
  for (const [view, active] of [['dashboard-new.html', 'home'], ['settings-new.html', 'settings'], ['ai-search.html', 'search'], ['actions.html', 'actions'], ['questions.html', 'questions']]) {
    for (const lang of i18n.LANGUAGES) {
      const html = i18n.localizeHtml(renderView(view, { active }), lang);
      assert.ok(!/\{\{tu?:/.test(html), `${view} (${lang}) has an unfilled text`);
      for (const key of Object.keys(en)) assert.ok(!html.includes(`>${key}<`), `${view} (${lang}) shows the key ${key}`);
    }
  }
});
