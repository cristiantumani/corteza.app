const express = require('express');
const crypto = require('crypto');
const {
  getAISuggestionsCollection,
  getMeetingTranscriptsCollection,
  getWorkspaceSpacesCollection
} = require('../config/database');
const { createDecision } = require('../core/decisions/decision-service');
const { DECISION_TYPES } = require('../core/decisions/types');
const { extractDecisionsFromTranscript, isClaudeConfigured } = require('../services/claude');
const { extractTextFromFile } = require('../utils/text-extractors');
const {
  validateUploadedFile,
  validateTranscriptContent
} = require('../middleware/ai-validation');
const { canAccessSpace, canCreateInSpace } = require('../services/permissions');
const multer = require('multer');
const { track } = require('../integrations/posthog/client');
const { rejectOperatorKeys } = require('../middleware/input-safety');

const router = express.Router();

// Configure multer for file uploads (5MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/plain',
      'text/markdown',
      'text/vtt',
      'application/x-subrip',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    // Browsers report inconsistent MIME types for .md/.vtt/.srt, so also allow by extension
    const allowedExtensions = ['txt', 'md', 'vtt', 'srt', 'pdf', 'docx'];
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(extension)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload TXT, MD, VTT, SRT, PDF, or DOCX files.'));
    }
  }
});

/**
 * Privacy: suggestions from an uploaded transcript belong to whoever uploaded it. Only they
 * can list, approve or reject them, and only into spaces they can post to. Ids and names from
 * the request must be plain strings, so a JSON object ({"$ne": ""}) can't become a query.
 */

/** A non-empty string from the request (trimmed, capped), or null */
function text(value, max = 200) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/** Random id: suggestion and transcript ids must not be guessable */
function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

/** The space's name for a decision (from the database, never from the request) */
async function spaceNameOf(workspaceId, spaceId) {
  const space = await getWorkspaceSpacesCollection().findOne({ workspace_id: workspaceId, space_id: spaceId }, { projection: { name: 1 } });
  return space ? space.name : null;
}

/**
 * Edits the reviewer made to a suggestion, validated; null when there are none
 * @param {*} edits - { decision_text, decision_type, epic_key, tags, alternatives } from the request
 * @returns {Object|null}
 */
function cleanEdits(edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return null;
  const epicKey = text(edits.epic_key, 50);
  return {
    decision_text: text(edits.decision_text, 5000),
    decision_type: DECISION_TYPES.includes(edits.decision_type) ? edits.decision_type : null,
    epic_key: epicKey && /^[A-Z0-9-]+$/i.test(epicKey) ? epicKey.toUpperCase() : null,
    tags: Array.isArray(edits.tags) ? edits.tags.map(tag => text(tag, 50)).filter(Boolean).slice(0, 20) : null,
    alternatives: text(edits.alternatives, 5000)
  };
}

/**
 * Generate hash for transcript content (duplicate detection)
 */
function hashTranscriptContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * POST /api/ai/extract-from-text
 * Extract decisions from meeting notes (text or file upload)
 *
 * Body (form-data):
 * - text: string (meeting notes text) OR
 * - file: file upload (txt, md, vtt, srt, pdf, docx)
 * - workspace_id: string
 * - space_id: string
 * - file_name: string (optional, defaults to "Meeting Notes")
 */
router.post('/api/ai/extract-from-text', upload.single('file'), rejectOperatorKeys, async (req, res) => {
  try {
    console.log('📝 AI extraction request received');

    // Check if Claude is configured
    if (!isClaudeConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'AI extraction is not configured. Please contact support.'
      });
    }

    // Verify user is authenticated
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const body = req.body || {};
    const workspace_id = text(body.workspace_id);
    const space_id = text(body.space_id);
    const pastedText = typeof body.text === 'string' ? body.text : '';
    const file_name = text(body.file_name);
    const user_id = req.session.user.user_id;
    const user_name = req.session.user.user_name;

    // Validate required fields
    if (!workspace_id || !space_id) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id and space_id are required'
      });
    }

    // Verify user belongs to this workspace
    if (req.session.user.workspace_id !== workspace_id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this workspace'
      });
    }

    // Suggestions are saved to this space later: the uploader must be able to post there
    if (!await canCreateInSpace(null, workspace_id, space_id, user_id)) {
      return res.status(403).json({ success: false, error: 'You cannot add decisions to this space' });
    }

    let transcriptContent = '';
    let fileName = file_name || 'Meeting Notes';

    // Extract content from either text or file upload
    if (req.file) {
      console.log('📎 File upload detected:', req.file.originalname);
      fileName = req.file.originalname;

      // Extract text from file
      const extraction = await extractTextFromFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      if (!extraction.success) {
        return res.status(400).json({
          success: false,
          error: extraction.error
        });
      }

      transcriptContent = extraction.text;
    } else if (pastedText.trim()) {
      transcriptContent = pastedText;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either text or file must be provided'
      });
    }

    // Validate content
    const contentValidation = validateTranscriptContent(transcriptContent);
    if (!contentValidation.valid) {
      return res.status(400).json({
        success: false,
        error: contentValidation.error
      });
    }

    console.log(`📄 Processing transcript: "${fileName}" (${transcriptContent.length} chars)`);

    // Process the transcript
    const result = await processTranscriptWeb(transcriptContent, {
      workspace_id,
      space_id,
      file_name: fileName,
      file_type: req.file ? req.file.mimetype : 'text/plain',
      file_size: transcriptContent.length,
      user_id,
      user_name
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    track('ai_transcript_extracted', {
      input_type: req.file ? 'file' : 'text',
      suggestion_count: result.suggestions.length,
      cached: Boolean(result.cached)
    });

    // Return suggestions for user review
    res.json({
      success: true,
      suggestions: result.suggestions,
      transcript_id: result.transcript_id,
      cached: result.cached || false,
      message: result.suggestions.length > 0
        ? `Found ${result.suggestions.length} potential decision${result.suggestions.length > 1 ? 's' : ''}`
        : 'No clear decisions found in this transcript'
    });

  } catch (error) {
    console.error('❌ Error in AI extraction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process the transcript. Try again.'
    });
  }
});

/**
 * Process transcript for web requests
 * Similar to Slack version but adapted for web context
 */
async function processTranscriptWeb(transcriptContent, metadata) {
  try {
    const transcriptsCollection = getMeetingTranscriptsCollection();
    const suggestionsCollection = getAISuggestionsCollection();

    // Check for duplicate transcript by content hash
    const contentHash = hashTranscriptContent(transcriptContent);
    // Only the same person's earlier upload counts: never hand back a colleague's suggestions
    const existingTranscript = await transcriptsCollection.findOne({
      workspace_id: metadata.workspace_id,
      uploaded_by: metadata.user_id,
      content_hash: contentHash,
      processed_at: { $ne: null }
    });

    if (existingTranscript) {
      console.log(`♻️  CREDIT SAVED: Duplicate transcript detected`);

      // Return existing suggestions
      const existingSuggestions = await suggestionsCollection.find({
        workspace_id: metadata.workspace_id,
        user_id: metadata.user_id,
        space_id: metadata.space_id,
        meeting_transcript_id: existingTranscript.transcript_id,
        status: 'pending'
      }).toArray();

      if (existingSuggestions.length > 0) {
        console.log(`♻️  Reusing ${existingSuggestions.length} existing suggestions`);
        return {
          success: true,
          suggestions: existingSuggestions,
          transcript_id: existingTranscript.transcript_id,
          cached: true
        };
      }
    }

    // Save transcript to database
    const transcriptId = randomId('transcript');
    const wordCount = transcriptContent.split(/\s+/).filter(w => w.length > 0).length;

    const transcript = {
      workspace_id: metadata.workspace_id,
      transcript_id: transcriptId,
      file_name: metadata.file_name,
      file_type: metadata.file_type,
      file_size: metadata.file_size,
      content: transcriptContent,
      content_hash: contentHash,
      content_preview: transcriptContent.substring(0, 500),
      word_count: wordCount,
      uploaded_by: metadata.user_id,
      uploaded_by_name: metadata.user_name,
      uploaded_via: metadata.uploaded_via || 'web',
      uploaded_at: new Date().toISOString(),
      processed_at: null,
      ai_model: null,
      decisions_found: 0,
      processing_time_ms: 0
    };

    const insertResult = await transcriptsCollection.insertOne(transcript);
    console.log(`✅ Saved transcript: ${transcriptId}`);

    // Call Claude API to extract decisions
    const aiResult = await extractDecisionsFromTranscript(
      transcriptContent,
      metadata.workspace_id,
      { userId: metadata.user_id || null } // their own review feedback and personal context
    );

    // Update transcript with processing results
    await transcriptsCollection.updateOne(
      { _id: insertResult.insertedId },
      {
        $set: {
          processed_at: new Date().toISOString(),
          ai_model: aiResult.model,
          decisions_found: aiResult.decisions.length,
          processing_time_ms: aiResult.processingTime
        }
      }
    );

    if (aiResult.decisions.length === 0) {
      return {
        success: true,
        suggestions: [],
        transcript_id: transcriptId
      };
    }

    // Save suggestions to database
    const suggestions = aiResult.decisions.map((decision, index) => ({
      workspace_id: metadata.workspace_id,
      space_id: metadata.space_id,  // Include space_id for web context
      suggestion_id: randomId(`ai_sugg_${index}`),
      meeting_transcript_id: transcriptId,
      status: 'pending',
      decision_text: decision.decision_text,
      decision_type: decision.decision_type,
      epic_key: decision.epic_key || null,
      tags: decision.tags || [],
      confidence_score: decision.confidence,
      context: decision.context || '',
      created_at: new Date().toISOString(),
      user_id: metadata.user_id,
      reviewed_at: null,
      reviewer_id: null,
      edits: null,
      final_decision_id: null
    }));

    await suggestionsCollection.insertMany(suggestions);
    console.log(`✅ Saved ${suggestions.length} AI suggestions`);

    return {
      success: true,
      suggestions,
      transcript_id: transcriptId
    };
  } catch (error) {
    console.error('❌ Error processing transcript:', error);
    return {
      success: false,
      suggestions: [],
      error: 'Processing failed. Try again.'
    };
  }
}

/**
 * POST /api/ai/approve-suggestion
 * Approve a single AI suggestion and save as decision
 *
 * Body:
 * - suggestion_id: string
 * - workspace_id: string
 * - space_id: string
 * - edits: object (optional) - { decision_text, decision_type, epic_key, tags, alternatives }
 */
router.post('/api/ai/approve-suggestion', express.json(), async (req, res) => {
  try {
    // Verify authentication
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const body = req.body || {};
    const suggestionId = text(body.suggestion_id);
    const workspace_id = text(body.workspace_id);
    if (!suggestionId) {
      return res.status(400).json({ success: false, error: 'suggestion_id is required' });
    }

    // Only allow acting on suggestions in the user's own workspace
    if (workspace_id !== req.session.user.workspace_id) {
      return res.status(403).json({ success: false, error: 'Access denied to this workspace' });
    }

    const userId = req.session.user.user_id;
    const userName = req.session.user.user_name;

    // Only the uploader's own suggestions (not found and not yours look the same)
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({
      workspace_id,
      suggestion_id: suggestionId,
      user_id: userId
    });

    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Suggestion not found' });
    }

    if (suggestion.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'This suggestion has already been processed'
      });
    }

    // Saved to the space picked on the review screen, or the one it was uploaded to
    const spaceId = text(body.space_id) || suggestion.space_id;
    if (!spaceId || !await canCreateInSpace(null, workspace_id, spaceId, userId)) {
      return res.status(403).json({ success: false, error: 'You cannot add decisions to this space' });
    }

    // Get transcript for context
    const transcript = await getMeetingTranscriptsCollection().findOne(
      { workspace_id, transcript_id: suggestion.meeting_transcript_id },
      { projection: { file_name: 1 } }
    );
    const meetingTitle = transcript ? transcript.file_name : 'Unknown meeting';

    // Apply edits if provided (each field falls back to what the AI suggested)
    const edits = cleanEdits(body.edits);
    const finalDecision = {
      decision_text: (edits && edits.decision_text) || suggestion.decision_text,
      decision_type: (edits && edits.decision_type) || suggestion.decision_type,
      epic_key: edits ? edits.epic_key : suggestion.epic_key,
      tags: (edits && edits.tags) || suggestion.tags || [],
      alternatives: edits ? edits.alternatives : null
    };

    // Build alternatives text
    let alternativesText = `This decision was extracted from "${meetingTitle}"\n\n`;
    if (suggestion.context) {
      alternativesText += `Context: ${suggestion.context}\n\n`;
    }
    if (finalDecision.alternatives) {
      alternativesText += `${finalDecision.alternatives}\n\n`;
    }
    alternativesText += `AI-extracted${edits ? ' and edited' : ''} via web app`;

    // Single write path: atomic decision number, embedding for search
    const decision = await createDecision({
      workspaceId: workspace_id,
      spaceId,
      spaceName: await spaceNameOf(workspace_id, spaceId),
      text: finalDecision.decision_text,
      type: finalDecision.decision_type,
      tags: finalDecision.tags,
      epicKey: finalDecision.epic_key,
      alternatives: alternativesText,
      author: { user_id: userId, name: userName },
      source: { type: 'upload', title: meetingTitle },
      capture: 'ai',
      confidence: typeof suggestion.confidence_score === 'number' ? suggestion.confidence_score : null,
      reviewedBy: userId // approved on the review screen: nothing left to review
    });

    // Update suggestion status
    await suggestionsCollection.updateOne(
      { _id: suggestion._id },
      {
        $set: {
          status: edits ? 'edited_approved' : 'approved',
          reviewed_at: new Date().toISOString(),
          reviewer_id: userId,
          edits,
          final_decision_id: decision.id
        }
      }
    );

    console.log(`✅ Suggestion ${suggestionId} approved as decision #${decision.id}`);

    track('ai_suggestion_approved', {
      edited: Boolean(edits),
      decision_type: decision.type,
      has_epic: Boolean(decision.epic_key),
      tag_count: decision.tags.length
    });

    res.json({
      success: true,
      decision_id: decision.id,
      message: `Decision #${decision.id} saved successfully`
    });

  } catch (error) {
    console.error('❌ Error approving suggestion:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve the suggestion. Try again.'
    });
  }
});

/**
 * POST /api/ai/reject-suggestion
 * Reject an AI suggestion
 *
 * Body:
 * - suggestion_id: string
 * - workspace_id: string
 * - reason: string (optional)
 */
router.post('/api/ai/reject-suggestion', express.json(), async (req, res) => {
  try {
    // Verify authentication
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const body = req.body || {};
    const suggestionId = text(body.suggestion_id);
    const workspace_id = text(body.workspace_id);
    const reason = text(body.reason, 500);
    if (!suggestionId) {
      return res.status(400).json({ success: false, error: 'suggestion_id is required' });
    }

    // Only allow acting on suggestions in the user's own workspace
    if (workspace_id !== req.session.user.workspace_id) {
      return res.status(403).json({ success: false, error: 'Access denied to this workspace' });
    }

    const userId = req.session.user.user_id;

    // Only the uploader's own suggestions
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({
      workspace_id,
      suggestion_id: suggestionId,
      user_id: userId
    });

    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Suggestion not found' });
    }

    if (suggestion.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'This suggestion has already been processed'
      });
    }

    // Update suggestion status
    await suggestionsCollection.updateOne(
      { _id: suggestion._id },
      {
        $set: {
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewer_id: userId,
          rejection_reason: reason
        }
      }
    );

    console.log(`✅ Suggestion ${suggestionId} rejected`);

    track('ai_suggestion_rejected', { provided_reason: Boolean(reason) });

    res.json({
      success: true,
      message: 'Suggestion rejected'
    });

  } catch (error) {
    console.error('❌ Error rejecting suggestion:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject the suggestion. Try again.'
    });
  }
});

/**
 * GET /api/ai/pending-suggestions
 * List your AI suggestions still awaiting review in a space (e.g. from a transcript
 * you uploaded and closed the review before finishing)
 *
 * Query:
 * - workspace_id: string
 * - space_id: string
 */
router.get('/api/ai/pending-suggestions', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const workspace_id = text(req.query.workspace_id);
    const space_id = text(req.query.space_id);

    if (!workspace_id || !space_id) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id and space_id are required'
      });
    }

    if (workspace_id !== req.session.user.workspace_id) {
      return res.status(403).json({ success: false, error: 'Access denied to this workspace' });
    }

    const canAccess = await canAccessSpace(null, workspace_id, space_id, req.session.user.user_id);
    if (!canAccess) {
      return res.status(403).json({ success: false, error: 'Access denied to this space' });
    }

    const suggestions = await getAISuggestionsCollection()
      .find({ workspace_id, space_id, user_id: req.session.user.user_id, status: 'pending' }) // only your uploads
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();

    res.json({ success: true, suggestions });
  } catch (error) {
    console.error('❌ Error fetching pending suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pending suggestions'
    });
  }
});

module.exports = router;
