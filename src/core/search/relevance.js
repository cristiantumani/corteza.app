/**
 * Search relevance helpers shared by semantic and keyword search
 * (services/semantic-search.js).
 *
 * Queries are often in Spanish ("¿Qué acordamos con Buk para el directorio en octubre?"),
 * so keywords are extracted with English and Spanish stop words, compared without
 * accents or case, and matched as the start of a word ("octubre" matches "Octubre",
 * "reunion" matches "reuniones") instead of anywhere inside a word ("con" no longer
 * matches "confirm").
 */

// Words that say nothing about the topic: articles, pronouns, question words and the
// verbs people use to ask about decisions ("what did we decide/agree about ...")
const STOP_WORDS = new Set([
  // English
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
  'about', 'of', 'for', 'with', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'show', 'me', 'find', 'search', 'look', 'get', 'all', 'any', 'and', 'or', 'but', 'from',
  'into', 'our', 'ours', 'we', 'you', 'they', 'this', 'that', 'these', 'those', 'there',
  'decisions', 'decision', 'decide', 'decided', 'agree', 'agreed', 'made', 'make', 'latest',
  'recent', 'tell', 'regarding', 'around', 'last', 'next', 'team',
  // Spanish
  'que', 'qué', 'quien', 'quién', 'quienes', 'cual', 'cuál', 'cuales', 'como', 'cómo', 'cuando',
  'cuándo', 'donde', 'dónde', 'por', 'para', 'con', 'sin', 'sobre', 'entre', 'hacia', 'desde',
  'hasta', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas', 'el', 'la', 'lo', 'le', 'les',
  'al', 'de', 'en', 'y', 'o', 'u', 'e', 'es', 'son', 'fue', 'fueron', 'ser', 'sido', 'era',
  'esta', 'este', 'esto', 'estos', 'estas', 'ese', 'esa', 'eso', 'esos', 'esas', 'hay',
  'hemos', 'han', 'ha', 'he', 'habia', 'había', 'tenemos', 'tiene', 'tienen', 'nos', 'nuestro',
  'nuestra', 'nuestros', 'nuestras', 'mas', 'más', 'muy', 'tambien', 'también', 'ya', 'cara',
  'respecto', 'acerca', 'decidido', 'decidimos', 'decidio', 'decidió', 'decisiones', 'decision',
  'decisión', 'acordado', 'acordamos', 'acordaron', 'acuerdo', 'acuerdos', 'hablamos', 'dijimos',
  'quedamos', 'ultimo', 'último', 'ultima', 'última', 'ultimos', 'últimos', 'muestrame',
  'muéstrame', 'dime', 'busca', 'equipo', 'todo', 'todos', 'toda', 'todas', 'tengo', 'tienes',
  'hacer', 'hago', 'hace', 'hacemos', 'debo', 'debe', 'debemos', 'deberia', 'debería', 'puedo',
  'podemos', 'necesito', 'necesitamos', 'quiero', 'saber', 'sabemos', 'respecto', 'relacion', 'relación',
  'need', 'needs', 'want', 'know', 'regarding'
].map(normalize));

/**
 * Lowercase, without accents: "Reunión" → "reunion"
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Topic words of a query, normalized and without stop words
 * @param {string} query
 * @returns {string[]} e.g. "Que hemos acordado de cara al directorio con Buk en Octubre?" → ['directorio', 'buk', 'octubre']
 */
function extractKeywords(query) {
  const words = normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
  return [...new Set(words)];
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Everything a source says that a keyword can match: text, tags, why, meeting title, epic */
function searchableText(doc) {
  return normalize([
    doc.text,
    (doc.tags || []).join(' '),
    doc.rationale,
    doc.owner_name,
    doc.epic_key,
    doc.source_details && doc.source_details.title
  ].filter(Boolean).join(' '));
}

/**
 * Which keywords appear in a source, each as the start of a word
 * @param {Object} doc - decision
 * @param {string[]} keywords - from extractKeywords
 * @returns {string[]} the keywords found
 */
function matchedKeywords(doc, keywords) {
  const haystack = searchableText(doc);
  return keywords.filter(keyword => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(keyword)}`, 'u').test(haystack));
}

/**
 * How many keywords a source must contain to count as a keyword match:
 * all of 1–2 keywords can be too strict for 2 ("buk octubre"), so 1 of 2, 2 of 3, 2 of 4, 3 of 5…
 * @param {number} keywordCount
 * @returns {number}
 */
function requiredMatches(keywordCount) {
  return keywordCount <= 2 ? 1 : Math.ceil(keywordCount / 2);
}

const ACCENTS = { a: '[aáàä]', e: '[eéèë]', i: '[iíìï]', o: '[oóòö]', u: '[uúùü]', n: '[nñ]' };

/**
 * MongoDB regex source that matches a keyword at the start of a word, with or without
 * accents ("reunion" → matches "Reunión"); used with the 'i' option
 * @param {string} keyword - normalized keyword
 * @returns {string}
 */
function accentInsensitivePattern(keyword) {
  const body = [...escapeRegex(keyword)].map(char => ACCENTS[char] || char).join('');
  return `(^|[^a-z0-9áéíóúüñàèìòùäëïö])${body}`;
}

module.exports = {
  STOP_WORDS,
  normalize,
  extractKeywords,
  matchedKeywords,
  requiredMatches,
  accentInsensitivePattern
};
