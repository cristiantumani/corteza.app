/**
 * Extraction eval: runs the real extraction on labeled transcripts and reports
 * precision/recall per item type, plus owner and due-date accuracy.
 *
 * Calls the Claude API (costs money: roughly one extraction per fixture).
 * Run it before and after every prompt or model change and compare.
 *
 * Usage:
 *   node scripts/eval-extraction.js                         # all fixtures in test/fixtures/extraction
 *   node scripts/eval-extraction.js --min-precision 0.85    # exit 1 if decision precision is lower
 *   CLAUDE_MODEL=claude-sonnet-5 node scripts/eval-extraction.js   # compare models
 *
 * Fixture format (test/fixtures/extraction/*.json):
 *   { "name", "title", "date": "YYYY-MM-DD", "participants": [..], "transcript": "...",
 *     "expected": [{ "type": "decision|action_item|open_question|risk", "match": ["keyword", ..],
 *                    "owner"?: "Ana", "due_date"?: "YYYY-MM-DD" | null,
 *                    "rationale_match"?: ["keyword", ..] }] }
 * Only add real transcripts with the participants' consent, and never commit them to a public repo.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { extractDecisionsFromTranscript, isClaudeConfigured } = require('../src/services/claude');
const { buildExtractionText } = require('../src/ingestion/pipeline');
const config = require('../src/config/environment');
const { scoreFixture, summarize } = require('./eval/score');

const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'extraction');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const percent = value => (value === null ? '  -  ' : `${Math.round(value * 100)}%`.padStart(5));

async function main() {
  if (!isClaudeConfigured()) {
    console.error('❌ Set ANTHROPIC_API_KEY to run the eval.');
    process.exit(1);
  }
  const files = fs.readdirSync(FIXTURES_DIR).filter(file => file.endsWith('.json')).sort();
  console.log(`🧪 Extraction eval: ${files.length} fixture(s), model ${config.claude.model}\n`);

  const results = [];
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
    const text = buildExtractionText({
      title: fixture.title, occurredAt: `${fixture.date}T12:00:00Z`, participants: fixture.participants, text: fixture.transcript
    });
    const { decisions } = await extractDecisionsFromTranscript(text, null);
    const result = scoreFixture(decisions, fixture.expected);
    results.push(result);

    console.log(`📄 ${fixture.name}: ${result.matched.length}/${fixture.expected.length} expected found, ${result.extra.length} extra`);
    for (const exp of result.missed) console.log(`   ✗ missed ${exp.type}: ${exp.match.join(' + ')}`);
    for (const item of result.extra) console.log(`   + extra ${item.decision_type}: ${item.decision_text}`);
  }

  const summary = summarize(results);
  console.log('\nType            precision  recall  (matched / extracted / expected)');
  for (const [type, stats] of Object.entries(summary.byType)) {
    console.log(`${type.padEnd(16)}${percent(stats.precision)}     ${percent(stats.recall)}   (${stats.matched} / ${stats.extracted} / ${stats.expected})`);
  }
  console.log(`\nOwner accuracy: ${percent(summary.ownerAccuracy)}   Due date accuracy: ${percent(summary.dueDateAccuracy)}   Rationale (context) accuracy: ${percent(summary.rationaleAccuracy)}`);
  console.log(`Decisions phrased as outcomes (not "se propuso…"): ${percent(summary.decisionsAsOutcomes)}`);

  const minPrecision = argValue('--min-precision');
  const decisionPrecision = summary.byType.decision?.precision ?? null;
  if (minPrecision && (decisionPrecision === null || decisionPrecision < Number(minPrecision))) {
    console.error(`\n❌ Decision precision ${percent(decisionPrecision)} is below ${minPrecision}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Eval failed:', error.message);
  process.exit(1);
});
