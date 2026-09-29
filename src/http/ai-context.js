const express = require('express');
const multer = require('multer');
const { apiRateLimiter } = require('../middleware/auth');
const { isAdmin } = require('../services/permissions');
const { extractTextFromFile } = require('../utils/text-extractors');
const context = require('../core/context/context-service');

/**
 * Context for the AI (Settings → Context for the AI). Logic in core/context.
 *
 *   GET    /api/ai-context                             { company, personal, can_edit_company, limits }
 *   PUT    /api/ai-context/company                     { description?, glossary? }   admins only
 *   POST   /api/ai-context/company/documents           multipart "file" (txt, md, csv, pdf, docx)   admins only
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
      uploaded_at: doc.uploaded_at
    })),
    updated_at: company.updated_at,
    updated_by: company.updated_by?.name || null
  };
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
    res.json({ success: true, company: publicCompany(company), personal, can_edit_company: admin, limits: context.LIMITS });
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
