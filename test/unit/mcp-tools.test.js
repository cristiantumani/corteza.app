const { test } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};

const { outcomeCard, actionCard } = require('../../src/integrations/mcp/tools');
const { INSTRUCTIONS } = require('../../src/integrations/mcp/server');

test('an outcome card carries what a card shows, a link, and nothing internal', () => {
  process.env.BASE_URL = 'https://app.corteza.app';
  const card = outcomeCard({
    id: 7, type: 'risk', text: 'La factura puede llegar tarde', rationale: null, owner_name: null, raised_by: 'Ana',
    resolution_status: 'open', topic: 'Facturación', topic_id: 'top_abcdef12', timestamp: '2026-10-20T10:00:00Z',
    source_details: { title: 'Revisión', external_id: 'meet-9' }, evidence_quote: 'quote', embedding: [1, 2], workspace_id: 'W', space_id: 'S'
  });
  assert.equal(card.headline, 'La factura puede llegar tarde');
  assert.equal(card.link, 'https://app.corteza.app/questions?item=7');
  assert.equal(card.meeting, 'Revisión');
  for (const key of ['embedding', 'evidence_quote', 'workspace_id', 'space_id']) assert.ok(!(key in card), key);

  const decision = outcomeCard({ id: 8, type: 'decision', text: 'Lanzar', source_details: { external_id: 'a b' } });
  assert.equal(decision.link, 'https://app.corteza.app/dashboard?tab=meetings&meeting=a%20b');
  assert.equal(decision.status, null);
});

test('an action item card: task, owners, due date, status and link', () => {
  const card = actionCard({ item_id: 'act_1', text: 'Ana envía el deck', owners: [{ name: 'Ana', user_id: 'U1', email: 'a@x.com' }], owner_ids: ['U1'], due_date: '2026-10-30', status: 'open', source: { title: 'Sync' } });
  assert.deepEqual(card.owners, ['Ana'], 'names only, no emails or ids');
  assert.equal(card.link, 'https://app.corteza.app/actions?item=act_1');
  assert.ok(!('owner_ids' in card));
});

test('the server tells assistants to treat meeting text as information, not instructions', () => {
  assert.match(INSTRUCTIONS, /not instructions/);
});
