/**
 * Drafts labels for exported meetings (scripts/eval/export-meetings.js) so a person
 * only has to review them instead of labeling from scratch.
 *
 * For each fixture with "labeled": false and no draft yet, Claude reads the meeting and
 * proposes:
 *   - expected: the business outcomes a careful analyst would record
 *   - not_expected: things said that a naive system would capture but shouldn't
 *     (meeting logistics, equipment problems, small talk, proposals nobody agreed to)
 * with keywords the eval matches on. Labels stay drafts ("labeled": false) until you
 * review the file and set "labeled": true.
 *
 * Calls the Claude API (costs money: roughly $0.10–0.15 per one-hour meeting with Opus).
 *
 * Usage:
 *   node scripts/eval/draft-labels.js --dir ~/corteza-eval
 *   node scripts/eval/draft-labels.js --dir ~/corteza-eval --force        # redo existing drafts
 *   LABEL_MODEL=claude-sonnet-5-5 node scripts/eval/draft-labels.js --dir ~/corteza-eval
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const os = require('os');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { buildExtractionText } = require('../../src/ingestion/pipeline');

const MODEL = process.env.LABEL_MODEL || 'claude-opus-5-5';
const TYPES = ['decision', 'action_item', 'open_question', 'risk'];

const LABELING_GUIDE = `You are building the answer key for evaluating a meeting "decision log". The product saves meeting outcomes automatically, with no human review, so the team wants only business outcomes and treats noise as worse than missing a minor item.

Definitions (an item must satisfy its structure):
- decision: a business topic, a proposal, and explicit agreement by the participants. Proposals nobody agreed to are not decisions.
- action_item: a work task, an owner who took it on, and agreement; plus a deadline if one was said.
- open_question: raised, matters for the business, and explicitly left unresolved.
- risk: a threat to a business result (revenue, customers, a launch or deliverable deadline, compliance, the team), not to the meeting itself.

Business relevance test: it touches strategy, customers, sales, product, pricing, finance or budget, metrics, people (hiring, compensation, roles), operations, legal, partners or a deliverable, AND someone who missed the meeting would want to find it a month from now.

Never business outcomes: scheduling or rescheduling this or another meeting, audio/connection/computer/tool problems, moving files to a new laptop, small talk, comments about the meeting's own flow, and status updates with no commitment.

Return:
- expected: every outcome a careful analyst would record. Write text in the meeting's language, as it would read in a decision log. "match" is 1 to 3 short lowercase keywords (use word stems, e.g. "reajust", "gasto") that any reasonable wording of this item would contain and that don't appear in other items. owner as named in the meeting or null; due_date YYYY-MM-DD resolved from the meeting date, or null.
- not_expected: things said in this meeting that a naive extractor would likely capture as an outcome but must not be (the list above, plus trivial or unagreed items). Same "match" rules; "why" says which rule excludes it.
Use empty lists when there is nothing. Do not invent content that isn't in the meeting.`;

const SCHEMA = {
  type: 'object',
  properties: {
    meeting_type: { type: 'string', enum: ['one_on_one', 'standup', 'planning', 'sales_or_customer', 'board_or_leadership', 'review', 'other'] },
    expected: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: TYPES },
          text: { type: 'string' },
          match: { type: 'array', items: { type: 'string' } },
          owner: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          due_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          why: { type: 'string' }
        },
        required: ['type', 'text', 'match', 'owner', 'due_date', 'why'],
        additionalProperties: false
      }
    },
    not_expected: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          match: { type: 'array', items: { type: 'string' } },
          why: { type: 'string' }
        },
        required: ['text', 'match', 'why'],
        additionalProperties: false
      }
    }
  },
  required: ['meeting_type', 'expected', 'not_expected'],
  additionalProperties: false
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

/**
 * Turns Claude's labels into fixture fields (owner/due_date only when known, as the scorer expects)
 * @param {Object} labels - { meeting_type, expected, not_expected }
 * @returns {{ meeting_type: string, expected: Object[], not_expected: Object[] }}
 */
function toFixtureLabels(labels) {
  return {
    meeting_type: labels.meeting_type,
    expected: (labels.expected || []).map(item => ({
      type: item.type,
      text: item.text,
      match: item.match,
      ...(item.owner ? { owner: item.owner } : {}),
      ...(item.type === 'action_item' ? { due_date: item.due_date || null } : {}),
      why: item.why
    })),
    not_expected: (labels.not_expected || []).map(item => ({ text: item.text, match: item.match, why: item.why }))
  };
}

async function draftLabels(client, fixture) {
  const text = buildExtractionText({
    title: fixture.title, occurredAt: fixture.date ? `${fixture.date}T12:00:00Z` : null, participants: fixture.participants, text: fixture.transcript
  });
  const response = await client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: LABELING_GUIDE,
    messages: [{ role: 'user', content: `<meeting>\n${text}\n</meeting>\n\nLabel this meeting following the guide.` }],
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } }
  }).finalMessage();

  if (response.stop_reason === 'refusal') throw new Error('Claude declined this meeting');
  if (response.stop_reason === 'max_tokens') throw new Error('Response was cut off (max_tokens)');
  const json = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
  return toFixtureLabels(JSON.parse(json));
}

async function main() {
  const dirArg = argValue('--dir');
  if (!dirArg) throw new Error('Pass --dir with the folder of exported meetings.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY.');
  const dir = path.resolve(dirArg.replace(/^~(?=$|\/)/, os.homedir()));
  const force = process.argv.includes('--force');
  const client = new Anthropic({ timeout: 10 * 60 * 1000, maxRetries: 2 });

  const files = fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort();
  console.log(`🏷️  Drafting labels with ${MODEL} for ${files.length} file(s) in ${dir}\n`);
  for (const file of files) {
    const full = path.join(dir, file);
    const fixture = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (fixture.labeled !== false) { console.log(`   ⏭️  ${file}: already reviewed`); continue; }
    if (fixture.draft_labeled_at && !force) { console.log(`   ⏭️  ${file}: has a draft (use --force to redo)`); continue; }
    try {
      const labels = await draftLabels(client, fixture);
      Object.assign(fixture, labels, { draft_labeled_at: new Date().toISOString(), draft_model: MODEL });
      fs.writeFileSync(full, JSON.stringify(fixture, null, 2));
      console.log(`   ✅ ${file}: ${labels.expected.length} expected, ${labels.not_expected.length} not expected (${labels.meeting_type})`);
    } catch (error) {
      console.error(`   ❌ ${file}: ${error.message}`);
    }
  }
  console.log('\nNext: review each file, fix the labels, set "labeled": true, then run node scripts/eval-extraction.js --dir ' + dirArg);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Drafting failed:', error.message);
    process.exit(1);
  });
}

module.exports = { toFixtureLabels, SCHEMA, LABELING_GUIDE };
