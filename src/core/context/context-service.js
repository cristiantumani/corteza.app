const crypto = require('crypto');
const { getDatabase } = require('../../config/database');

/**
 * Context the AI uses when it reads a meeting, so it knows what matters to the business,
 * how names and acronyms are spelled, and who is who.
 *
 * Two levels, one collection (`ai_context`, unique on workspace_id + user_id):
 *   - company (user_id: null): description, glossary and reference documents.
 *     Admins edit it; every member's captures use it.
 *   - personal (user_id: <member>): role, focus and a personal glossary.
 *     Each person edits their own; only their captures use it.
 *
 * Document text is stored (not the file) and everything is capped so the context
 * stays a small, cacheable part of the extraction prompt.
 */

const LIMITS = {
  description: 4000,
  glossary: 8000,
  role: 300,
  focus: 1500,
  documentName: 120,
  documentText: 20000, // one document
  documentsText: 40000, // all documents together
  documents: 5
};

function collection() {
  return getDatabase().collection('ai_context');
}

function clean(value, max) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

/**
 * The company context of a workspace (empty fields when nothing is saved)
 * @param {string} workspaceId
 * @returns {Promise<{ description: string, glossary: string, documents: Object[], updated_at: Date|null, updated_by: Object|null }>}
 */
async function getCompanyContext(workspaceId) {
  const doc = await collection().findOne({ workspace_id: workspaceId, user_id: null });
  return {
    description: doc?.description || '',
    glossary: doc?.glossary || '',
    documents: doc?.documents || [],
    updated_at: doc?.updated_at || null,
    updated_by: doc?.updated_by || null
  };
}

/**
 * Saves the company description and glossary (callers check the person is an admin)
 * @param {string} workspaceId
 * @param {{ description?: string, glossary?: string }} fields
 * @param {{ user_id: string, name: string }} editor
 * @returns {Promise<Object>} the saved context
 */
async function saveCompanyContext(workspaceId, { description, glossary }, editor) {
  const set = { updated_at: new Date(), updated_by: { user_id: editor.user_id, name: editor.name || null } };
  if (description !== undefined) set.description = clean(description, LIMITS.description);
  if (glossary !== undefined) set.glossary = clean(glossary, LIMITS.glossary);
  await collection().updateOne(
    { workspace_id: workspaceId, user_id: null },
    { $set: set, $setOnInsert: { documents: [], created_at: new Date() } },
    { upsert: true }
  );
  return getCompanyContext(workspaceId);
}

/**
 * Adds a reference document's text to the company context
 * @param {string} workspaceId
 * @param {{ name: string, text: string, source?: Object }} document - source: where it came from
 *   ({ type: 'google_drive', file_id, mime_type, modified_time }); none for an upload
 * @param {{ user_id: string, name: string }} editor
 * @returns {Promise<{ document?: Object, error?: string }>}
 */
async function addCompanyDocument(workspaceId, { name, text, source }, editor) {
  const body = clean(text, LIMITS.documentText);
  if (!body) return { error: 'The document has no readable text' };
  const current = await getCompanyContext(workspaceId);
  if (current.documents.length >= LIMITS.documents) return { error: `Up to ${LIMITS.documents} documents. Remove one first.` };
  const used = current.documents.reduce((sum, doc) => sum + (doc.text || '').length, 0);
  if (used + body.length > LIMITS.documentsText) {
    return { error: `Documents can add up to ${LIMITS.documentsText.toLocaleString('en-US')} characters. Remove one or upload a shorter file.` };
  }
  const document = {
    doc_id: `ctxdoc_${crypto.randomBytes(8).toString('hex')}`,
    name: clean(name, LIMITS.documentName) || 'Document',
    text: body,
    chars: body.length,
    truncated: typeof text === 'string' && text.trim().length > LIMITS.documentText,
    uploaded_by: { user_id: editor.user_id, name: editor.name || null },
    uploaded_at: new Date()
  };
  if (source) document.source = source;
  await collection().updateOne(
    { workspace_id: workspaceId, user_id: null },
    {
      $push: { documents: document },
      $set: { updated_at: new Date(), updated_by: document.uploaded_by },
      $setOnInsert: { description: '', glossary: '', created_at: new Date() }
    },
    { upsert: true }
  );
  return { document };
}

/**
 * Replaces a document's text in place (Update from Drive), with the same limits as adding one
 * @param {string} workspaceId
 * @param {string} docId
 * @param {{ name: string, text: string, source?: Object }} document
 * @param {{ user_id: string, name: string }} editor
 * @returns {Promise<{ document?: Object, error?: string, notFound?: boolean }>}
 */
async function replaceCompanyDocument(workspaceId, docId, { name, text, source }, editor) {
  const body = clean(text, LIMITS.documentText);
  if (!body) return { error: 'The document has no readable text' };
  const current = await getCompanyContext(workspaceId);
  const existing = current.documents.find(doc => doc.doc_id === docId);
  if (!existing) return { notFound: true };
  const others = current.documents.reduce((sum, doc) => sum + (doc.doc_id === docId ? 0 : (doc.text || '').length), 0);
  if (others + body.length > LIMITS.documentsText) {
    return { error: `Documents can add up to ${LIMITS.documentsText.toLocaleString('en-US')} characters. Remove one or use a shorter file.` };
  }
  const document = {
    ...existing,
    name: clean(name, LIMITS.documentName) || existing.name,
    text: body,
    chars: body.length,
    truncated: typeof text === 'string' && text.trim().length > LIMITS.documentText,
    uploaded_by: { user_id: editor.user_id, name: editor.name || null },
    uploaded_at: new Date()
  };
  if (source) document.source = source;
  const documents = current.documents.map(doc => (doc.doc_id === docId ? document : doc));
  await collection().updateOne(
    { workspace_id: workspaceId, user_id: null },
    { $set: { documents, updated_at: new Date(), updated_by: document.uploaded_by } }
  );
  return { document };
}

/**
 * Removes a reference document
 * @returns {Promise<boolean>} whether it existed
 */
async function removeCompanyDocument(workspaceId, docId) {
  const result = await collection().updateOne(
    { workspace_id: workspaceId, user_id: null },
    { $pull: { documents: { doc_id: docId } }, $set: { updated_at: new Date() } }
  );
  return result.modifiedCount > 0;
}

/**
 * A person's own context
 * @returns {Promise<{ role: string, focus: string, glossary: string, updated_at: Date|null }>}
 */
async function getPersonalContext(workspaceId, userId) {
  const doc = await collection().findOne({ workspace_id: workspaceId, user_id: userId });
  return { role: doc?.role || '', focus: doc?.focus || '', glossary: doc?.glossary || '', updated_at: doc?.updated_at || null };
}

/**
 * Saves a person's own context
 * @param {string} workspaceId
 * @param {string} userId
 * @param {{ role?: string, focus?: string, glossary?: string }} fields
 * @returns {Promise<Object>} the saved context
 */
async function savePersonalContext(workspaceId, userId, { role, focus, glossary }) {
  const set = { updated_at: new Date() };
  if (role !== undefined) set.role = clean(role, LIMITS.role);
  if (focus !== undefined) set.focus = clean(focus, LIMITS.focus);
  if (glossary !== undefined) set.glossary = clean(glossary, LIMITS.glossary);
  await collection().updateOne(
    { workspace_id: workspaceId, user_id: userId },
    { $set: set, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  );
  return getPersonalContext(workspaceId, userId);
}

/** Context is user-written: keep it from opening or closing the prompt's tags */
function escapeTags(text) {
  return String(text).replace(/</g, '‹').replace(/>/g, '›');
}

function attribute(text) {
  return escapeTags(text).replace(/"/g, "'");
}

/**
 * The context as prompt text (XML-tagged), or '' when there is none
 * @param {{ company?: Object, personal?: Object, personName?: string|null }} context
 * @returns {string}
 */
function formatContextBlock({ company = {}, personal = {}, personName = null } = {}) {
  const parts = [];
  const section = (tag, text) => (text && text.trim() ? `<${tag}>\n${escapeTags(text.trim())}\n</${tag}>` : null);

  const companyParts = [
    section('description', company.description),
    section('glossary', company.glossary),
    ...(company.documents || [])
      .filter(doc => doc.text && doc.text.trim())
      .map(doc => `<document name="${attribute(doc.name)}">\n${escapeTags(doc.text.trim())}\n</document>`)
  ].filter(Boolean);
  if (companyParts.length) parts.push(`<company_context>\n${companyParts.join('\n')}\n</company_context>`);

  const personalParts = [
    section('role', personal.role),
    section('focus', personal.focus),
    section('glossary', personal.glossary)
  ].filter(Boolean);
  if (personalParts.length) {
    const who = personName ? ` of="${attribute(personName)}"` : '';
    parts.push(`<capturer_context${who}>\n${personalParts.join('\n')}\n</capturer_context>`);
  }
  return parts.join('\n\n');
}

/**
 * Prompt text with the company context and the capturing person's own context
 * @param {string} workspaceId
 * @param {string|null} userId - whose meeting it is
 * @param {string|null} [personName]
 * @returns {Promise<string>}
 */
async function buildContextBlock(workspaceId, userId, personName = null) {
  if (!workspaceId) return '';
  const [company, personal] = await Promise.all([
    getCompanyContext(workspaceId),
    userId ? getPersonalContext(workspaceId, userId) : Promise.resolve({})
  ]);
  return formatContextBlock({ company, personal, personName });
}

module.exports = {
  LIMITS,
  getCompanyContext,
  saveCompanyContext,
  addCompanyDocument,
  replaceCompanyDocument,
  removeCompanyDocument,
  getPersonalContext,
  savePersonalContext,
  formatContextBlock,
  buildContextBlock
};
