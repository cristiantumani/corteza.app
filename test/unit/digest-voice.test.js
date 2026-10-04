const { test } = require('node:test');
const assert = require('node:assert/strict');
const voice = require('../../src/core/digest/voice');

const BANNED = /\b(damn|hell|shit|fuck\w*|crap|ass|bitch|idiot\w*|stupid|lazy|dumb|loser|useless|mierda|carajo|puta\w*|we[oó]n\w*|hue[vb][oó]n\w*|co[ñn]o|joder|pendej\w*|est[uú]pid\w*|flojo|floja|in[uú]til\w*|tont[oa]s?)\b/i;
const longestWeekday = { en: 'Wednesday', es: 'miércoles' };

test('situations follow the spec table, including the overloaded threshold', () => {
  const s = summary => voice.pickSituation({ meetings: 1, ...summary });
  assert.equal(s({ overdue: 0, dueToday: 0 }), 'all_clear');
  assert.equal(s({ overdue: 0, dueToday: 2 }), 'due_today');
  assert.equal(s({ overdue: 1, dueToday: 2 }), 'overdue_few');
  assert.equal(s({ overdue: 2 }), 'overdue_few');
  assert.equal(s({ overdue: 3 }), 'overdue_pile');
  assert.equal(s({ overdue: 5 }), 'overdue_pile');
  assert.equal(s({ overdue: 6 }), 'overloaded');
  assert.equal(voice.pickSituation({ meetings: 0, newActionItems: 0, meetingPrep: [{}] }), 'prep_only');
  assert.equal(voice.pickSituation({ meetings: 2, meetingPrep: [{}] }), 'all_clear', 'news and prep: not prep only');
});

test('every voice has at least 8 lines per situation in English and Spanish, short, clean and well-formed', () => {
  for (const name of voice.PARTNER_VOICES) {
    for (const language of voice.LANGUAGES) {
      for (const situation of voice.SITUATIONS) {
        const lines = voice.LIBRARY[name][language][situation];
        assert.ok(lines.length >= 8, `${name}.${language}.${situation} has ${lines.length} lines`);
        lines.forEach(([opening, follow], index) => {
          const where = `${name}.${language}.${situation}.${index}`;
          assert.ok(!opening.includes('{item}'), `${where}: the subject never names an item`);
          assert.ok(!BANNED.test(`${opening} ${follow}`), `${where}: banned word`);
          const subject = opening.replace('{count}', '99').replace('{weekday}', longestWeekday[language]);
          assert.ok(subject.length <= 72, `${where}: subject too long (${subject.length})`);
          assert.ok(!/[{}]/.test(`${opening}${follow}`.replace(/\{(count|weekday|item)\}/g, '')), `${where}: unknown placeholder`);
          if (language === 'es' && situation === 'overdue_few') assert.ok(!opening.includes('{count} atrasados'), `${where}: "1 atrasados"`);
        });
      }
    }
  }
});

test('a line is not repeated within the recent ones, and placeholders are filled', () => {
  const lines = voice.LIBRARY.sergeant.en.overdue_pile;
  const ids = lines.map((line, index) => `sergeant.en.overdue_pile.${index}`);
  const line = voice.pickLine({ voice: 'sergeant', situation: 'overdue_pile', language: 'en', recentLineIds: ids.slice(1), vars: { count: 4, weekday: 'Monday', item: 'Send the deck' } });
  assert.equal(line.id, ids[0], 'the only line not sent recently');
  assert.equal(line.subject, '4 overdue. Excuses don’t ship. You do. Move.');
  assert.equal(line.followUp, 'Start with “Send the deck”.');
  assert.equal(line.opener, line.subject);

  const all = voice.pickLine({ voice: 'sergeant', situation: 'overdue_pile', language: 'en', recentLineIds: ids, vars: { count: 4 } });
  assert.ok(ids.includes(all.id), 'when every line was used recently, any line goes');
});

test('without an item it may name, a line that names one uses the generic follow-up', () => {
  const line = voice.pickLine({ voice: 'sarcastic', situation: 'overdue_few', language: 'es', vars: { count: 1, item: null }, random: () => 0 });
  assert.equal(line.followUp, 'Empieza por el primero de la lista de abajo.');
  for (let index = 0; index < 8; index++) {
    for (const situation of voice.SITUATIONS) {
      const picked = voice.pickLine({ voice: 'sarcastic', situation, language: 'en', vars: { count: 2, weekday: 'Monday', item: null }, random: () => index / 8 });
      assert.ok(!/[{}]/.test(picked.subject + picked.followUp), `${picked.id} left a placeholder`);
    }
  }
});

test('long items are clipped to 60 characters', () => {
  const item = 'x'.repeat(100);
  const line = voice.pickLine({ voice: 'sergeant', situation: 'overdue_pile', language: 'en', recentLineIds: [], vars: { count: 3, item }, random: () => 0 });
  assert.ok(line.followUp.includes(`${'x'.repeat(59)}…`));
});

test('the voice: the person\'s pick, else the default (Sarcastic, or DIGEST_DEFAULT_VOICE); Classic when the workspace turned it off', () => {
  const saved = process.env.DIGEST_DEFAULT_VOICE;
  delete process.env.DIGEST_DEFAULT_VOICE;
  assert.equal(voice.resolveVoice({}), 'sarcastic');
  assert.equal(voice.resolveVoice({ digest_voice: 'sergeant' }), 'sergeant');
  assert.equal(voice.resolveVoice({ digest_voice: 'pirate' }), 'sarcastic');
  assert.equal(voice.resolveVoice({ digest_voice: 'sergeant' }, { digest_voices_enabled: false }), 'classic');
  assert.equal(voice.resolveVoice({}, { digest_voices_enabled: true }), 'sarcastic');
  process.env.DIGEST_DEFAULT_VOICE = 'classic';
  assert.equal(voice.resolveVoice({}), 'classic');
  process.env.DIGEST_DEFAULT_VOICE = 'nonsense';
  assert.equal(voice.resolveVoice({}), 'sarcastic');
  if (saved === undefined) delete process.env.DIGEST_DEFAULT_VOICE; else process.env.DIGEST_DEFAULT_VOICE = saved;
});

test('the language: the Meet setting, else the items, else the last summary, else English', () => {
  assert.equal(voice.pickLanguage({ setting: 'es', texts: ['Send the deck to the team'] }), 'es');
  assert.equal(voice.pickLanguage({ setting: 'auto', texts: ['Enviar la propuesta a los clientes de la región'] }), 'es');
  assert.equal(voice.pickLanguage({ setting: 'pt', texts: [] , previous: 'es' }), 'es');
  assert.equal(voice.pickLanguage({ setting: null, texts: [] }), 'en');
});
