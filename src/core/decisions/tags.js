/**
 * Tags as a clean list. Older captures (the Chrome extension, `POST /api/memory`) saved them as
 * one comma-separated string ("iso, security"), and code that expects an array broke on it.
 * @param {unknown} value - array, comma-separated string, or nothing
 * @returns {string[]} trimmed, lowercased, no empty or repeated tags
 */
function normalizeTags(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const tags = list
    .filter(tag => typeof tag === 'string')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)];
}

module.exports = { normalizeTags };
