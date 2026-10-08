/**
 * Morning partner: the voice of a person's daily summary (docs/specs/2026-10-morning-partner.md).
 *
 * A personality (The Sergeant, The Sarcastic Colleague) opens the email with a line that fits
 * the day: it becomes the subject, and the counts move to the preheader. Lines are fixed,
 * hand-written text in `lines/<voice>.<language>.js` (no AI), picked so a person doesn't get
 * the same one twice within REPEAT_DAYS. Classic is today's plain summary.
 *
 * Only ids and situations are stored or tracked, never a line's text.
 */
const { detectLanguage } = require('../language/detect');

const VOICES = /** @type {const} */ (['classic', 'sergeant', 'sarcastic']);
const PARTNER_VOICES = ['sergeant', 'sarcastic'];
const LANGUAGES = ['en', 'es'];
const SITUATIONS = ['all_clear', 'due_today', 'overdue_few', 'overdue_pile', 'overloaded', 'prep_only'];
const REPEAT_DAYS = 14;
const ITEM_MAX = 60;

const LIBRARY = {
  sergeant: { en: require('./lines/sergeant.en'), es: require('./lines/sergeant.es') },
  sarcastic: { en: require('./lines/sarcastic.en'), es: require('./lines/sarcastic.es') }
};

/** Follow-up for a line that names {item} when no item may be named (spec, point 6) */
const GENERIC_FOLLOW = {
  en: 'Start with the first one on the list below.',
  es: 'Empieza por el primero de la lista de abajo.'
};

/** One line per voice for the Settings picker, in the app's language */
const SAMPLES = {
  en: {
    classic: 'Your day: 2 overdue, 1 due today · since yesterday: 3 meetings',
    sergeant: '3 overdue. Excuses don’t ship. You do. Move.',
    sarcastic: '3 overdue. At this point they’re not tasks, they’re roommates.'
  },
  es: {
    classic: 'Tu día: 2 atrasados, 1 vence hoy · desde ayer: 3 reuniones',
    sergeant: '3 atrasados. Las excusas no entregan nada. Tú sí. Muévete.',
    sarcastic: '3 atrasados. A estas alturas no son tareas, son familia.'
  }
};

/**
 * The voice people get until they pick one: DIGEST_DEFAULT_VOICE, else Sarcastic
 * (the beta tries a personality first; Settings switches back to Classic)
 * @returns {'classic'|'sergeant'|'sarcastic'}
 */
function defaultVoice() {
  const value = process.env.DIGEST_DEFAULT_VOICE;
  return VOICES.includes(/** @type {any} */ (value)) ? /** @type {any} */ (value) : 'sarcastic';
}

/**
 * The voice a person's summary uses
 * @param {{ digest_voice?: string|null }} member
 * @param {{ digest_voices_enabled?: boolean }|null} [workspace] - false turns personalities off for everyone
 * @returns {'classic'|'sergeant'|'sarcastic'}
 */
function resolveVoice(member, workspace) {
  if (workspace && workspace.digest_voices_enabled === false) return 'classic';
  const chosen = member && member.digest_voice;
  return VOICES.includes(/** @type {any} */ (chosen)) ? /** @type {any} */ (chosen) : defaultVoice();
}

/**
 * Which situation the day is in (spec, point 5)
 * @param {{ overdue?: number, dueToday?: number, meetings?: number, newActionItems?: number, meetingPrep?: any[] }} summary
 * @returns {string}
 */
function pickSituation(summary) {
  const overdue = summary.overdue || 0;
  if (overdue >= 6) return 'overloaded';
  if (overdue >= 3) return 'overdue_pile';
  if (overdue >= 1) return 'overdue_few';
  if (summary.dueToday) return 'due_today';
  // Meetings with something to prepare (core/briefs/meeting-prep): a calendar alone doesn't count
  const prep = Array.isArray(summary.meetingPrep) ? summary.meetingPrep.filter(m => (m.items || []).length || (m.questions || []).length || (m.closed || []).length).length : 0;
  if (prep && !summary.meetings && !summary.newActionItems) return 'prep_only';
  return 'all_clear';
}

/**
 * The language of the partner's line: the person's Meet "Write outcomes in" setting when it's
 * English or Spanish, else guessed from the items in the email, else the last summary's
 * @param {Object} params
 * @param {string|null} [params.setting] - 'auto' | 'es' | 'en' | 'pt'
 * @param {string[]} [params.texts] - item texts in the email
 * @param {string|null} [params.previous] - language of the person's previous summary
 * @returns {'en'|'es'}
 */
function pickLanguage({ setting = null, texts = [], previous = null }) {
  if (setting === 'en' || setting === 'es') return setting;
  const detected = detectLanguage(texts.join('. '), { short: true });
  if (detected === 'en' || detected === 'es') return detected;
  return previous === 'es' ? 'es' : 'en';
}

/** @param {string} text */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** @param {string} text @param {Record<string, string>} vars */
function fill(text, vars) {
  return text.replace(/\{(count|weekday|item)\}/g, (match, key) => (vars[key] == null ? match : vars[key]));
}

/**
 * Picks the partner's line for today
 * @param {Object} params
 * @param {'sergeant'|'sarcastic'} params.voice
 * @param {string} params.situation
 * @param {'en'|'es'} params.language
 * @param {string[]} [params.recentLineIds] - lines sent to this person in the last REPEAT_DAYS days
 * @param {{ count?: number, weekday?: string, item?: string|null }} [params.vars] - item: null when none may be named
 * @param {() => number} [params.random]
 * @returns {{ id: string, subject: string, opener: string, followUp: string }} plain text (escape before HTML)
 */
function pickLine({ voice, situation, language, recentLineIds = [], vars = {}, random = Math.random }) {
  const lines = LIBRARY[voice][language][situation];
  const ids = lines.map((line, index) => `${voice}.${language}.${situation}.${index}`);
  const fresh = ids.filter(id => !recentLineIds.includes(id));
  const pool = fresh.length ? fresh : ids;
  const id = pool[Math.floor(random() * pool.length) % pool.length];
  const [opening, follow] = lines[ids.indexOf(id)];

  const item = typeof vars.item === 'string' && vars.item.trim() ? vars.item.trim() : null;
  const values = {
    count: String(vars.count == null ? '' : vars.count),
    weekday: vars.weekday || '',
    // Quoted, so the item reads as a name inside the sentence: Start with “Send the deck”.
    item: item ? `“${item.length > ITEM_MAX ? `${item.slice(0, ITEM_MAX - 1).trimEnd()}…` : item}”` : null
  };
  const subject = capitalize(fill(opening, values));
  const followUp = follow.includes('{item}') && !values.item ? GENERIC_FOLLOW[language] : capitalize(fill(follow, values));
  return { id, subject, opener: subject, followUp };
}

module.exports = {
  VOICES, PARTNER_VOICES, LANGUAGES, SITUATIONS, REPEAT_DAYS, LIBRARY, SAMPLES,
  defaultVoice, resolveVoice, pickSituation, pickLanguage, pickLine
};
