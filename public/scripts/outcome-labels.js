/**
 * "Outcomes" wording shared by Home and Settings.
 *
 * An outcome is anything Corteza captures from a meeting: a decision, an open
 * question, a risk, an action item or a note (context, explanation, learning).
 * Mirrors OUTCOME_LABELS / describeOutcomes in src/core/decisions/types.js.
 */
(function() {
  'use strict';

  const LABELS = {
    decision: ['decision', 'decisions'],
    open_question: ['open question', 'open questions'],
    risk: ['risk', 'risks'],
    action_item: ['action item', 'action items'],
    other: ['note', 'notes']
  };

  function plural(count, [one, many]) {
    return `${count} ${count === 1 ? one : many}`;
  }

  /**
   * "13 decisions, 2 open questions and 4 action items"
   * @param {Object|null} byType - outcomes_by_type from the API (null for records saved before it existed)
   * @param {number} total - all outcomes except action items, used when byType is missing
   * @param {number} actionItems
   */
  function describe(byType, total = 0, actionItems = 0) {
    const counts = byType ? { ...byType } : (total ? { outcome: total } : {});
    if (actionItems) counts.action_item = actionItems;
    const labels = byType ? LABELS : { outcome: ['outcome', 'outcomes'], ...LABELS };
    const parts = Object.keys(labels).filter(type => counts[type] > 0).map(type => plural(counts[type], labels[type]));
    if (parts.length === 0) return '0 outcomes';
    if (parts.length === 1) return parts[0];
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  window.CortezaOutcomes = { LABELS, plural, describe };
})();
