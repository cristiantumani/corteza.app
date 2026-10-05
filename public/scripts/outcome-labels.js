/**
 * "Outcomes" wording shared by Home and Settings, in the person's language (public/i18n, key "outcomeCounts").
 *
 * An outcome is anything Corteza captures from a meeting: a decision, an open
 * question, a risk, an action item or a note (context, explanation, learning).
 * Mirrors OUTCOME_LABELS / describeOutcomes in src/core/decisions/types.js.
 */
(function() {
  'use strict';
  const t = window.t || ((key, vars) => `${(vars && vars.count) || 0} ${key.split('.').pop()}`); // public/scripts/i18n.js

  const TYPES = ['decision', 'open_question', 'risk', 'action_item', 'other'];

  /** "13 decisions" / "13 decisiones" */
  function plural(count, type) {
    return t(`outcomeCounts.${type}`, { count });
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
    const types = byType ? TYPES : ['outcome', ...TYPES];
    const parts = types.filter(type => counts[type] > 0).map(type => plural(counts[type], type));
    if (parts.length === 0) return plural(0, 'outcome');
    if (parts.length === 1) return parts[0];
    return t('outcomeCounts.list', { items: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] });
  }

  window.CortezaOutcomes = { TYPES, plural, describe };
})();
