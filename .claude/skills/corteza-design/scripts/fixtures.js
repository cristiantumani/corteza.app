/**
 * Fake data for preview.js: what each page's API calls return, in the shapes the real routes send.
 * Everything here is invented (no real meetings, people or companies). Edit freely to preview a state:
 * an empty workspace, a long title, an overdue item, an admin vs a member.
 */

const now = Date.now();
const iso = msAgo => new Date(now - msAgo).toISOString();
const day = 24 * 3600 * 1000;
const date = daysFromNow => new Date(now + daysFromNow * day).toISOString().slice(0, 10);

const user = {
  user_id: 'U1', user_name: 'Ana Rojas', email: 'ana@acme.example', workspace_id: 'W1', workspace_name: 'Acme',
  is_admin: true, onboarding_seen: true, timezone: 'America/Santiago'
};

const spaces = [
  { space_id: 'sp1', name: 'Personal', settings: { icon: '👤' }, is_default: true, visibility: 'private', decision_count: 6, can_create: true, can_modify: true, role: 'owner' }
];

const people = [
  { user_id: 'U1', name: 'Ana Rojas', email: 'ana@acme.example' },
  { user_id: 'U2', name: 'Bruno Díaz', email: 'bruno@acme.example' },
  { user_id: 'U3', name: 'Carla Méndez', email: 'carla@acme.example' }
];

const meet = title => ({ type: 'google_meet', title, url: 'https://meet.google.com/abc-defg-hij', external_id: `conferenceRecords/${title.length}` });

const decisions = [
  { id: 101, type: 'decision', text: 'Lanzar el plan anual con 20% de descuento a partir del 1 de noviembre', rationale: 'El 60% de los clientes pidió pago anual en las entrevistas', evidence_quote: 'Si lo dejamos en 20% seguimos sobre el margen objetivo', owner_name: 'Bruno Díaz', owner_user_id: 'U2', capture: 'ai', review_status: null, creator: 'Ana Rojas', user_id: 'U1', space_id: 'sp1', space_name: 'Personal', tags: ['pricing'], timestamp: iso(2 * 3600 * 1000), source_details: meet('Planificación comercial Q4'), topic_id: 'top_pricing', topic: 'Plan anual' },
  { id: 102, type: 'open_question', text: '¿Quién aprueba descuentos mayores al 30% para clientes enterprise?', capture: 'ai', review_status: null, creator: 'Ana Rojas', user_id: 'U1', space_id: 'sp1', space_name: 'Personal', tags: ['pricing'], timestamp: iso(2 * 3600 * 1000), source_details: meet('Planificación comercial Q4'), topic_id: 'top_pricing', topic: 'Plan anual' },
  { id: 103, type: 'risk', text: 'El proveedor de pagos podría no soportar cobro anual antes de noviembre', raised_by: 'Carla Méndez', capture: 'ai', review_status: 'confirmed', creator: 'Ana Rojas', user_id: 'U1', space_id: 'sp1', space_name: 'Personal', tags: ['pagos'], timestamp: iso(2 * 3600 * 1000), source_details: meet('Planificación comercial Q4'), topic_id: 'top_pricing', topic: 'Plan anual' },
  { id: 104, type: 'decision', text: 'Mover la reunión semanal de operaciones a los martes 9:30', capture: 'ai', review_status: 'confirmed', creator: 'Ana Rojas', user_id: 'U1', space_id: 'sp1', space_name: 'Personal', tags: [], timestamp: iso(26 * 3600 * 1000), source_details: meet('Weekly Ops') },
  { id: 105, type: 'decision', text: 'Usar Linear como única herramienta de seguimiento del equipo de producto y dejar de usar la planilla compartida', rationale: 'Hoy hay tareas duplicadas en dos lugares', capture: 'manual', creator: 'Ana Rojas', user_id: 'U1', space_id: 'sp1', space_name: 'Personal', tags: ['producto', 'herramientas'], timestamp: iso(3 * day) },
  { id: 106, type: 'risk', text: 'La migración de datos de clientes antiguos puede tomar más de dos semanas', capture: 'ai', review_status: 'confirmed', creator: 'Ana Rojas', user_id: 'U1', space_id: 'sp1', space_name: 'Personal', tags: [], timestamp: iso(5 * day), source_details: meet('Revisión técnica') }
];

const actionItems = [
  { item_id: 'a1', text: 'Preparar la página de precios con el plan anual', status: 'open', due_date: date(5), owners: [{ user_id: 'U1', name: 'Ana Rojas' }], owner_ids: ['U1'], decision_id: 101, rationale: 'Necesaria antes del lanzamiento', evidence_quote: 'Ana, ¿te encargas de la página?', source: meet('Planificación comercial Q4'), created_by: { user_id: 'U1', name: 'Ana Rojas' }, thread: { topic_id: 'top_pricing', topic: 'Plan anual', open_question: '¿Quién aprueba descuentos mayores al 30% para clientes enterprise?' } },
  { item_id: 'a2', text: 'Confirmar con el proveedor de pagos si soporta cobro anual', status: 'open', due_date: date(-2), owners: [{ user_id: 'U2', name: 'Bruno Díaz' }, { user_id: 'U1', name: 'Ana Rojas' }], owner_ids: ['U2', 'U1'], source: meet('Planificación comercial Q4'), created_by: { user_id: 'U2', name: 'Bruno Díaz' }, unseen: true },
  { item_id: 'a3', text: 'Enviar el resumen de la revisión técnica al equipo', status: 'open', due_date: null, owners: [], owner_ids: [], source: meet('Revisión técnica'), created_by: { user_id: 'U1', name: 'Ana Rojas' } },
  { item_id: 'a4', text: 'Actualizar el calendario de la reunión semanal', status: 'done', due_date: date(-1), completed_at: iso(day), owners: [{ user_id: 'U1', name: 'Ana Rojas' }], owner_ids: ['U1'], source: meet('Weekly Ops'), created_by: { user_id: 'U1', name: 'Ana Rojas' } }
];

const questionsRisks = decisions
  .filter(d => d.type === 'open_question' || d.type === 'risk')
  .map(d => ({ ...d, resolution_status: 'open' }));

const google = {
  success: true, configured: true, connected: true, active_import: null, import_max_days: 90, status: 'active',
  needs_reconsent: false, calendar_connected: false, google_email: user.email, connected_at: iso(20 * day),
  last_polled_at: iso(4 * 60 * 1000), last_error: null, meetings_processed: 12, decisions_captured: 43,
  outcomes_by_type: { decision: 31, open_question: 7, risk: 5 },
  settings: { auto_capture: true, space_id: 'sp1', output_language: 'auto', skip_one_on_ones: true },
  recent_meetings: [
    { title: 'Planificación comercial Q4', status: 'completed', decisions_created: 3, outcomes_by_type: { decision: 1, open_question: 1, risk: 1 }, action_items_created: 2, updated_at: iso(2 * 3600 * 1000) },
    { title: 'Ana / Bruno', status: 'skipped', skip_reason: 'one_on_one', updated_at: iso(5 * 3600 * 1000) },
    { title: 'Weekly Ops', status: 'completed', decisions_created: 1, outcomes_by_type: { decision: 1 }, action_items_created: 1, updated_at: iso(26 * 3600 * 1000) }
  ]
};

/**
 * GET responses by path (no query string). A function receives the request.
 * Paths not listed here answer { success: true } and are reported as "unmocked" by preview.js.
 */
// Earlier items the first outcome to review may close (GET /api/home review[0].may_close, GET /api/decisions/101/links)
const mayClose = [
  { kind: 'decision', id: 72, relation: 'answers', type: 'open_question', text: '¿Ofrecemos un plan anual con descuento este trimestre?', meeting: 'Revisión de precios', date: date(-21), owners: [], due_date: null, reason: 'La decisión fija el plan anual con 20% de descuento.' },
  { kind: 'action_item', id: 'ai_old_1', relation: 'completes', type: 'action_item', text: 'Proponer el precio del plan anual', meeting: 'Revisión de precios', date: date(-21), owners: ['Bruno Díaz'], due_date: date(-7), reason: 'El precio quedó decidido: 20% de descuento.' }
];

const routes = {
  'GET /auth/me': { authenticated: true, user },
  'GET /api/spaces': { success: true, spaces },
  'GET /api/people': { success: true, people },
  'GET /api/decisions': req => {
    const types = typeof req.query.type === 'string' ? req.query.type.split(',') : null;
    const list = decisions.filter(d => !types || types.includes(d.type));
    return { decisions: list, pagination: { total: list.length, page: 1, pages: 1, limit: 50 } };
  },
  'GET /api/stats': { total: decisions.length, byType: { decision: 3, open_question: 1, risk: 2 }, byCategory: {}, lastWeek: 4 },
  'GET /api/action-items': req => {
    if (req.query.decision_id) return { success: true, items: actionItems.filter(i => String(i.decision_id) === req.query.decision_id), user_id: 'U1' };
    const status = req.query.status || 'open';
    const matches = i => status === 'all' || i.status === status || (status === 'resolved' && (i.status === 'done' || i.status === 'cancelled'));
    return { success: true, items: actionItems.filter(matches), user_id: 'U1' };
  },
  // Edit or mark done (Action items page): the item with the changes applied
  'PATCH /api/action-items/a1': req => {
    const item = actionItems[0];
    const { owner_ids: ownerIds, keep_owner_names: keep, ...changes } = req.body || {};
    const owners = ownerIds ? people.filter(p => ownerIds.includes(p.user_id)).map(p => ({ user_id: p.user_id, name: p.name })) : item.owners;
    return { success: true, item: { ...item, ...changes, owners, owner_ids: owners.map(o => o.user_id) }, linked_questions: [] };
  },
  'GET /api/action-items/from-colleagues': { success: true, count: 1, from: [{ name: 'Bruno Díaz', count: 1 }] },
  'GET /api/questions-risks': req => {
    const type = req.query.type || 'all';
    const items = questionsRisks.filter(i => type === 'all' || i.type === type);
    return { success: true, items, counts: { all: questionsRisks.length, open_question: 1, risk: 2 } };
  },
  'GET /api/home': () => {
    const pending = decisions.filter(d => d.capture === 'ai' && !d.review_status);
    const open = actionItems.filter(i => i.status === 'open');
    const todayStr = date(0);
    return {
      success: true,
      since: iso(day),
      summary: {
        new_outcomes: 3, meetings: 1, overdue: open.filter(i => i.due_date && i.due_date < todayStr).length,
        due_today: 0, open_action_items: open.length, to_review: pending.length, open_questions: 1, open_risks: 2
      },
      owe: open.map(i => ({ item_id: i.item_id, text: i.text, due_date: i.due_date, owners: i.owners, source: i.source, new_from_colleague: !!i.unseen })),
      open: questionsRisks,
      decided: decisions.filter(d => d.type === 'decision' && (d.capture !== 'ai' || d.review_status === 'confirmed')),
      // The first one closes earlier items on the same subject (cross-meeting links)
      review: pending.map((d, i) => ({ ...d, may_close: i === 0 ? mayClose : [] }))
    };
  },
  'GET /api/decisions/101/links': () => ({ success: true, may_close: mayClose, can_close: true }),
  'GET /api/integrations/google': google,
  'GET /api/integrations/google/meetings': { success: true, meetings: [], truncated: false },
  'GET /api/ai-context': {
    success: true, can_edit_company: true,
    company: { description: 'Acme vende software de facturación a pymes en Chile y Perú.', glossary: 'MRR: ingreso mensual recurrente', documents: [] },
    personal: { role: 'Head of Operations', focus: 'Lanzamiento del plan anual', glossary: '' },
    limits: { description: 4000, glossary: 8000, role: 300, focus: 1500, documentName: 120, documentText: 20000, documentsText: 40000, documents: 5 }
  },
  'GET /api/onboarding': { success: true, seen: true, is_admin: true },
  'GET /api/invites': { success: true, invites: [] },
  'GET /api/workspace-admins': { success: true, admins: [{ user_id: 'U1', user_name: 'Ana Rojas' }] },
  'GET /api/ai/pending-suggestions': { success: true, suggestions: [] },
  'GET /api/me/timezone': { success: true, timezone: user.timezone, automatic: true },
  'GET /api/me/language': { success: true, language: 'en', chosen: null },
  'GET /api/me/digest-voice': {
    success: true, voice: 'sarcastic', chosen: null, default_voice: 'sarcastic', workspace_enabled: true, is_admin: true,
    voices: ['classic', 'sergeant', 'sarcastic'],
    samples: require('../../../../src/core/digest/voice').SAMPLES.en
  },
  'PUT /api/me/digest-voice': req => ({
    success: true, voice: req.body.voice, chosen: req.body.voice, default_voice: 'sarcastic', workspace_enabled: true,
    voices: ['classic', 'sergeant', 'sarcastic'], samples: require('../../../../src/core/digest/voice').SAMPLES.en
  }),
  'POST /api/semantic-search': {
    success: true,
    response: 'Se decidió lanzar el plan anual con 20% de descuento desde el 1 de noviembre. Bruno es responsable, y falta confirmar que el proveedor de pagos soporte cobro anual.',
    decisions: decisions.slice(0, 4),
    used_ids: [101, 103],
    action_items: actionItems.slice(0, 2)
  },
  'POST /api/me/timezone': { success: true },
  'POST /api/questions-risks/103/resolve': req => ({
    success: true, resolution_status: 'resolved', resolution_note: (req.body && req.body.note) || null,
    resolved_by: { user_id: user.user_id, name: user.user_name }, resolved_at: new Date().toISOString(), linked_risks: []
  }),
  'POST /api/questions-risks/103/reopen': { success: true, resolution_status: 'open', resolution_note: null, resolved_by: null, resolved_at: null },
  'POST /api/action-items/from-colleagues/seen': { success: true, seen: 1 }
};

module.exports = { user, spaces, routes };
