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
 *   node scripts/eval-extraction.js --dir ~/corteza-eval     # real meetings kept outside the repo
 *   node scripts/eval-extraction.js --dir ~/corteza-eval --with-synthetic   # both
 *   ... --include-drafts                                     # also fixtures whose labels aren't reviewed yet
 *
 * Fixture format (test/fixtures/extraction/*.json):
 *   { "name", "title", "date": "YYYY-MM-DD", "participants": [..], "transcript": "...",
 *     "expected": [{ "type": "decision|action_item|open_question|risk", "match": ["keyword", "alt|other", ..],
 *                    "owner"?: "Ana", "due_date"?: "YYYY-MM-DD" | null,
 *                    "rationale_match"?: ["keyword", ..] }],
 *     "context"?: { "company": { "description", "glossary" }, "personal": { "role", "focus", "glossary" } },
 *     "not_expected"?: [{ "match": ["keyword", ..], "why"? }],   // must NOT be captured (noise)
 *     "labeled"?: false }                                        // draft labels, skipped unless --include-drafts
 *   Every "match" keyword must appear in the item's text; "a|b" accepts either (synonyms, translations).
 * Real meetings: export them with scripts/eval/export-meetings.js and draft labels with
 * scripts/eval/draft-labels.js (see docs/research/extraction-quality.md).
 * Only add real transcripts with the participants' consent, and never commit them to a public repo.
 */
require('dotenv').config({ quiet: true });
process.env.POSTHOG_DISABLED = '1'; // eval runs are not product usage
const fs = require('fs');
const path = require('path');
const { extractDecisionsFromTranscript, isClaudeConfigured } = require('../src/services/claude');
const { buildExtractionText } = require('../src/ingestion/pipeline');
const config = require('../src/config/environment');
const { scoreFixture, summarize } = require('./eval/score');
const { formatContextBlock } = require('../src/core/context/context-service');

const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'extraction');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

/** Fixture folders: --dir (real meetings, outside the repo) and/or the synthetic ones in the repo */
function fixtureDirs() {
  const dir = argValue('--dir');
  if (!dir) return [FIXTURES_DIR];
  const external = path.resolve(dir.replace(/^~(?=$|\/)/, require('os').homedir()));
  return process.argv.includes('--with-synthetic') ? [external, FIXTURES_DIR] : [external];
}

const percent = value => (value === null ? '  -  ' : `${Math.round(value * 100)}%`.padStart(5));

async function main() {
  if (!isClaudeConfigured()) {
    console.error('❌ Set ANTHROPIC_API_KEY to run the eval.');
    process.exit(1);
  }
  const dirs = fixtureDirs();
  const includeDrafts = process.argv.includes('--include-drafts');
  const fixtures = dirs.flatMap(dir => fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort()
    .map(file => ({ file: path.join(dir, file), ...JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) })));
  const drafts = fixtures.filter(fixture => fixture.labeled === false);
  const selected = includeDrafts ? fixtures : fixtures.filter(fixture => fixture.labeled !== false);
  if (drafts.length && !includeDrafts) console.log(`⏭️  Skipping ${drafts.length} fixture(s) with draft labels (review them, set "labeled": true, or pass --include-drafts)`);
  console.log(`🧪 Extraction eval: ${selected.length} fixture(s), model ${config.claude.model}\n`);

  const results = [];
  for (const fixture of selected) {
    const text = buildExtractionText({
      title: fixture.title, occurredAt: `${fixture.date}T12:00:00Z`, participants: fixture.participants, text: fixture.transcript
    });
    // Optional "context": { company: { description, glossary }, personal: { role, focus, glossary } }
    const context = fixture.context ? formatContextBlock({ company: fixture.context.company || {}, personal: fixture.context.personal || {} }) : '';
    const { decisions } = await extractDecisionsFromTranscript(text, null, { context });
    const result = scoreFixture(decisions, fixture.expected, fixture.not_expected || []);
    results.push(result);

    console.log(`📄 ${fixture.name}: ${result.matched.length}/${fixture.expected.length} expected found, ${result.extra.length} extra (${result.noise.length} known noise)`);
    for (const exp of result.missed) {
      const retyped = result.retyped.find(r => r.expected === exp);
      console.log(`   ✗ missed ${exp.type}: ${exp.match.join(' + ')}${retyped ? `  (captured as ${retyped.item.decision_type})` : ''}`);
    }
    for (const item of result.extra) console.log(`   ${result.noise.includes(item) ? '🗑️  noise' : '+ extra'} ${item.decision_type}: ${item.decision_text}`);
  }

  const summary = summarize(results);
  console.log('\nType            precision  recall  (matched / extracted / expected)');
  for (const [type, stats] of Object.entries(summary.byType)) {
    console.log(`${type.padEnd(16)}${percent(stats.precision)}     ${percent(stats.recall)}   (${stats.matched} / ${stats.extracted} / ${stats.expected})`);
  }
  console.log(`\nOwner accuracy: ${percent(summary.ownerAccuracy)}   Due date accuracy: ${percent(summary.dueDateAccuracy)}   Rationale (context) accuracy: ${percent(summary.rationaleAccuracy)}`);
  console.log(`Decisions phrased as outcomes (not "se propuso…"): ${percent(summary.decisionsAsOutcomes)}`);
  const perMeeting = value => (value === null ? '-' : value.toFixed(1));
  console.log(`Per meeting: ${perMeeting(summary.noisePerMeeting)} known-noise item(s), ${perMeeting(summary.extrasPerMeeting)} unexpected item(s) in total`);

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
