const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRange, maxDaysBack, importCutoff, MAX_RANGE_DAYS } = require('../../src/ingestion/meet-import');

const NOW = new Date('2026-09-27T12:00:00Z');

/** Runs fn with MEET_IMPORT_MAX_DAYS set (undefined: unset) */
function withMaxDays(value, fn) {
  const before = process.env.MEET_IMPORT_MAX_DAYS;
  if (value === undefined) delete process.env.MEET_IMPORT_MAX_DAYS;
  else process.env.MEET_IMPORT_MAX_DAYS = value;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.MEET_IMPORT_MAX_DAYS;
    else process.env.MEET_IMPORT_MAX_DAYS = before;
  }
}

test('during the beta, imports reach back 7 days by default', () => withMaxDays(undefined, () => {
  assert.equal(maxDaysBack(), 7);
  assert.equal(importCutoff(NOW).toISOString(), '2026-09-20T00:00:00.000Z');
  assert.ok(parseRange('2026-09-20', '2026-09-27', NOW).from);
  assert.equal(parseRange('2026-09-19', '2026-09-27', NOW).error, 'You can import meetings from the last 7 days.');
  assert.equal(parseRange('2026-08-01', '2026-08-31', NOW).error, 'You can import meetings from the last 7 days.');
}));

test('MEET_IMPORT_MAX_DAYS changes the limit, up to the longest period', () => {
  withMaxDays('30', () => assert.equal(maxDaysBack(), 30));
  withMaxDays('1000', () => assert.equal(maxDaysBack(), MAX_RANGE_DAYS));
  withMaxDays('nonsense', () => assert.equal(maxDaysBack(), 7));
});

test('a month is parsed as whole UTC days, end date inclusive', () => withMaxDays('92', () => {
  const range = parseRange('2026-08-01', '2026-08-31', NOW);
  assert.equal(range.from.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-09-01T00:00:00.000Z');
}));

test('a single day is allowed', () => {
  const range = parseRange('2026-09-27', '2026-09-27', NOW);
  assert.equal(range.to - range.from, 24 * 60 * 60 * 1000);
});

test('invalid, reversed, future and too-long ranges are rejected', () => withMaxDays('92', () => {
  assert.match(parseRange('', '2026-08-31', NOW).error, /start and end/);
  assert.match(parseRange('2026-13-01', '2026-08-31', NOW).error, /start and end/);
  assert.match(parseRange('2026-08-31', '2026-08-01', NOW).error, /on or after/);
  assert.match(parseRange('2026-10-01', '2026-10-05', NOW).error, /future/);
  assert.match(parseRange('2026-01-01', '2026-09-01', NOW).error, new RegExp(`${MAX_RANGE_DAYS} days`));
}));

test('import errors are plain language, without Google’s technical details', () => {
  const { importErrorMessage } = require('../../src/ingestion/meet-import');
  const refusal = (extra = {}) => Object.assign(new Error('403'), { response: { status: 403, data: { error: { message: 'The user has not granted the app 123 read access to the file abc.' } } } }, extra);
  assert.equal(importErrorMessage(refusal({ meetSource: 'notes' }), 'content'), 'Google doesn’t let Corteza read this meeting’s Gemini notes.');
  assert.match(importErrorMessage(refusal({ meetSource: 'notes' }), 'content', { needsReconsent: true }), /reconnect Google Meet/);
  assert.equal(importErrorMessage(refusal({ meetSource: 'transcript' }), 'content'), 'Google doesn’t let Corteza read this meeting’s transcript.');
  assert.equal(importErrorMessage(refusal(), 'meeting'), 'You don’t have access to this meeting.');
  assert.equal(importErrorMessage(new Error('socket hang up'), 'content'), 'Something went wrong reading this meeting. Try importing it again later.');
});
