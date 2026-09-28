const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const beta = require('../../src/core/beta/beta-access');

describe('beta approval links', () => {
  beforeEach(() => { process.env.BETA_APPROVAL_SECRET = 'test-beta-secret'; });

  test('a signed token round-trips, with accents in the name', () => {
    const token = beta.signApprovalToken({ email: 'Ana@Acme.com', name: 'Ana María', company: 'Acme' });
    assert.deepEqual(beta.verifyApprovalToken(token), { email: 'ana@acme.com', name: 'Ana María', company: 'Acme' });
  });

  test('matches the format the website signs (base64url JSON + base64url HMAC-SHA256 of "beta-approve:" + payload)', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'bo@x.io', name: 'Bo', company: null, exp: Date.now() + 60000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', 'test-beta-secret').update(`beta-approve:${payload}`).digest('base64url');
    assert.equal(beta.verifyApprovalToken(`${payload}.${signature}`).email, 'bo@x.io');
  });

  test('rejects tampered, expired, malformed or unsigned tokens', () => {
    const token = beta.signApprovalToken({ email: 'ana@acme.com' });
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ email: 'evil@x.com', exp: Date.now() + 60000 })).toString('base64url');

    assert.equal(beta.verifyApprovalToken(`${forged}.${signature}`), null);
    assert.equal(beta.verifyApprovalToken(`${payload}.${signature}x`), null);
    assert.equal(beta.verifyApprovalToken(beta.signApprovalToken({ email: 'ana@acme.com' }, -1)), null);
    assert.equal(beta.verifyApprovalToken('nope'), null);
    assert.equal(beta.verifyApprovalToken(undefined), null);
    assert.equal(beta.verifyApprovalToken(`${token}.extra`), null);

    process.env.BETA_APPROVAL_SECRET = 'another-secret';
    assert.equal(beta.verifyApprovalToken(token), null);
    delete process.env.BETA_APPROVAL_SECRET;
    assert.equal(beta.verifyApprovalToken(token), null);
  });

  test('early access URL carries the email and where they came from', () => {
    const url = new URL(beta.earlyAccessUrl('ana+x@acme.com'));
    assert.equal(url.searchParams.get('email'), 'ana+x@acme.com');
    assert.equal(url.searchParams.get('from'), 'signin');
  });
});
