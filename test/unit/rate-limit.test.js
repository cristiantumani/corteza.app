const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { apiRateLimiter, rateLimitKey } = require('../../src/middleware/auth');

test('rate limits count per signed-in person, and per IP without a session', () => {
  assert.equal(rateLimitKey({ session: { user: { user_id: 'U1', workspace_id: 'W1' } }, ip: '1.2.3.4' }), 'user:W1:U1');
  assert.equal(rateLimitKey({ session: {}, ip: '1.2.3.4' }), 'ip:1.2.3.4');
});

test('a signed-in person can make hundreds of API calls; anonymous callers are capped at 100', async () => {
  const app = express();
  app.use((req, res, next) => {
    req.session = req.headers['x-user'] ? { user: { user_id: req.headers['x-user'], workspace_id: 'W1' } } : {};
    next();
  });
  app.get('/api/ping', apiRateLimiter, (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/ping`;
  try {
    const statuses = async (headers, n) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push((await fetch(base, { headers })).status);
      return out;
    };
    const ana = await statuses({ 'x-user': 'UA' }, 150);
    assert.ok(ana.every(s => s === 200), 'Ana editing cards is not blocked');
    const bob = await statuses({ 'x-user': 'UB' }, 5);
    assert.ok(bob.every(s => s === 200), "Bob, same IP, has his own budget");
    const anonymous = await statuses({}, 101);
    assert.equal(anonymous[99], 200);
    assert.equal(anonymous[100], 429);
  } finally {
    server.close();
  }
});
