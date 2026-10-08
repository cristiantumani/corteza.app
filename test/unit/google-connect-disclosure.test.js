const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.BASE_URL = 'https://app.example.com';

console.log = () => {};

const router = require('../../src/integrations/google/routes');

// Google's verification asks for an in-app disclosure of each permission before the consent screen
describe('connect Google: what each permission is for, before Google asks', () => {
  let server;
  let base;
  let user;

  before(() => {
    const app = express();
    app.use((req, res, next) => {
      req.session = { user, save: callback => callback() };
      next();
    });
    app.use(router);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server && server.close());

  const get = path => fetch(base + path, { redirect: 'manual' });

  test('every Connect link shows the permissions first, in the person’s language', async () => {
    user = { workspace_id: 'W1', user_id: 'U1', email: 'ana@acme.com', language: 'es' };
    const response = await get('/integrations/google/connect');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Antes de conectar Google/);
    assert.match(html, /Ver y descargar tus archivos de Google Drive/, 'names the broad Drive permission as Google does');
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /href="\/integrations\/google\/connect\?continue=1"/);
  });

  test('Continue goes to Google’s consent screen', async () => {
    user = { workspace_id: 'W1', user_id: 'U1', email: 'ana@acme.com', language: 'en' };
    const response = await get('/integrations/google/connect?continue=1');
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.hostname, 'accounts.google.com');
    assert.match(location.searchParams.get('scope'), /meetings\.space\.readonly/);
  });

  test('signed out: to the login page', async () => {
    user = undefined;
    const response = await get('/integrations/google/connect');
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /^\/auth\/login/);
  });
});
