const { normalize, extractKeywords, matchedKeywords, requiredMatches } = require('./relevance');

/**
 * Open action items for a Search question ("What's still pending from Ana?",
 * "mis pendientes", "pendientes del directorio"), so Search is also a way to
 * see what's pending before a meeting.
 *
 * Picks, in this order:
 *   1. a meeting named in the question ("la weekly de growth" → "Weekly Product-Led Growth"):
 *      the open items of all its sessions, like the morning summary's meeting prep
 *      (core/briefs/meeting-prep); narrowed to a person also named, when they have some there;
 *   2. a person named in the question (any owner's first or full name): their items;
 *   3. "my/mis …" in a question about pending work: the viewer's items;
 *   4. otherwise items whose text matches the question's topic words; a question
 *      about pending work with no topic gets all open items.
 * Questions that aren't about pending work only get topic matches (at most 5).
 */

// Words that make a question about pending work (compared without accents)
const INTENT = /\b(pending|pendings|pendiente|pendientes|action items?|acciones|tareas?|tasks?|to ?dos?|compromisos?|follow ?ups?|open items|por hacer|owes?|debe|deben)\b/;
const FIRST_PERSON = /\b(my|mine|me|mis|mi|yo|tengo)\b/;
const INTENT_WORDS = new Set(['pending', 'pendings', 'pendiente', 'pendientes', 'action', 'actions', 'item', 'items', 'acciones',
  'tarea', 'tareas', 'task', 'tasks', 'todo', 'todos', 'compromiso', 'compromisos', 'follow', 'ups', 'open', 'abiertos', 'abiertas',
  'owe', 'owes', 'debe', 'deben', 'still', 'todavia', 'aun', 'activos', 'activas', 'active', 'show', 'list', 'lista', 'mine', 'mis']);
const MAX_WITH_INTENT = 10;
const MAX_TOPIC_ONLY = 5;

// Words that say "a meeting" but not which one: a title needs another word in common
const GENERIC_TITLE_WORDS = new Set(['weekly', 'semanal', 'daily', 'diario', 'diaria', 'monthly', 'mensual', 'reunion', 'reuniones', 'meeting',
  'meetings', 'sync', 'stand', 'standup', 'call', 'llamada', 'sesion', 'session', 'check', 'team', 'equipo', 'review', 'revision',
  'kickoff', 'catch', 'one', 'google', 'meet', 'notes', 'notas', 'gemini', 'transcript', 'transcripcion', 'con', 'with', 'the', 'and',
  'del', 'las', 'los', 'para', 'por', 'una', 'uno']);

// Words that say the question is about a meeting
const MEETING_WORDS = new Set(['weekly', 'semanal', 'daily', 'reunion', 'reuniones', 'meeting', 'meetings', 'sync', 'standup',
  'llamada', 'call', 'sesion', 'session', 'comite', 'kickoff']);

/** A meeting title without case, accents or punctuation ("Product-Led" = "product led") */
function meetingKey(title) {
  return normalize(title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function titleWords(title) {
  return [...new Set(normalize(title).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3))];
}

/**
 * The meeting a question names: the title (of an open item's meeting) whose words the question
 * shares most, with at least one word that isn't generic ("growth", not "weekly"). Ties: all of them.
 * @param {string} query
 * @param {Object[]} items
 * @returns {string[]} normalized titles
 */
function namedMeetings(query, items) {
  const q = normalize(query);
  const scored = new Map();
  for (const item of items) {
    const title = item.source && item.source.title;
    if (!title) continue;
    const key = meetingKey(title);
    if (scored.has(key)) continue;
    const words = titleWords(title).filter(word => hasWord(q, word));
    const distinctive = words.filter(word => !GENERIC_TITLE_WORDS.has(word) && !INTENT_WORDS.has(word));
    scored.set(key, distinctive.length ? words.length : 0);
  }
  const best = Math.max(0, ...scored.values());
  return best ? [...scored].filter(([, score]) => score === best).map(([key]) => key) : [];
}

function firstName(name) {
  return normalize(name).split(/\s+/)[0] || '';
}

function hasWord(text, word) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

/** What a keyword can match in an action item: text, why, owners, meeting title */
function searchable(item) {
  return {
    text: item.text,
    rationale: item.rationale,
    owner_name: (item.owners || []).map(owner => owner.name).join(' '),
    source_details: { title: item.source && item.source.title }
  };
}

/**
 * Picks the action items a question is about
 * @param {string} query
 * @param {Object[]} items - open action items the viewer can see (listActionItems), most urgent first
 * @param {Object} [options]
 * @param {string} [options.viewerId] - for "my action items"
 * @returns {{ items: Object[], aboutPending: boolean, people: string[], meetings: string[] }}
 *   meetings: the titles of the meetings the question named (their items were picked)
 */
function selectActionItems(query, items, { viewerId = null } = {}) {
  const q = normalize(query);
  const aboutPending = INTENT.test(q);

  // 1. A meeting named in the question: its items, from every session (same title)
  // (only when it's about pending work, or says "meeting"/"weekly"…: "¿qué sabemos de growth?" stays a topic question)
  const saysMeeting = q.split(/[^\p{L}\p{N}]+/u).some(word => MEETING_WORDS.has(word));
  const meetingKeys = aboutPending || saysMeeting ? namedMeetings(query, items) : [];
  const inMeeting = meetingKeys.length ? items.filter(item => item.source && meetingKeys.includes(meetingKey(item.source.title || ''))) : [];

  // 1. People named in the question (owner names, including people who aren't members)
  const names = new Map(); // normalized first or full name → display name
  for (const item of items) {
    for (const owner of item.owners || []) {
      const full = normalize(owner.name);
      const first = firstName(owner.name);
      if (full.length >= 3) names.set(full, owner.name);
      if (first.length >= 3) names.set(first, owner.name);
    }
  }
  const named = [...names.keys()].filter(name => hasWord(q, name));
  const ownedByNamed = item => (item.owners || []).some(owner => named.includes(normalize(owner.name)) || named.includes(firstName(owner.name)));
  if (inMeeting.length > 0) {
    const theirs = named.length ? inMeeting.filter(ownedByNamed) : [];
    // One title per meeting, as it was first written
    const firstTitle = new Map();
    inMeeting.forEach(item => { if (!firstTitle.has(meetingKey(item.source.title))) firstTitle.set(meetingKey(item.source.title), item.source.title); });
    const meetings = [...firstTitle.values()];
    return {
      items: (theirs.length ? theirs : inMeeting).slice(0, MAX_WITH_INTENT),
      aboutPending: true,
      people: theirs.length ? [...new Set(named.map(name => names.get(name)))] : [],
      meetings
    };
  }
  if (named.length > 0) {
    const picked = items.filter(ownedByNamed);
    return { items: picked.slice(0, MAX_WITH_INTENT), aboutPending: true, people: [...new Set(named.map(name => names.get(name)))], meetings: [] };
  }

  // 2. "My action items"
  if (aboutPending && viewerId && FIRST_PERSON.test(q)) {
    return { items: items.filter(item => (item.owner_ids || []).includes(viewerId)).slice(0, MAX_WITH_INTENT), aboutPending, people: [], meetings: [] };
  }

  // 3. Topic words
  const keywords = extractKeywords(query).filter(word => !INTENT_WORDS.has(word));
  const byTopic = keywords.length
    ? items.filter(item => matchedKeywords(searchable(item), keywords).length >= requiredMatches(keywords.length))
    : [];
  if (aboutPending) {
    return { items: (keywords.length ? byTopic : items).slice(0, MAX_WITH_INTENT), aboutPending, people: [], meetings: [] };
  }
  return { items: byTopic.slice(0, MAX_TOPIC_ONLY), aboutPending, people: [], meetings: [] };
}

module.exports = { selectActionItems };
