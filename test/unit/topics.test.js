const { test } = require('node:test');
const assert = require('node:assert/strict');
const { topicKey, assignTopics, newTopicId } = require('../../src/core/topics/topics');
const { threadSummary } = require('../../src/core/topics/thread-service');

let counter = 0;
const newId = () => `top_${++counter}`;

test('topic labels match whatever the accents, case and punctuation', () => {
  assert.equal(topicKey('Certificación ISO-27001.'), topicKey('certificacion iso 27001'));
  assert.equal(topicKey('  '), '');
  assert.equal(topicKey(null), '');
  assert.match(newTopicId(), /^top_[0-9a-f]{16}$/);
});

test('items with the same topic share a thread; lone items get none', () => {
  const threads = assignTopics([
    { decision_type: 'open_question', topic: 'Certificación ISO 27001' },
    { decision_type: 'risk', topic: 'certificacion iso 27001' },
    { decision_type: 'action_item', topic: 'Certificación ISO 27001' },
    { decision_type: 'decision', topic: 'Pricing' },
    { decision_type: 'decision', topic: null }
  ], { newId });
  assert.ok(threads[0]);
  assert.equal(threads[0].topic, 'Certificación ISO 27001');
  assert.equal(threads[1], threads[0]);
  assert.equal(threads[2], threads[0]);
  assert.equal(threads[3], null);
  assert.equal(threads[4], null);
});

test('an action item that carries out a decision joins its thread, even without a topic', () => {
  const threads = assignTopics([
    { decision_type: 'decision', topic: 'Hiring' },
    { decision_type: 'action_item', topic: null, decision_ref: 0 },
    { decision_type: 'action_item', topic: 'Something else', decision_ref: 0 },
    { decision_type: 'action_item', topic: null, decision_ref: 9 }
  ], { newId });
  assert.equal(threads[0].topic, 'Hiring');
  assert.equal(threads[1], threads[0]);
  assert.equal(threads[2], threads[0], 'the decision link wins over a different label');
  assert.equal(threads[3], null, 'a reference out of range links nothing');
});

test('two subjects in one meeting make two threads', () => {
  const threads = assignTopics([
    { decision_type: 'open_question', topic: 'A' },
    { decision_type: 'risk', topic: 'B' },
    { decision_type: 'action_item', topic: 'A' },
    { decision_type: 'action_item', topic: 'B' }
  ], { newId });
  assert.notEqual(threads[0].topicId, threads[1].topicId);
  assert.equal(threads[2].topicId, threads[0].topicId);
  assert.equal(threads[3].topicId, threads[1].topicId);
});

test('an action item\'s thread summary counts questions and risks, and lists the open questions', () => {
  assert.equal(threadSummary(undefined), null);
  assert.equal(threadSummary({ topic_id: 't', topic: 'X', outcomes: [{ id: 1, type: 'decision', text: 'd' }], actions: [] }), null);
  assert.deepEqual(threadSummary({
    topic_id: 't', topic: 'ISO',
    outcomes: [
      { id: 1, type: 'open_question', text: 'Get ISO?', resolution_status: 'open' },
      { id: 2, type: 'open_question', text: 'Which auditor?', resolution_status: 'resolved' },
      { id: 3, type: 'risk', text: 'Lose deals', resolution_status: 'open' }
    ],
    actions: []
  }), { topic_id: 't', topic: 'ISO', questions: 2, risks: 1, open_questions: [{ id: 1, text: 'Get ISO?' }] });
});

test('the backfill groups a capture\'s close items around a question or risk, and leaves the rest alone', () => {
  const { groupCapture, labelFor } = require('../../scripts/migrations/010-topic-threads');
  const iso = [1, 0.1, 0];
  const isoish = [0.9, 0.3, 0];
  const other = [0, 0, 1];
  const items = [
    { key: '#1', kind: 'outcome', type: 'open_question', id: 1, text: '¿Conviene certificarnos en ISO 27001 este año o esperamos al próximo cliente enterprise?', embedding: iso },
    { key: '#2', kind: 'outcome', type: 'risk', id: 2, text: 'Perder clientes enterprise', embedding: isoish },
    { key: 'act_a', kind: 'action', type: 'action_item', text: 'Investigar requisitos', embedding: iso },
    { key: '#3', kind: 'outcome', type: 'decision', id: 3, text: 'Contratar diseñador', embedding: other },
    { key: 'act_b', kind: 'action', type: 'action_item', decision_id: 3, text: 'Publicar el aviso' }
  ];
  const groups = groupCapture(items, 0.55);
  assert.equal(groups.length, 1, 'the hiring decision and its action item have no question or risk: no thread');
  assert.deepEqual(groups[0].map(item => item.key), ['#1', '#2', 'act_a']);
  assert.ok(labelFor(groups[0]).length <= 80);
  assert.match(labelFor(groups[0]), /^¿Conviene certificarnos en ISO 27001/);

  assert.equal(groupCapture(items, 0.99).length, 1, 'identical embeddings still group');
  assert.deepEqual(groupCapture(items, 0.99)[0].map(item => item.key), ['#1', 'act_a']);
});

test('the backfill never chains a whole meeting into one thread: each item joins its closest question or risk, at most 4 per thread', () => {
  const { groupCapture } = require('../../scripts/migrations/010-topic-threads');
  // Two subjects, and a "bridge" item halfway between them that single-link grouping would chain through
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  const near = (v, noise) => v.map((x, i) => x + (i === 2 ? noise : 0));
  const items = [
    { key: '#1', kind: 'outcome', type: 'open_question', id: 1, text: 'Free trial?', embedding: a },
    { key: '#2', kind: 'outcome', type: 'open_question', id: 2, text: 'People Day?', embedding: b },
    { key: '#3', kind: 'outcome', type: 'decision', id: 3, text: 'bridge', embedding: [0.7, 0.72, 0] },
    ...[4, 5, 6, 7, 8].map(id => ({ key: `#${id}`, kind: 'outcome', type: 'decision', id, text: `trial ${id}`, embedding: near(a, id / 10) })),
    { key: 'act_x', kind: 'action', type: 'action_item', decision_id: 4, text: 'no embedding' },
    { key: '#9', kind: 'outcome', type: 'risk', id: 9, text: 'People Day risk', embedding: near(b, 0.2) }
  ];
  const groups = groupCapture(items, 0.6);
  assert.equal(groups.length, 2, 'two subjects, two threads');
  const trial = groups.find(group => group[0].key === '#1');
  const people = groups.find(group => group[0].key === '#2');
  assert.deepEqual(people.map(item => item.key), ['#2', '#3', '#9'], 'the bridge joins only its closest question');
  const attached = trial.filter(item => item.type === 'decision');
  assert.equal(attached.length, 4, 'at most 4 decisions and action items, the closest ones');
  assert.ok(!trial.some(item => item.key === '#8'), 'the farthest one is left out');
  assert.ok(trial.some(item => item.key === 'act_x'), 'an action item without embedding follows its decision');
  assert.ok(trial.filter(item => item.key !== '#1' && item.key !== 'act_x').every(item => item.similarity >= 0.6));
});

test('the backfill computes embeddings for action items that have none, so they can join a thread', async () => {
  const { fillMissingEmbeddings, groupCapture } = require('../../scripts/migrations/010-topic-threads');
  const items = [
    { key: '#297', kind: 'outcome', type: 'open_question', id: 297, text: '¿ISO 27001?', embedding: [1, 0, 0] },
    { key: 'act_iso', kind: 'action', type: 'action_item', text: 'Investigar requisitos ISO 27001' },
    { key: 'act_has', kind: 'action', type: 'action_item', text: 'Otra', embedding: [0, 1, 0] }
  ];
  const captures = new Map([['W|S|m', items]]);
  assert.equal(groupCapture(items, 0.6).length, 0, 'without an embedding the action item cannot join');
  const asked = [];
  const computed = await fillMissingEmbeddings(captures, async text => { asked.push(text); return [0.95, 0.05, 0]; });
  assert.equal(computed, 1);
  assert.deepEqual(asked, ['Investigar requisitos ISO 27001'], 'only items without one');
  assert.deepEqual(groupCapture(items, 0.6)[0].map(item => item.key), ['#297', 'act_iso']);
  assert.equal(await fillMissingEmbeddings(captures, null), 0, 'embeddings off: nothing computed');
});
