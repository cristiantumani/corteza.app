const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidTimeZone, localTime } = require('../../src/core/users/timezone');

test('only real time zone names are accepted', () => {
  assert.equal(isValidTimeZone('America/Santiago'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone({ $ne: '' }), false);
  assert.equal(isValidTimeZone('A'.repeat(100)), false);
});

test("local date, weekday and hour in a person's time zone", () => {
  const now = new Date('2026-09-30T02:30:00Z'); // Wednesday in UTC
  assert.deepEqual(localTime(now, 'UTC'), { date: '2026-09-30', weekday: 3, hour: 2 });
  assert.deepEqual(localTime(now, 'America/Santiago'), { date: '2026-09-29', weekday: 2, hour: 23 });
  assert.deepEqual(localTime(new Date('2026-09-30T00:00:00Z'), 'UTC').hour, 0, 'midnight is 0, not 24');
  assert.deepEqual(localTime(now, 'nope'), localTime(now, 'UTC'));
});
