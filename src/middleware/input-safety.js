/**
 * Request input safety.
 *
 * MongoDB treats object keys that start with "$" as operators, so a JSON body like
 * {"suggestion_id": {"$ne": ""}} turns a lookup into "any suggestion". Every JSON body is
 * parsed once, globally (src/index.js), and rejected when it carries such keys anywhere,
 * so no route has to remember to check. Multipart forms (multer) get the same check after
 * the upload middleware.
 *
 * Routes should still check types ("is this a string?"): this is the safety net.
 */

/** Keys never accepted in request bodies: Mongo operators and prototype pollution */
function isForbiddenKey(key) {
  return key.startsWith('$') || key === '__proto__';
}

/**
 * Path of the first forbidden key in a parsed body, or null
 * @param {*} value
 * @param {string} [path]
 * @param {number} [depth]
 * @returns {string|null} e.g. "suggestion_id.$ne"
 */
function findForbiddenKey(value, path = '', depth = 0) {
  if (!value || typeof value !== 'object') return null;
  if (depth > 20) return path || '(too deep)';
  for (const key of Object.keys(value)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (isForbiddenKey(key)) return keyPath;
    const nested = findForbiddenKey(value[key], keyPath, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * Express middleware: 400 when the body (or query) has a key like "$ne" or "__proto__"
 */
function rejectOperatorKeys(req, res, next) {
  const found = findForbiddenKey(req.body) || findForbiddenKey(req.query);
  if (found) {
    console.warn(`🛡️  Rejected request with forbidden key "${found}" on ${req.method} ${req.path}`);
    return res.status(400).json({ success: false, error: 'Invalid request' });
  }
  next();
}

/**
 * Express error handler: a malformed JSON body is a 400 with a JSON answer, not an HTML page
 */
function jsonBodyErrors(error, req, res, next) {
  if (error && (error.type === 'entity.parse.failed' || error.type === 'entity.too.large')) {
    const tooLarge = error.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({ success: false, error: tooLarge ? 'Request too large' : 'Invalid JSON' });
  }
  next(error);
}

/**
 * The parsed JSON body (the global parser already read it); a plain object, or throws
 * @param {import('express').Request} req
 * @returns {Object}
 */
function jsonBody(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
  return body;
}

module.exports = { findForbiddenKey, rejectOperatorKeys, jsonBodyErrors, jsonBody };
