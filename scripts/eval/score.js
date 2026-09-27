/**
 * Scoring for the extraction eval (scripts/eval-extraction.js).
 *
 * An extracted item matches an expected one when the type is the same and every
 * `match` keyword appears in its text (case- and accent-insensitive). Each
 * expected item can be matched once. Precision and recall are reported per type.
 */

function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matches(item, expected) {
  if (item.decision_type !== expected.type) return false;
  const text = normalize(item.decision_text);
  return (expected.match || []).every(keyword => text.includes(normalize(keyword)));
}

/**
 * @param {Object[]} extracted - items from extractDecisionsFromTranscript
 * @param {Object[]} expected - [{ type, match: [keywords], owner?, due_date? }]
 * @returns {{ matched: Object[], missed: Object[], extra: Object[] }}
 */
function scoreFixture(extracted, expected) {
  const remaining = [...extracted];
  const matched = [];
  const missed = [];
  for (const exp of expected) {
    const index = remaining.findIndex(item => matches(item, exp));
    if (index === -1) {
      missed.push(exp);
    } else {
      matched.push({ expected: exp, item: remaining.splice(index, 1)[0] });
    }
  }
  return { matched, missed, extra: remaining };
}

/**
 * Totals over several fixtures
 * @param {Array<{ matched, missed, extra }>} results
 * @returns {Object} per type: { expected, extracted, matched, precision, recall }, plus owner/due accuracy
 */
function summarize(results) {
  const byType = {};
  const bump = (type, key) => {
    byType[type] = byType[type] || { expected: 0, extracted: 0, matched: 0 };
    byType[type][key]++;
  };
  let ownerChecks = 0;
  let ownerCorrect = 0;
  let dueChecks = 0;
  let dueCorrect = 0;

  for (const { matched, missed, extra } of results) {
    for (const { expected, item } of matched) {
      bump(expected.type, 'expected');
      bump(expected.type, 'extracted');
      bump(expected.type, 'matched');
      if (expected.owner !== undefined) {
        ownerChecks++;
        if (normalize(item.owner_name) === normalize(expected.owner)) ownerCorrect++;
      }
      if (expected.due_date !== undefined) {
        dueChecks++;
        if ((item.due_date || null) === expected.due_date) dueCorrect++;
      }
    }
    for (const exp of missed) bump(exp.type, 'expected');
    for (const item of extra) bump(item.decision_type, 'extracted');
  }

  for (const stats of Object.values(byType)) {
    stats.precision = stats.extracted ? stats.matched / stats.extracted : null;
    stats.recall = stats.expected ? stats.matched / stats.expected : null;
  }
  return {
    byType,
    ownerAccuracy: ownerChecks ? ownerCorrect / ownerChecks : null,
    dueDateAccuracy: dueChecks ? dueCorrect / dueChecks : null
  };
}

module.exports = { scoreFixture, summarize, normalize };
