/**
 * Scoring for the extraction eval (scripts/eval-extraction.js).
 *
 * An extracted item matches an expected one when the type is the same and every
 * `match` keyword appears in its text (case- and accent-insensitive). A keyword can
 * list alternatives with "|": "one pager|una pagina" matches either. Each expected
 * item can be matched once. Precision and recall are reported per type.
 *
 * A missed item whose keywords do appear in an extra item of another type is reported
 * as `retyped` (e.g. expected a decision, captured as an action item). It still counts
 * as missed and extra; the list only helps tell a wrong type from a real miss.
 *
 * Fixtures can also list `not_expected`: things said in the meeting that must NOT be
 * captured (logistics, equipment problems, small talk). An extracted item of any type
 * whose text has all of an entry's `match` keywords counts as noise.
 *
 * Writing (docs/specs/2026-10-concise-outcomes.md), from writingStats: words per headline and the
 * share over HEADLINE_MAX_WORDS, headlines that copy a run of COPY_RUN_WORDS words from the transcript
 * (quotes don't count: they're meant to be verbatim), rationales that mostly repeat the headline, and
 * characters per card (headline + rationale).
 *
 * Also checked:
 * - rationale_match: keywords the item's rationale should contain (context behind it)
 * - decisions phrased as outcomes ("Se decide…", "Launch moves to…"), not narration
 *   of the conversation ("Se propuso…", "Ana proposed…")
 */

/** Decision texts that narrate the conversation instead of stating the outcome */
const NARRATION = /\b(se propuso|se propone|se hablo|se discutio|se planteo|propuso|planteo|it was proposed|proposed|suggested|discussed|talked about)\b/;

function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Whether normalized text contains a keyword, or one of its "|" alternatives */
function hasKeyword(text, keyword) {
  return String(keyword).split('|').some(option => option.trim() && text.includes(normalize(option.trim())));
}

function mentions(item, entry) {
  const text = normalize(item.decision_text);
  return (entry.match || []).length > 0 && entry.match.every(keyword => hasKeyword(text, keyword));
}

function matches(item, expected) {
  return item.decision_type === expected.type && mentions(item, expected);
}

/**
 * @param {Object[]} extracted - items from extractDecisionsFromTranscript
 * @param {Object[]} expected - [{ type, match: [keywords], owner?, due_date? }]
 * @param {Object[]} [notExpected] - [{ match: [keywords], why? }] things that must not be captured
 * @returns {{ matched: Object[], missed: Object[], extra: Object[], noise: Object[], retyped: Object[] }}
 *   noise ⊆ extra; retyped: [{ expected, item }] missed items found with another type
 */
function scoreFixture(extracted, expected, notExpected = []) {
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
  const noise = remaining.filter(item => notExpected.some(entry => mentions(item, entry)));
  const retyped = [];
  for (const exp of missed) {
    const item = remaining.find(candidate => mentions(candidate, exp) && !retyped.some(r => r.item === candidate));
    if (item) retyped.push({ expected: exp, item });
  }
  return { matched, missed, extra: remaining, noise, retyped };
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
  let rationaleChecks = 0;
  let rationaleCorrect = 0;
  let decisionsTotal = 0;
  let decisionsNarrated = 0;
  const countPhrasing = item => {
    if (item.decision_type !== 'decision') return;
    decisionsTotal++;
    if (NARRATION.test(normalize(item.decision_text))) decisionsNarrated++;
  };

  let noiseItems = 0;
  let extraItems = 0;
  for (const { matched, missed, extra, noise = [] } of results) {
    noiseItems += noise.length;
    extraItems += extra.length;
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
      if (expected.rationale_match) {
        rationaleChecks++;
        const rationale = normalize(item.rationale);
        if (expected.rationale_match.every(keyword => hasKeyword(rationale, keyword))) rationaleCorrect++;
      }
      countPhrasing(item);
    }
    for (const exp of missed) bump(exp.type, 'expected');
    for (const item of extra) {
      bump(item.decision_type, 'extracted');
      countPhrasing(item);
    }
  }

  for (const stats of Object.values(byType)) {
    stats.precision = stats.extracted ? stats.matched / stats.extracted : null;
    stats.recall = stats.expected ? stats.matched / stats.expected : null;
  }
  return {
    byType,
    ownerAccuracy: ownerChecks ? ownerCorrect / ownerChecks : null,
    dueDateAccuracy: dueChecks ? dueCorrect / dueChecks : null,
    rationaleAccuracy: rationaleChecks ? rationaleCorrect / rationaleChecks : null,
    decisionsAsOutcomes: decisionsTotal ? (decisionsTotal - decisionsNarrated) / decisionsTotal : null,
    // Items that should not have been captured, per meeting: known noise (not_expected) and all extras
    noisePerMeeting: results.length ? noiseItems / results.length : null,
    extrasPerMeeting: results.length ? extraItems / results.length : null
  };
}

const HEADLINE_MAX_WORDS = 15;
const COPY_RUN_WORDS = 6;
const RATIONALE_REPEAT_SHARE = 0.7;

/** @param {unknown} text @returns {string[]} */
function words(text) {
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Whether a text repeats COPY_RUN_WORDS consecutive words of the transcript
 * @param {string[]} textWords
 * @param {Set<string>} transcriptRuns - every run of COPY_RUN_WORDS words in the transcript, joined by spaces
 * @returns {boolean}
 */
function copiesTranscript(textWords, transcriptRuns) {
  for (let i = 0; i + COPY_RUN_WORDS <= textWords.length; i++) {
    if (transcriptRuns.has(textWords.slice(i, i + COPY_RUN_WORDS).join(' '))) return true;
  }
  return false;
}

/**
 * How the items of one or more meetings are written: length, copying, repetition
 * @param {Array<{ items: Object[], transcript: string }>} meetings - extracted items with their transcript
 * @returns {{ headlines: number, avgWords: number|null, overMaxWords: number|null, copied: number|null,
 *   rationaleRepeats: number|null, avgCardChars: number|null }} shares are 0..1
 */
function writingStats(meetings) {
  let headlines = 0;
  let wordTotal = 0;
  let over = 0;
  let copied = 0;
  let rationales = 0;
  let repeats = 0;
  let chars = 0;
  for (const { items, transcript } of meetings) {
    const all = words(transcript);
    const runs = new Set();
    for (let i = 0; i + COPY_RUN_WORDS <= all.length; i++) runs.add(all.slice(i, i + COPY_RUN_WORDS).join(' '));
    for (const item of items) {
      const headline = words(item.decision_text);
      if (!headline.length) continue;
      headlines++;
      wordTotal += headline.length;
      if (headline.length > HEADLINE_MAX_WORDS) over++;
      if (copiesTranscript(headline, runs)) copied++;
      chars += String(item.decision_text || '').length + String(item.rationale || '').length;
      const why = words(item.rationale);
      if (why.length) {
        rationales++;
        const inHeadline = new Set(headline);
        if (why.filter(word => inHeadline.has(word)).length / why.length >= RATIONALE_REPEAT_SHARE) repeats++;
      }
    }
  }
  return {
    headlines,
    avgWords: headlines ? wordTotal / headlines : null,
    overMaxWords: headlines ? over / headlines : null,
    copied: headlines ? copied / headlines : null,
    rationaleRepeats: rationales ? repeats / rationales : null,
    avgCardChars: headlines ? chars / headlines : null
  };
}

module.exports = { scoreFixture, summarize, writingStats, normalize, NARRATION, HEADLINE_MAX_WORDS, COPY_RUN_WORDS };
