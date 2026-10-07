const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildHeadline, EMAIL_ONLY } = require('../../src/core/home/headline');

const today = '2026-10-07';
const owned = [
  { item_id: 'a1', text: 'Send the board deck', due_date: '2026-10-05', new_from_colleague: false },
  { item_id: 'a2', text: 'Assigned an hour ago', due_date: '2026-10-01', new_from_colleague: true },
  { item_id: 'a3', text: 'Book the venue', due_date: null }
];

test('Classic gets no line: the page writes the plain counts', () => {
  const headline = buildHeadline({ voiceName: 'classic', lang: 'es', owned, today, seed: 'U1:x' });
  assert.deepEqual(headline, { voice: 'classic', situation: 'overdue_few', title: null, follow: null, item_id: null });
});

test('a partner line: same situation as the email, stable for the day, never an email-only line', () => {
  const seen = new Set();
  for (let day = 1; day <= 40; day++) {
    for (const voiceName of ['sergeant', 'sarcastic']) {
      for (const lang of ['en', 'es']) {
        const seed = `U1:2026-10-${day}`;
        const one = buildHeadline({ voiceName, lang, owned, today, seed });
        const again = buildHeadline({ voiceName, lang, owned, today, seed });
        assert.deepEqual(one, again, 'a reload keeps the line');
        assert.equal(one.situation, 'overdue_few');
        assert.ok(one.title && !EMAIL_ONLY.test(`${one.title} ${one.follow}`), `no email-only line: ${one.title}`);
        assert.ok(!`${one.title} ${one.follow}`.includes('Assigned an hour ago'), 'never names an item a colleague just assigned');
        seen.add(one.title);
      }
    }
  }
  assert.ok(seen.size > 4, 'different days get different lines');
});

test('all clear and due today pick their own situations', () => {
  assert.equal(buildHeadline({ voiceName: 'sarcastic', lang: 'en', owned: [], today, seed: 's' }).situation, 'all_clear');
  const due = buildHeadline({ voiceName: 'sergeant', lang: 'en', owned: [{ item_id: 'd', text: 'Ship it', due_date: today }], today, seed: 's' });
  assert.equal(due.situation, 'due_today');
});
