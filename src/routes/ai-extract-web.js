const express = require('express');
const crypto = require('crypto');
const {
  getAISuggestionsCollection,
  getMeetingTranscriptsCollection,
  getDecisionsCollection
} = require('../config/database');
const { extractDecisionsFromTranscript, isClaudeConfigured } = require('../services/claude');
const { extractTextFromFile } = require('../utils/text-extractors');
const {
  validateUploadedFile,
  validateTranscriptContent
} = require('../middleware/ai-validation');
const { generateDecisionEmbedding, isEmbeddingsEnabled } = require('../services/embeddings');
const multer = require('multer');

const router = express.Router();

// Configure multer for file uploads (5MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload TXT, PDF, or DOCX files.'));
    }
  }
});

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
 * - file: file upload (txt, pdf, docx)
 * - workspace_id: string
 * - space_id: string
 * - file_name: string (optional, defaults to "Meeting Notes")
 */
router.post('/api/ai/extract-from-text', upload.single('file'), async (req, res) => {
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

    const { workspace_id, space_id, text, file_name } = req.body;
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
    } else if (text) {
      transcriptContent = text;
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
      error: `Failed to process transcript: ${error.message}`
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
    const existingTranscript = await transcriptsCollection.findOne({
      workspace_id: metadata.workspace_id,
      content_hash: contentHash,
      processed_at: { $ne: null }
    });

    if (existingTranscript) {
      console.log(`♻️  CREDIT SAVED: Duplicate transcript detected`);

      // Return existing suggestions
      const existingSuggestions = await suggestionsCollection.find({
        workspace_id: metadata.workspace_id,
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
    const transcriptId = `transcript_${Date.now()}`;
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
      uploaded_via: 'web',
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
      metadata.workspace_id
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
      suggestion_id: `ai_sugg_${Date.now()}_${index}`,
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
      error: `Processing failed: ${error.message}`
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
router.post('/api/ai/approve-suggestion', async (req, res) => {
  try {
    const { suggestion_id, workspace_id, space_id, edits } = req.body;

    // Verify authentication
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;
    const userName = req.session.user.user_name;

    // Fetch suggestion
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({
      workspace_id,
      suggestion_id
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

    // Get transcript for context
    const transcriptsCollection = getMeetingTranscriptsCollection();
    const transcript = await transcriptsCollection.findOne({
      workspace_id,
      transcript_id: suggestion.meeting_transcript_id
    });
    const meetingTitle = transcript ? transcript.file_name : 'Unknown meeting';

    // Apply edits if provided
    const finalDecision = edits || {
      decision_text: suggestion.decision_text,
      decision_type: suggestion.decision_type,
      epic_key: suggestion.epic_key,
      tags: suggestion.tags,
      alternatives: ''
    };

    // Create decision
    const decisionsCollection = getDecisionsCollection();
    const lastDecision = await decisionsCollection.findOne(
      { workspace_id, space_id },
      { sort: { id: -1 } }
    );
    const nextId = lastDecision ? lastDecision.id + 1 : 1;

    // Build alternatives text
    let alternativesText = `This decision was extracted from "${meetingTitle}"\n\n`;
    if (suggestion.context) {
      alternativesText += `Context: ${suggestion.context}\n\n`;
    }
    if (finalDecision.alternatives) {
      alternativesText += `${finalDecision.alternatives}\n\n`;
    }
    alternativesText += `AI-extracted${edits ? ' and edited' : ''} via web app`;

    const decision = {
      workspace_id,
      space_id,
      space_name: req.body.space_name || null,
      id: nextId,
      text: finalDecision.decision_text,
      type: finalDecision.decision_type,
      epic_key: finalDecision.epic_key,
      jira_data: null,
      tags: finalDecision.tags,
      alternatives: alternativesText,
      creator: userName,
      user_id: userId,
      timestamp: new Date().toISOString()
    };

    await decisionsCollection.insertOne(decision);

    // Generate embedding (non-blocking)
    if (isEmbeddingsEnabled()) {
      generateDecisionEmbedding(decision)
        .then(embedding => {
          return decisionsCollection.updateOne(
            { _id: decision._id },
            { $set: { embedding } }
          );
        })
        .catch(err => console.error('Embedding generation failed:', err));
    }

    // Update suggestion status
    await suggestionsCollection.updateOne(
      { workspace_id, suggestion_id },
      {
        $set: {
          status: edits ? 'edited_approved' : 'approved',
          reviewed_at: new Date().toISOString(),
          reviewer_id: userId,
          edits: edits || null,
          final_decision_id: nextId
        }
      }
    );

    console.log(`✅ Suggestion ${suggestion_id} approved as decision #${nextId}`);

    res.json({
      success: true,
      decision_id: nextId,
      message: `Decision #${nextId} saved successfully`
    });

  } catch (error) {
    console.error('❌ Error approving suggestion:', error);
    res.status(500).json({
      success: false,
      error: `Failed to approve suggestion: ${error.message}`
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
router.post('/api/ai/reject-suggestion', async (req, res) => {
  try {
    const { suggestion_id, workspace_id, reason } = req.body;

    // Verify authentication
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const userId = req.session.user.user_id;

    // Fetch suggestion
    const suggestionsCollection = getAISuggestionsCollection();
    const suggestion = await suggestionsCollection.findOne({
      workspace_id,
      suggestion_id
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
      { workspace_id, suggestion_id },
      {
        $set: {
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewer_id: userId,
          rejection_reason: reason || null
        }
      }
    );

    console.log(`✅ Suggestion ${suggestion_id} rejected`);

    res.json({
      success: true,
      message: 'Suggestion rejected'
    });

  } catch (error) {
    console.error('❌ Error rejecting suggestion:', error);
    res.status(500).json({
      success: false,
      error: `Failed to reject suggestion: ${error.message}`
    });
  }
});

module.exports = router;
