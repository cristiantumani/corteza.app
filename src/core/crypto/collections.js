const aead = require('./aead');
const keys = require('./keys');
const fields = require('./fields');

/**
 * Transparent field encryption at the database boundary. `wrapDatabase(db)` returns a Db whose
 * `collection(name)` seals content fields on write and opens them on read for the collections in
 * fields.FIELD_PATHS; every other collection and method passes through untouched.
 *
 * - Reads always open sealed values (so encrypted and plain data can coexist during the rollout).
 * - Writes seal only when FIELD_ENCRYPTION=on.
 * - A query filter on an encrypted field can't match ciphertext: it throws when
 *   FIELD_ENCRYPTION_STRICT=true (tests, CI) and logs a warning otherwise.
 */

function strict() {
  return process.env.FIELD_ENCRYPTION_STRICT === 'true';
}

function checkFilter(name, filter, method) {
  const offending = fields.encryptedFilterKeys(name, filter);
  if (offending.length === 0) return;
  const message = `${name}.${method} filters on encrypted field(s) ${offending.join(', ')}; filter in memory instead`;
  if (strict()) throw new Error(message);
  console.warn(`⚠️  ${message}`);
}

/** The workspace an update targets: from the update, the filter, or (last resort) the document */
async function workspaceOf(raw, filter, update) {
  const candidates = [update?.$set?.workspace_id, update?.$setOnInsert?.workspace_id, filter?.workspace_id];
  const found = candidates.find(value => typeof value === 'string' && value);
  if (found) return found;
  const doc = await raw.findOne(filter, { projection: { workspace_id: 1 } });
  return doc && typeof doc.workspace_id === 'string' ? doc.workspace_id : null;
}

async function sealerFor(workspaceId) {
  const { keyId, key } = await keys.getActiveKey(workspaceId);
  return plain => aead.encryptValue(key, workspaceId, keyId, plain);
}

async function sealDoc(name, doc) {
  if (!keys.encryptionEnabled() || !doc || typeof doc !== 'object') return doc;
  if (typeof doc.workspace_id !== 'string' || !doc.workspace_id) {
    throw new Error(`Can't encrypt a ${name} document without workspace_id`);
  }
  return fields.sealDocument(name, doc, await sealerFor(doc.workspace_id));
}

async function sealUpdate(raw, name, filter, update) {
  if (!keys.encryptionEnabled() || Array.isArray(update) || !fields.updateWritesContent(name, update)) return update;
  const workspaceId = await workspaceOf(raw, filter, update);
  if (!workspaceId) {
    // An upsert that creates nothing, or a filter that matches nothing: nothing to protect
    if (!update.$setOnInsert) return update;
    throw new Error(`Can't encrypt a ${name} update without knowing its workspace`);
  }
  return fields.sealUpdate(name, update, await sealerFor(workspaceId));
}

function open(value) {
  return fields.openValue(value, keys.getKey);
}

/** A cursor whose results come back opened; chainable methods keep returning the wrapper */
function wrapCursor(cursor) {
  const proxy = new Proxy(cursor, {
    get(target, prop) {
      if (prop === 'toArray') return async () => Promise.all((await target.toArray()).map(open));
      if (prop === 'next') return async () => open(await target.next());
      if (prop === 'forEach') {
        return async fn => {
          for await (const doc of target) {
            if ((await fn(await open(doc))) === false) break;
          }
        };
      }
      if (prop === Symbol.asyncIterator) {
        return async function* iterate() {
          for await (const doc of target) yield await open(doc);
        };
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        return result === target ? proxy : result;
      };
    }
  });
  return proxy;
}

/**
 * @param {import('mongodb').Collection} raw
 * @param {string} name
 * @returns {import('mongodb').Collection}
 */
function wrapCollection(raw, name) {
  const methods = {
    async insertOne(doc, options) {
      const sealed = await sealDoc(name, doc);
      const result = await raw.insertOne(sealed, options);
      if (sealed !== doc && doc && doc._id === undefined) doc._id = sealed._id; // callers may read doc._id
      return result;
    },
    async insertMany(docs, options) {
      const sealed = await Promise.all(docs.map(doc => sealDoc(name, doc)));
      const result = await raw.insertMany(sealed, options);
      sealed.forEach((copy, index) => { if (copy !== docs[index] && docs[index]._id === undefined) docs[index]._id = copy._id; });
      return result;
    },
    async updateOne(filter, update, options) {
      checkFilter(name, filter, 'updateOne');
      return raw.updateOne(filter, await sealUpdate(raw, name, filter, update), options);
    },
    async updateMany(filter, update, options) {
      checkFilter(name, filter, 'updateMany');
      return raw.updateMany(filter, await sealUpdate(raw, name, filter, update), options);
    },
    async findOneAndUpdate(filter, update, options) {
      checkFilter(name, filter, 'findOneAndUpdate');
      return open(await raw.findOneAndUpdate(filter, await sealUpdate(raw, name, filter, update), options));
    },
    async replaceOne(filter, doc, options) {
      checkFilter(name, filter, 'replaceOne');
      return raw.replaceOne(filter, await sealDoc(name, doc), options);
    },
    find(filter, options) {
      checkFilter(name, filter, 'find');
      return wrapCursor(raw.find(filter, options));
    },
    async findOne(filter, options) {
      checkFilter(name, filter, 'findOne');
      return open(await raw.findOne(filter, options));
    },
    async findOneAndDelete(filter, options) {
      checkFilter(name, filter, 'findOneAndDelete');
      return open(await raw.findOneAndDelete(filter, options));
    },
    aggregate(pipeline, options) {
      const match = Array.isArray(pipeline) ? pipeline.find(stage => stage && stage.$match) : null;
      if (match) checkFilter(name, match.$match, 'aggregate');
      return wrapCursor(raw.aggregate(pipeline, options));
    },
    async countDocuments(filter, options) {
      checkFilter(name, filter, 'countDocuments');
      return raw.countDocuments(filter, options);
    },
    async deleteMany(filter, options) {
      checkFilter(name, filter, 'deleteMany');
      return raw.deleteMany(filter, options);
    },
    async deleteOne(filter, options) {
      checkFilter(name, filter, 'deleteOne');
      return raw.deleteOne(filter, options);
    }
  };
  return new Proxy(raw, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(methods, prop)) return methods[prop];
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

/**
 * @param {import('mongodb').Db} db
 * @returns {import('mongodb').Db}
 */
function wrapDatabase(db) {
  const wrapped = new Map();
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'collection') {
        return (name, options) => {
          const raw = target.collection(name, options);
          if (!fields.isEncryptedCollection(name)) return raw;
          if (!wrapped.has(name)) wrapped.set(name, wrapCollection(raw, name));
          return wrapped.get(name);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

module.exports = { wrapDatabase, wrapCollection };
