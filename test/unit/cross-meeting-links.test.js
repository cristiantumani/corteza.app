const { test } = require('node:test');
const assert = require('node:assert/strict');
const { linksEnabled, buildLinkPrompt, parseLinks } = require('../../src/core/links/cross-meeting');

test('linksEnabled: only the listed Google domains, or all', () => {
  assert.equal(linksEnabled({ google_domain: 'ninjaexcel.com' }, 'ninjaexcel.com'), true);
  assert.equal(linksEnabled({ google_domain: 'NinjaExcel.com' }, ' ninjaexcel.com , acme.io'), true);
  assert.equal(linksEnabled({ google_domain: 'acme.io' }, 'ninjaexcel.com'), false);
  assert.equal(linksEnabled({ google_domain: null }, 'ninjaexcel.com'), false);
  assert.equal(linksEnabled(null, ''), false);
  assert.equal(linksEnabled({ google_domain: 'acme.io' }, 'all'), true);
});

const newItems = [
  { label: 'N1', kind: 'decision', id: 30, type: 'decision', text: 'Contratamos a Florencia como Product Designer', owners: [] },
  { label: 'N2', kind: 'action_item', id: 'act_new', type: 'action_item', text: 'Enviar contrato a Florencia', owners: ['Cristian'] }
];
const earlier = [
  { label: 'E1', kind: 'decision', id: 10, type: 'open_question', text: '¿Contratamos diseñador este trimestre?', date: '2026-09-01', meeting: 'Weekly Ops', owners: [] },
  { label: 'E2', kind: 'action_item', id: 'act_old', type: 'action_item', text: 'Entrevistar a las candidatas', date: '2026-09-15', meeting: 'Weekly Ops', owners: ['Cristian'] },
  { label: 'E3', kind: 'decision', id: 11, type: 'risk', text: 'Sin diseñador se atrasa el rediseño', owners: [] },
  { label: 'E4', kind: 'decision', id: 12, type: 'decision', text: 'Abrimos la búsqueda de diseñador', owners: [] }
];
const byLabel = list => new Map(list.map(item => [item.label, item]));

test('the prompt lists new and earlier items by label, with type, meeting and owner', () => {
  const prompt = buildLinkPrompt(newItems, earlier);
  assert.match(prompt, /N1 \[Decision\]/);
  assert.match(prompt, /E2 \[Action item\] · 2026-09-15 · meeting "Weekly Ops" · owner: Cristian/);
  assert.match(prompt, /Precision matters more than recall/);
});

test('parseLinks keeps valid pairs and relations that fit both types', () => {
  const reply = `Here you go: {"links": [
    {"new": "N1", "earlier": "E1", "relation": "answers", "reason": "Se decidió contratar"},
    {"new": "N1", "earlier": "E2", "relation": "completes", "reason": "Ya se contrató"},
    {"new": "N1", "earlier": "E3", "relation": "answers", "reason": "wrong relation for a risk"},
    {"new": "N2", "earlier": "E2", "relation": "completes", "reason": "an action item can't resolve"},
    {"new": "N1", "earlier": "E4", "relation": "completes"},
    {"new": "N1", "earlier": "E1", "relation": "answers", "reason": "duplicate"},
    {"new": "N9", "earlier": "E1", "relation": "answers"},
    {"new": "N1", "earlier": "E7", "relation": "answers"}
  ]}`;
  const links = parseLinks(reply, byLabel(newItems), byLabel(earlier));
  assert.deepEqual(links.map(l => `${l.newItem.label}-${l.earlier.label}-${l.relation}`), [
    'N1-E1-answers', 'N1-E2-completes', 'N1-E3-none', 'N2-E2-none', 'N1-E4-none'
  ]);
  assert.equal(links[0].reason, 'Se decidió contratar');
  assert.equal(links[4].reason, null);
});

test('parseLinks: unreadable replies give no links', () => {
  assert.deepEqual(parseLinks('no json here', byLabel(newItems), byLabel(earlier)), []);
  assert.deepEqual(parseLinks('{"links": "nope"}', byLabel(newItems), byLabel(earlier)), []);
  assert.deepEqual(parseLinks('{broken', byLabel(newItems), byLabel(earlier)), []);
});
