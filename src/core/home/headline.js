const crypto = require('crypto');
const voice = require('../digest/voice');

/**
 * Home's headline: the person's morning partner (docs/specs/2026-10-morning-partner.md) says
 * where their day stands, in the same voice as the morning summary. The line is picked from the
 * same library and situations, stays the same all day (seeded by person and date, so a reload
 * doesn't change it), and skips lines that only make sense in an email ("Frame this email",
 * "the items below"). Classic gets no line: the page writes its plain counts.
 *
 * The voice is never shown to colleagues: Home is the person's own page.
 */

/** Lines that talk about the email itself or point at its layout */
const EMAIL_ONLY = /correo|e-?mail|abajo|below|este mensaje|this message|inbox|bandeja/i;

/** A stable 0..n-1 from a seed */
function seededIndex(seed, n) {
  const hash = crypto.createHash('sha256').update(seed).digest();
  return hash.readUInt32BE(0) % n;
}

/**
 * @param {Object} params
 * @param {string} params.voiceName - 'classic' | 'sergeant' | 'sarcastic' (resolved: workspace switch included)
 * @param {'en'|'es'} params.lang - the page's language
 * @param {Object[]} params.owned - the person's open action items ({ item_id, text, due_date, new_from_colleague })
 * @param {string} params.today - 'YYYY-MM-DD' in the person's time zone
 * @param {string} params.seed - person and day, e.g. `${userId}:${today}`
 * @returns {{ voice: string, situation: string, title: string|null, follow: string|null, item_id: string|null }}
 *   title/follow are plain text (escape before HTML); null for Classic
 */
function buildHeadline({ voiceName, lang, owned, today, seed }) {
  const overdue = owned.filter(item => item.due_date && item.due_date < today);
  const dueToday = owned.filter(item => item.due_date === today);
  const situation = voice.pickSituation({ overdue: overdue.length, dueToday: dueToday.length });
  if (!voice.PARTNER_VOICES.includes(voiceName)) return { voice: 'classic', situation, title: null, follow: null, item_id: null };

  const language = lang === 'es' ? 'es' : 'en';
  const voiceKey = /** @type {'sergeant'|'sarcastic'} */ (voiceName);
  const lines = voice.LIBRARY[voiceKey][language][situation];
  const safe = lines.map((line, index) => index).filter(index => !EMAIL_ONLY.test(lines[index].join(' ')));
  const pool = safe.length ? safe : lines.map((line, index) => index);
  const chosen = pool[seededIndex(seed, pool.length)];
  const ids = lines.map((line, index) => `${voiceName}.${language}.${situation}.${index}`);

  // The item a line may name: overdue first (or due today), never one a colleague's meeting just assigned
  const named = (situation === 'due_today' ? dueToday : overdue).find(item => !item.new_from_colleague) || null;
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString(language === 'es' ? 'es-CL' : 'en-US', { weekday: 'long', timeZone: 'UTC' });
  const line = voice.pickLine({
    voice: voiceKey,
    situation,
    language,
    recentLineIds: ids.filter((id, index) => index !== chosen), // leaves only the chosen line
    vars: { count: situation === 'due_today' ? dueToday.length : overdue.length, weekday, item: named ? named.text : null }
  });
  return { voice: voiceName, situation, title: line.subject, follow: line.followUp, item_id: named && line.followUp.includes('“') ? named.item_id : null };
}

module.exports = { buildHeadline, EMAIL_ONLY };
