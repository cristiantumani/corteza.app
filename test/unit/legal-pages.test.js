const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

console.log = () => {};

const router = require('../../src/http/legal');

describe('privacy policy and terms (public pages)', () => {
  let server;
  let base;

  before(() => {
    const app = express();
    app.use(router);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server && server.close());

  async function get(path, headers = {}) {
    const response = await fetch(base + path, { headers });
    return { status: response.status, type: response.headers.get('content-type'), html: await response.text() };
  }

  test('served without signing in, in English by default', async () => {
    const page = await get('/privacy');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.html, /<html lang="en">/);
    assert.match(page.html, /<h1>Privacy Policy<\/h1>/);
    assert.match(page.html, /href="\/privacy\?lang=es"/, 'links the other language');
  });

  test('the privacy policy carries Google’s Limited Use statement and the contact', async () => {
    for (const lang of ['en', 'es']) {
      const { html } = await get(`/privacy?lang=${lang}`);
      assert.match(html, /Limited Use/, lang);
      assert.match(html, /developers\.google\.com\/terms\/api-services-user-data-policy/, lang);
      assert.match(html, /cristian@corteza\.app/, lang);
      for (const scope of ['meetings.space.readonly', 'drive.meet.readonly', 'drive.readonly', 'calendar.events.readonly', 'drive.file']) {
        assert.ok(html.includes(scope), `${lang}: ${scope}`);
      }
    }
  });

  test('?lang wins, then the browser’s language', async () => {
    assert.match((await get('/terms?lang=es')).html, /<h1>Términos del servicio<\/h1>/);
    assert.match((await get('/terms', { 'Accept-Language': 'es-CL,es;q=0.9' })).html, /<html lang="es">/);
    assert.match((await get('/terms?lang=xx', { 'Accept-Language': 'es' })).html, /<html lang="es">/, 'an unknown ?lang is ignored');
  });

  test('every placeholder is filled', () => {
    for (const doc of ['privacy', 'terms']) {
      for (const lang of ['en', 'es']) {
        const html = router.renderLegalPage(doc, lang);
        assert.doesNotMatch(html, /\{\{\w+\}\}|<!-- CONTENT -->/, `${doc}.${lang}`);
      }
    }
  });
});
