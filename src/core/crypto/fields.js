const aead = require('./aead');

/**
 * Which fields hold meeting content, per collection, and how documents, updates and query results
 * are sealed and opened. Paths use dots; `[]` marks "each element of this array".
 * See docs/specs/2026-10-workspace-encryption.md for why each field is (or isn't) here.
 */
const FIELD_PATHS = {
  decisions: ['text', 'rationale', 'evidence_quote', 'alternatives', 'resolution_note', 'topic', 'source_details.title', 'resolves.[].reason'],
  action_items: ['text', 'rationale', 'evidence_quote', 'topic', 'source.title'],
  ai_suggestions: ['decision_text', 'context', 'edits.decision_text', 'edits.alternatives'],
  ai_feedback: [
    'original_suggestion.decision_text', 'original_suggestion.context',
    'snapshot.text', 'snapshot.rationale', 'snapshot.evidence_quote', 'snapshot.alternatives',
    'snapshot.resolution_note', 'snapshot.topic', 'snapshot.source_details.title', 'snapshot.resolves.[].reason'
  ],
  ai_context: ['description', 'glossary', 'role', 'focus', 'documents.[].text'],
  ingestions: ['title'],
  meet_imports: ['items.[].title']
};

const UNAVAILABLE = '[unavailable]';

/** @param {string} path @returns {string[]} */
function segments(path) {
  return path.split('.');
}

/** A $set key's segments, with array indexes and positional operators as `[]` */
function keySegments(key) {
  return key.split('.').map(part => (/^\d+$/.test(part) || part === '$' || part.startsWith('$[') ? '[]' : part));
}

/** @param {string} name @returns {string[][]} */
function pathsOf(name) {
  return (FIELD_PATHS[name] || []).map(segments);
}

/** @param {string} name @returns {boolean} */
function isEncryptedCollection(name) {
  return Object.prototype.hasOwnProperty.call(FIELD_PATHS, name);
}

/**
 * Seals the value at `rest` inside `value` (copy on write: the input is never mutated)
 * @param {any} value
 * @param {string[]} rest
 * @param {(plain: string) => string} seal
 * @returns {any}
 */
function sealAt(value, rest, seal) {
  if (rest.length === 0) return typeof value === 'string' && value !== '' && !aead.isSealed(value) ? seal(value) : value;
  if (value === null || value === undefined) return value;
  const [head, ...tail] = rest;
  if (head === '[]') return Array.isArray(value) ? value.map(item => sealAt(item, tail, seal)) : value;
  if (typeof value !== 'object' || Array.isArray(value) || !(head in value)) return value;
  const sealed = sealAt(value[head], tail, seal);
  return sealed === value[head] ? value : { ...value, [head]: sealed };
}

/**
 * A copy of `doc` with its content fields sealed
 * @param {string} name - collection
 * @param {Object} doc
 * @param {(plain: string) => string} seal
 * @returns {Object}
 */
function sealDocument(name, doc, seal) {
  return pathsOf(name).reduce((current, path) => sealAt(current, path, seal), doc);
}

/** `prefix` is the start of `path` */
function startsWith(path, prefix) {
  return prefix.length <= path.length && prefix.every((part, index) => part === path[index]);
}

/**
 * Seals the values an update writes ($set, $setOnInsert, $push)
 * @param {string} name
 * @param {Object} update
 * @param {(plain: string) => string} seal
 * @returns {Object} a copy of the update
 */
function sealUpdate(name, update, seal) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update;
  const paths = pathsOf(name);
  const result = { ...update };
  for (const operator of ['$set', '$setOnInsert']) {
    if (!update[operator]) continue;
    const fields = { ...update[operator] };
    for (const [key, value] of Object.entries(fields)) {
      const keySegs = keySegments(key);
      fields[key] = paths.filter(path => startsWith(path, keySegs))
        .reduce((current, path) => sealAt(current, path.slice(keySegs.length), seal), value);
    }
    result[operator] = fields;
  }
  if (update.$push) {
    const pushes = { ...update.$push };
    for (const [key, value] of Object.entries(pushes)) {
      const elementPrefix = [...keySegments(key), '[]'];
      const inner = paths.filter(path => startsWith(path, elementPrefix)).map(path => path.slice(elementPrefix.length));
      if (inner.length === 0) continue;
      const sealElement = element => inner.reduce((current, rest) => sealAt(current, rest, seal), element);
      pushes[key] = value && typeof value === 'object' && Array.isArray(value.$each)
        ? { ...value, $each: value.$each.map(sealElement) }
        : sealElement(value);
    }
    result.$push = pushes;
  }
  return result;
}

/**
 * The fields an update writes that are encrypted (to know whether it needs a key)
 * @param {string} name
 * @param {Object} update
 * @returns {boolean}
 */
function updateWritesContent(name, update) {
  if (!update || typeof update !== 'object') return false;
  const paths = pathsOf(name);
  const keys = [
    ...Object.keys(update.$set || {}), ...Object.keys(update.$setOnInsert || {}),
    ...Object.keys(update.$push || {}).map(key => `${key}.0`)
  ];
  return keys.some(key => {
    const keySegs = keySegments(key);
    return paths.some(path => startsWith(path, keySegs) || startsWith(keySegs, path));
  });
}

/** Every sealed string inside `value` (any depth), to fetch their keys */
function collectSealed(value, found = []) {
  if (typeof value === 'string') {
    if (aead.isSealed(value)) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach(item => collectSealed(item, found));
  } else if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date) && value._bsontype === undefined) {
    Object.values(value).forEach(item => collectSealed(item, found));
  }
  return found;
}

/** A copy of `value` with every sealed string replaced by `open(sealed)` */
function replaceSealed(value, open) {
  if (typeof value === 'string') return aead.isSealed(value) ? open(value) : value;
  if (Array.isArray(value)) return value.map(item => replaceSealed(item, open));
  if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date) && value._bsontype === undefined) {
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = replaceSealed(item, open);
    return copy;
  }
  return value;
}

/**
 * Opens every sealed value in a query result (documents, projections, aggregations)
 * @param {any} value
 * @param {(workspaceId: string, keyId: string) => Promise<Buffer|null>} getKey
 * @returns {Promise<any>}
 */
async function openValue(value, getKey) {
  const sealed = collectSealed(value);
  if (sealed.length === 0) return value;
  const keys = new Map();
  for (const item of sealed) {
    const header = aead.parseValue(item);
    if (!header) continue;
    const id = `${header.workspaceId}:${header.keyId}`;
    if (!keys.has(id)) {
      try {
        keys.set(id, await getKey(header.workspaceId, header.keyId));
      } catch (error) {
        console.error(`❌ Could not load encryption key ${header.keyId} of workspace ${header.workspaceId}:`, error.message);
        keys.set(id, null);
      }
    }
  }
  return replaceSealed(value, item => {
    const header = aead.parseValue(item);
    const key = header && keys.get(`${header.workspaceId}:${header.keyId}`);
    if (!key) return UNAVAILABLE;
    try {
      return aead.decryptPayload(key, header.workspaceId, header.payload);
    } catch {
      console.error(`❌ A value of workspace ${header.workspaceId} failed to decrypt`);
      return UNAVAILABLE;
    }
  });
}

/**
 * Query filter keys that point at encrypted fields (a filter can't match ciphertext)
 * @param {string} name
 * @param {Object} filter
 * @returns {string[]}
 */
function encryptedFilterKeys(name, filter) {
  const encrypted = new Set(pathsOf(name).map(path => path.filter(part => part !== '[]').join('.')));
  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$or' || key === '$and' || key === '$nor') {
        if (Array.isArray(value)) value.forEach(walk);
      } else if (!key.startsWith('$')) {
        const normalized = keySegments(key).filter(part => part !== '[]').join('.');
        if (encrypted.has(normalized)) found.push(key);
      }
    }
  };
  walk(filter);
  return found;
}

module.exports = {
  FIELD_PATHS, UNAVAILABLE, isEncryptedCollection, sealDocument, sealUpdate, updateWritesContent,
  openValue, encryptedFilterKeys
};
