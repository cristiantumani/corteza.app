const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { outputDir, fileNameFor, toFixture } = require('../../scripts/eval/export-meetings');
const { toFixtureLabels, SCHEMA } = require('../../scripts/eval/draft-labels');

test('exported meetings never land inside the repository', () => {
  const repo = path.resolve(__dirname, '..', '..');
  assert.throws(() => outputDir(repo), /outside the repository/);
  assert.throws(() => outputDir(path.join(repo, 'test', 'fixtures')), /outside the repository/);
  assert.equal(outputDir('~/corteza-eval'), path.join(os.homedir(), 'corteza-eval'));
});

test('an exported meeting becomes an unlabeled fixture with a readable file name', () => {
  const meeting = {
    externalId: 'conferenceRecords/abc', title: 'Revisión de indicadores / CAC', url: 'https://docs.google.com/x',
    participants: ['Cristian', 'José Tomás'], occurredAt: new Date('2026-09-29T14:00:00Z'), text: 'Transcript:\nCristian: hola'
  };
  assert.equal(fileNameFor(meeting), '2026-09-29-revision-de-indicadores-cac.json');
  const fixture = toFixture(meeting);
  assert.equal(fixture.labeled, false);
  assert.equal(fixture.date, '2026-09-29');
  assert.deepEqual(fixture.expected, []);
  assert.deepEqual(fixture.not_expected, []);
  assert.equal(fixture.transcript, 'Transcript:\nCristian: hola');
});

test('drafted labels match the fixture format the scorer reads', () => {
  const labels = toFixtureLabels({
    meeting_type: 'review',
    expected: [
      { type: 'decision', text: 'Se aprueba el reajuste salarial', match: ['reajust'], owner: null, due_date: null, why: 'acuerdo explícito' },
      { type: 'action_item', text: 'José Tomás revisa la asignación de gastos por mercado', match: ['gasto', 'mercado'], owner: 'José Tomás', due_date: null, why: 'tarea con dueño' }
    ],
    not_expected: [{ text: 'Reprogramar la reunión a las 15:45', match: ['15:45'], why: 'logística' }]
  });
  assert.deepEqual(labels.expected[0], { type: 'decision', text: 'Se aprueba el reajuste salarial', match: ['reajust'], why: 'acuerdo explícito' });
  assert.equal(labels.expected[1].owner, 'José Tomás');
  assert.equal(labels.expected[1].due_date, null);
  assert.deepEqual(labels.not_expected, [{ text: 'Reprogramar la reunión a las 15:45', match: ['15:45'], why: 'logística' }]);
  assert.equal(SCHEMA.additionalProperties, false);
});
