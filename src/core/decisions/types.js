/**
 * Decision types (the `type` field of a decision).
 *
 * In the product these are all "outcomes" of a meeting; a "decision" is one type of outcome.
 * AI capture (extraction v2) produces: decision, action_item, open_question, risk.
 * explanation, context, learning and assumption come from manual logging and older captures.
 */
const DECISION_TYPES = ['decision', 'action_item', 'open_question', 'risk', 'explanation', 'context', 'learning', 'assumption'];

/** Types the AI extraction returns */
const EXTRACTED_TYPES = ['decision', 'action_item', 'open_question', 'risk'];

/** Singular/plural labels, in the order outcomes are listed */
const OUTCOME_LABELS = {
  decision: ['decision', 'decisions'],
  open_question: ['open question', 'open questions'],
  risk: ['risk', 'risks'],
  action_item: ['action item', 'action items'],
  other: ['note', 'notes']
};

/**
 * Group an outcome is counted and listed under: its type, or "other" for
 * explanation, context, learning and assumption
 * @param {string} type
 * @returns {string} a key of OUTCOME_LABELS
 */
function outcomeGroup(type) {
  return type !== 'other' && OUTCOME_LABELS[type] ? type : 'other';
}

/**
 * Counts items by outcome group
 * @param {Array<{type: string}>} items
 * @returns {Object<string, number>} e.g. { decision: 3, open_question: 1 }
 */
function countByType(items) {
  /** @type {Object<string, number>} */
  const counts = {};
  for (const item of items || []) {
    const key = outcomeGroup(item.type);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * "3 decisions, 1 open question and 2 action items"
 * @param {Object<string, number>} counts - from countByType, plus action_item if tracked separately
 * @param {string} [lang] - 'en' | 'es' (public/i18n, key outcomeCounts)
 * @returns {string} empty string when there is nothing
 */
function describeOutcomes(counts, lang = 'en') {
  // Lazy: core/i18n reads the dictionaries from disk
  const { translate } = require('../i18n/i18n');
  const parts = Object.keys(OUTCOME_LABELS)
    .filter(type => counts[type] > 0)
    .map(type => translate(lang, `outcomeCounts.${type}`, { count: counts[type] }));
  if (parts.length <= 1) return parts.join('');
  return translate(lang, 'outcomeCounts.list', { items: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] });
}

module.exports = { DECISION_TYPES, EXTRACTED_TYPES, OUTCOME_LABELS, outcomeGroup, countByType, describeOutcomes };
