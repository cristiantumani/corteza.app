const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateQueryParams } = require('../../src/middleware/validation');

test('workspace ids from Google sign-in (ws_…) are accepted as they are', () => {
  assert.equal(validateQueryParams({ workspace_id: 'ws_5e3374885dd10c1c' }).workspace_id, 'ws_5e3374885dd10c1c');
});

test('legacy Slack and email workspace ids are still accepted, uppercased', () => {
  assert.equal(validateQueryParams({ workspace_id: 'T01ABCDEF' }).workspace_id, 'T01ABCDEF');
  assert.equal(validateQueryParams({ workspace_id: 'wninja-exce' }).workspace_id, 'WNINJA-EXCE');
});

test('anything else is dropped', () => {
  for (const bad of ['ws_', 'ws_NOTHEX!', 'ws_abc$ne', '{"$ne":1}', 'x_123', '']) {
    assert.equal(validateQueryParams({ workspace_id: bad }).workspace_id, undefined, bad);
  }
});

test('space ids keep their format check', () => {
  assert.equal(validateQueryParams({ space_id: 'sp_54ebd7947703b1352e8f9c21' }).space_id, 'sp_54ebd7947703b1352e8f9c21');
  assert.equal(validateQueryParams({ space_id: 'sp_bad' }).space_id, undefined);
});
