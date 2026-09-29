const { normalize, extractKeywords, matchedKeywords, requiredMatches } = require('./relevance');

/**
 * Open action items for a Search question ("What's still pending from Ana?",
 * "mis pendientes", "pendientes del directorio"), so Search is also a way to
 * see what's pending before a meeting.
 *
 * Picks, in this order:
 *   1. a person named in the question (any owner's first or full name): their items;
 *   2. "my/mis …" in a question about pending work: the viewer's items;
 *   3. otherwise items whose text matches the question's topic words; a question
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
 * @returns {{ items: Object[], aboutPending: boolean, people: string[] }}
 */
function selectActionItems(query, items, { viewerId = null } = {}) {
  const q = normalize(query);
  const aboutPending = INTENT.test(q);

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
  if (named.length > 0) {
    const picked = items.filter(item => (item.owners || []).some(owner =>
      named.includes(normalize(owner.name)) || named.includes(firstName(owner.name))));
    return { items: picked.slice(0, MAX_WITH_INTENT), aboutPending: true, people: [...new Set(named.map(name => names.get(name)))] };
  }

  // 2. "My action items"
  if (aboutPending && viewerId && FIRST_PERSON.test(q)) {
    return { items: items.filter(item => (item.owner_ids || []).includes(viewerId)).slice(0, MAX_WITH_INTENT), aboutPending, people: [] };
  }

  // 3. Topic words
  const keywords = extractKeywords(query).filter(word => !INTENT_WORDS.has(word));
  const byTopic = keywords.length
    ? items.filter(item => matchedKeywords(searchable(item), keywords).length >= requiredMatches(keywords.length))
    : [];
  if (aboutPending) {
    return { items: (keywords.length ? byTopic : items).slice(0, MAX_WITH_INTENT), aboutPending, people: [] };
  }
  return { items: byTopic.slice(0, MAX_TOPIC_ONLY), aboutPending, people: [] };
}

module.exports = { selectActionItems };
