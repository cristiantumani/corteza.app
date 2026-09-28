/**
 * Which language a meeting was held in, so its outcomes are saved in that language.
 *
 * A cheap guess from common short words (no API call). Meetings are long, so a
 * few hundred words are plenty. Gemini notes can come in the account's language
 * (English) even when people spoke Spanish, so callers pass the spoken transcript
 * when they have it.
 */

const LANGUAGES = {
  es: { name: 'Spanish', words: ['que', 'de', 'la', 'el', 'en', 'y', 'los', 'las', 'del', 'al', 'por', 'para', 'con', 'una', 'un', 'su', 'sus', 'es', 'se', 'lo', 'pero', 'como', 'más', 'esto', 'eso', 'entonces', 'también', 'porque', 'hay', 'vamos', 'bueno', 'sí', 'está', 'tenemos'] },
  en: { name: 'English', words: ['the', 'and', 'to', 'of', 'a', 'in', 'is', 'that', 'it', 'for', 'we', 'you', 'this', 'on', 'with', 'be', 'are', 'so', 'have', 'but', 'not', 'what', 'can', 'will', 'just', 'our', 'they', 'going', 'yeah', 'think'] },
  pt: { name: 'Portuguese', words: ['que', 'de', 'o', 'a', 'e', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não', 'os', 'as', 'no', 'na', 'mas', 'isso', 'então', 'também', 'porque', 'você', 'vamos', 'está', 'temos', 'gente', 'muito', 'ele', 'ela'] }
};

const LANGUAGE_CODES = Object.keys(LANGUAGES);

/**
 * Guesses the language of a text
 * @param {string} text
 * @param {Object} [options]
 * @param {boolean} [options.short] - for a sentence or two (a saved outcome) instead of a meeting
 * @returns {'es'|'en'|'pt'|null} null when there's too little text to tell
 */
function detectLanguage(text, { short = false } = {}) {
  const words = String(text || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).slice(0, 3000);
  if (words.length < (short ? 4 : 20)) return null;
  const counts = {};
  for (const code of LANGUAGE_CODES) {
    const set = new Set(LANGUAGES[code].words);
    counts[code] = words.reduce((sum, word) => sum + (set.has(word) ? 1 : 0), 0);
  }
  const [best, second] = LANGUAGE_CODES.slice().sort((a, b) => counts[b] - counts[a]);
  if (counts[best] < (short ? 2 : 5) || counts[best] < counts[second] * 1.2) return null; // not clear enough
  return best;
}

/**
 * The spoken part of an extraction text: the "Transcript:" section if there is one
 * (Gemini notes may be in another language), else the whole text
 * @param {string} text
 * @returns {string}
 */
function spokenText(text) {
  const value = String(text || '');
  const start = value.indexOf('Transcript:\n');
  if (start === -1) return value;
  const end = value.indexOf('\n\nMeeting notes (Gemini):', start);
  return value.slice(start, end === -1 ? undefined : end);
}

/**
 * English name of a language code ("es" → "Spanish"), or null
 * @param {string} code
 * @returns {string|null}
 */
function languageName(code) {
  return LANGUAGES[code] ? LANGUAGES[code].name : null;
}

module.exports = { LANGUAGE_CODES, detectLanguage, spokenText, languageName };
