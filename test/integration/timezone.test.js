const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, skip } = require('../helpers/db');

console.log = () => {};
console.warn = () => {};
console.error = () => {};

describe("a person's time zone: detected by the browser, or chosen in Settings", { skip }, () => {
  const WS = 'WTZ';
  let db;
  let cleanup;
  let tz;

  before(async () => {
    ({ cleanup } = await setupTestDatabase());
    db = require('../../src/config/database').getDatabase();
    tz = require('../../src/core/users/timezone');
    await db.collection('workspace_members').insertMany([
      { workspace_id: WS, user_id: 'UA', removed_at: null },
      { workspace_id: WS, user_id: 'UX', removed_at: new Date() }
    ]);
  });

  after(async () => {
    if (cleanup) await cleanup();
  });

  test('the browser sets it until the person picks one; then only the person changes it', async () => {
    assert.deepEqual(await tz.getTimeZone(WS, 'UA'), { timezone: null, source: null });
    assert.equal(await tz.saveTimeZone(WS, 'UA', 'America/Santiago'), true);
    assert.deepEqual(await tz.getTimeZone(WS, 'UA'), { timezone: 'America/Santiago', source: 'auto' });

    assert.equal(await tz.saveTimeZone(WS, 'UA', 'Europe/Madrid', { manual: true }), true);
    assert.equal(await tz.saveTimeZone(WS, 'UA', 'America/New_York'), false, 'travelling does not override a manual choice');
    assert.deepEqual(await tz.getTimeZone(WS, 'UA'), { timezone: 'Europe/Madrid', source: 'manual' });

    assert.equal(await tz.saveTimeZone(WS, 'UA', 'Not/AZone', { manual: true }), false);
    assert.equal(await tz.saveTimeZone(WS, 'UX', 'UTC'), false, 'removed members are left alone');
  });
});
