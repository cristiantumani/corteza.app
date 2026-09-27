const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRange, MAX_RANGE_DAYS } = require('../../src/ingestion/meet-import');

const NOW = new Date('2026-09-27T12:00:00Z');

test('a month is parsed as whole UTC days, end date inclusive', () => {
  const range = parseRange('2026-08-01', '2026-08-31', NOW);
  assert.equal(range.from.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-09-01T00:00:00.000Z');
});

test('a single day is allowed', () => {
  const range = parseRange('2026-09-27', '2026-09-27', NOW);
  assert.equal(range.to - range.from, 24 * 60 * 60 * 1000);
});

test('invalid, reversed, future and too-long ranges are rejected', () => {
  assert.match(parseRange('', '2026-08-31', NOW).error, /start and end/);
  assert.match(parseRange('2026-13-01', '2026-08-31', NOW).error, /start and end/);
  assert.match(parseRange('2026-08-31', '2026-08-01', NOW).error, /on or after/);
  assert.match(parseRange('2026-10-01', '2026-10-05', NOW).error, /future/);
  assert.match(parseRange('2026-01-01', '2026-09-01', NOW).error, new RegExp(`${MAX_RANGE_DAYS} days`));
});

test('import errors say what Google refused and why', () => {
  const { importErrorMessage } = require('../../src/ingestion/meet-import');
  const refusal = (extra = {}) => Object.assign(new Error('403'), { response: { status: 403, data: { error: { message: 'The caller does not have permission' } } } }, extra);
  assert.equal(importErrorMessage(refusal({ meetSource: 'notes' }), 'content'), 'Google didn’t let Corteza read the Gemini notes: The caller does not have permission');
  assert.equal(importErrorMessage(refusal(), 'meeting'), 'Google didn’t let Corteza read this meeting: The caller does not have permission');
  assert.equal(importErrorMessage(new Error('boom'), 'content'), 'boom');
});
