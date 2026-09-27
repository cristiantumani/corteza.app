/**
 * Decision types (the `type` field of a decision).
 *
 * AI capture (extraction v2) produces: decision, action_item, open_question, risk.
 * explanation, context, learning and assumption come from manual logging and older captures.
 */
const DECISION_TYPES = ['decision', 'action_item', 'open_question', 'risk', 'explanation', 'context', 'learning', 'assumption'];

/** Types the AI extraction returns */
const EXTRACTED_TYPES = ['decision', 'action_item', 'open_question', 'risk'];

module.exports = { DECISION_TYPES, EXTRACTED_TYPES };
