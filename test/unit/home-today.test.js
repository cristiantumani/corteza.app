const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildToday } = require('../../src/core/home/today');

// "Prepare your day" on Home (docs/specs/2026-10-home-today.md)
const CALENDAR = 'https://www.googleapis.com/auth/calendar.events.readonly';
const NOW = new Date('2026-10-09T15:00:00Z');
const connection = scopes => ({ status: 'active', scopes, google_email: 'ana@acme.io' });
const meeting = (title, start, end) => ({ title, start, end, items: [], questions: [], closed: [] });

test('no Google connection, or one that needs reconnecting: nothing to show', async () => {
  for (const conn of [null, { ...connection([CALENDAR]), status: 'needs_reconnect' }]) {
    const result = await buildToday('W', 'U', { now: NOW, deps: { getConnection: async () => conn, getMeetingPrep: async () => { throw new Error('not called'); } } });
    assert.deepEqual(result, { status: 'no_google', meetings: [] });
  }
});

test('connected without the calendar: invite to connect it, without asking Google', async () => {
  const result = await buildToday('W', 'U', {
    now: NOW,
    deps: { getConnection: async () => connection(['https://www.googleapis.com/auth/meetings.space.readonly']), getMeetingPrep: async () => { throw new Error('not called'); } }
  });
  assert.deepEqual(result, { status: 'no_calendar', meetings: [] });
});

test('meetings still ahead or running stay; ones that ended drop off; the Google part is cached', async () => {
  let options = null;
  const result = await buildToday('W', 'U', {
    now: NOW,
    timeZone: 'America/Santiago',
    deps: {
      getConnection: async () => connection([CALENDAR]),
      getMeetingPrep: async (workspaceId, userId, opts) => {
        options = opts;
        return [
          meeting('Ended', '2026-10-09T13:00:00Z', '2026-10-09T14:00:00Z'),
          meeting('Running', '2026-10-09T14:30:00Z', '2026-10-09T15:30:00Z'),
          meeting('Later', '2026-10-09T18:00:00Z', '2026-10-09T19:00:00Z')
        ];
      }
    }
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.meetings.map(m => m.title), ['Running', 'Later']);
  assert.equal(options.cache, true);
  assert.equal(options.timeZone, 'America/Santiago');
});
