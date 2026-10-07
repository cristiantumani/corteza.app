const express = require('express');
const multer = require('multer');
const { apiRateLimiter } = require('../middleware/auth');
const { isAdmin } = require('../services/permissions');
const { extractTextFromFile } = require('../utils/text-extractors');
const context = require('../core/context/context-service');
const config = require('../config/environment');
const { readDriveFile, PICKABLE_TYPES } = require('../integrations/google/drive-files');

/**
 * Context for the AI (Settings → Context for the AI). Logic in core/context.
 *
 *   GET    /api/ai-context                             { company, personal, can_edit_company, limits }
 *   PUT    /api/ai-context/company                     { description?, glossary? }   admins only
 *   POST   /api/ai-context/company/documents           multipart "file" (txt, md, csv, pdf, docx)   admins only
 *   POST   /api/ai-context/company/documents/drive     { file_id, access_token }   admins only (Google Picker)
 *   POST   /api/ai-context/company/documents/:docId/refresh   { access_token }   admins only (Update from Drive)
 *   DELETE /api/ai-context/company/documents/:docId    admins only
 *   PUT    /api/ai-context/me                          { role?, focus?, glossary? }
 *
 * Every member can read the company context (their captures use it); document text is
 * returned as a short preview only.
 */
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (['txt', 'md', 'csv', 'pdf', 'docx'].includes(extension)) return cb(null, true);
    cb(new Error('Upload a TXT, MD, CSV, PDF or DOCX file.'));
  }
});

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

async function requireAdmin(req, res, next) {
  const { workspace_id, user_id } = req.session.user;
  if (!await isAdmin(null, workspace_id, user_id)) {
    return res.status(403).json({ success: false, error: 'Only a workspace admin can edit the company context' });
  }
  next();
}

/** Company context for the browser: document text as a preview */
function publicCompany(company) {
  return {
    description: company.description,
    glossary: company.glossary,
    documents: company.documents.map(doc => ({
      doc_id: doc.doc_id,
      name: doc.name,
      chars: doc.chars,
      truncated: !!doc.truncated,
      preview: (doc.text || '').slice(0, 300),
      uploaded_by: doc.uploaded_by?.name || null,
      uploaded_at: doc.uploaded_at,
      from_drive: doc.source?.type === 'google_drive'
    })),
    updated_at: company.updated_at,
    updated_by: company.updated_by?.name || null
  };
}

/** What the page needs to open the Google Picker; only for admins, only when configured */
function driveConfig(admin) {
  const { picker, clientId } = config.google;
  if (!admin || !picker.isConfigured) return null;
  return { client_id: clientId, api_key: picker.apiKey, app_id: picker.appId, mime_types: PICKABLE_TYPES };
}

function editorOf(req) {
  return { user_id: req.session.user.user_id, name: req.session.user.user_name || req.session.user.email || null };
}

router.get('/api/ai-context', apiRateLimiter, requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const [company, personal, admin] = await Promise.all([
      context.getCompanyContext(workspace_id),
      context.getPersonalContext(workspace_id, user_id),
      isAdmin(null, workspace_id, user_id)
    ]);
    res.json({ success: true, company: publicCompany(company), personal, can_edit_company: admin, limits: context.LIMITS, drive: driveConfig(admin) });
  } catch (error) {
    console.error('❌ Failed to load AI context:', error);
    res.status(500).json({ success: false, error: 'Failed to load the context' });
  }
});

router.put('/api/ai-context/company', apiRateLimiter, express.json({ limit: '100kb' }), requireSession, requireAdmin, async (req, res) => {
  try {
    const { description, glossary } = req.body || {};
    const saved = await context.saveCompanyContext(req.session.user.workspace_id, { description, glossary }, editorOf(req));
    console.log(`🧭 Company context updated in ${req.session.user.workspace_id} by ${req.session.user.user_id}`);
    res.json({ success: true, company: publicCompany(saved) });
  } catch (error) {
    console.error('❌ Failed to save company context:', error);
    res.status(500).json({ success: false, error: 'Failed to save the context' });
  }
});

router.post('/api/ai-context/company/documents', apiRateLimiter, requireSession, requireAdmin, (req, res) => {
  upload.single('file')(req, res, async uploadError => {
    if (uploadError) return res.status(400).json({ success: false, error: uploadError.message });
    if (!req.file) return res.status(400).json({ success: false, error: 'Choose a file to upload' });
    try {
      const extracted = await extractTextFromFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      if (!extracted.success) return res.status(400).json({ success: false, error: extracted.error || 'Could not read the file' });
      const result = await context.addCompanyDocument(req.session.user.workspace_id, { name: req.file.originalname, text: extracted.text }, editorOf(req));
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      const company = await context.getCompanyContext(req.session.user.workspace_id);
      res.json({ success: true, company: publicCompany(company) });
    } catch (error) {
      console.error('❌ Failed to add context document:', error);
      res.status(500).json({ success: false, error: 'Failed to add the document' });
    }
  });
});

router.post('/api/ai-context/company/documents/drive', apiRateLimiter, express.json({ limit: '10kb' }), requireSession, requireAdmin, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const { file_id: fileId, access_token: accessToken } = req.body || {};
    const file = await readDriveFile(fileId, accessToken);
    if ('error' in file) return res.status(file.status).json({ success: false, error: file.error, code: file.code });
    const result = await context.addCompanyDocument(workspace_id, file, editorOf(req));
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    console.log(`🧭 Drive document added in ${workspace_id} by ${user_id} (${file.source.mime_type}, ${result.document.chars} chars)`);
    const company = await context.getCompanyContext(workspace_id);
    res.json({ success: true, company: publicCompany(company), doc_id: result.document.doc_id });
  } catch (error) {
    console.error('❌ Failed to add a Drive document:', error.message);
    res.status(500).json({ success: false, error: 'Failed to add the document' });
  }
});

router.post('/api/ai-context/company/documents/:docId/refresh', apiRateLimiter, express.json({ limit: '10kb' }), requireSession, requireAdmin, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const company = await context.getCompanyContext(workspace_id);
    const existing = company.documents.find(doc => doc.doc_id === req.params.docId);
    if (!existing) return res.status(404).json({ success: false, error: 'Document not found' });
    if (existing.source?.type !== 'google_drive') return res.status(400).json({ success: false, error: 'This document didn’t come from Google Drive' });
    const file = await readDriveFile(existing.source.file_id, (req.body || {}).access_token);
    if ('error' in file) return res.status(file.status).json({ success: false, error: file.error, code: file.code });
    const result = await context.replaceCompanyDocument(workspace_id, existing.doc_id, file, editorOf(req));
    if (result.notFound) return res.status(404).json({ success: false, error: 'Document not found' });
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    console.log(`🧭 Drive document refreshed in ${workspace_id} by ${user_id} (${file.source.mime_type}, ${result.document.chars} chars)`);
    res.json({ success: true, company: publicCompany(await context.getCompanyContext(workspace_id)) });
  } catch (error) {
    console.error('❌ Failed to refresh a Drive document:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update the document' });
  }
});

router.delete('/api/ai-context/company/documents/:docId', apiRateLimiter, requireSession, requireAdmin, async (req, res) => {
  try {
    const removed = await context.removeCompanyDocument(req.session.user.workspace_id, req.params.docId);
    if (!removed) return res.status(404).json({ success: false, error: 'Document not found' });
    const company = await context.getCompanyContext(req.session.user.workspace_id);
    res.json({ success: true, company: publicCompany(company) });
  } catch (error) {
    console.error('❌ Failed to remove context document:', error);
    res.status(500).json({ success: false, error: 'Failed to remove the document' });
  }
});

router.put('/api/ai-context/me', apiRateLimiter, express.json({ limit: '50kb' }), requireSession, async (req, res) => {
  try {
    const { workspace_id, user_id } = req.session.user;
    const { role, focus, glossary } = req.body || {};
    const personal = await context.savePersonalContext(workspace_id, user_id, { role, focus, glossary });
    res.json({ success: true, personal });
  } catch (error) {
    console.error('❌ Failed to save personal context:', error);
    res.status(500).json({ success: false, error: 'Failed to save your context' });
  }
});

module.exports = router;
