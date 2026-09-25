const { getWorkspaceSpacesCollection } = require('../config/database');
const { isClaudeConfigured } = require('../services/claude');
const { canCreateInSpace } = require('../services/permissions');
const { validateTranscriptContent } = require('../middleware/ai-validation');
const { processTranscriptWeb } = require('./ai-extract-web');

/**
 * POST /api/v1/extract
 *
 * Extracts decisions from a transcript and queues them as pending AI suggestions
 * for review in the dashboard. Intended for automations such as
 * Google Drive → n8n → Corteza. Requires API key authentication.
 *
 * Body:
 *   - text: The transcript or meeting notes (required)
 *   - fileName: Optional filename for reference
 *   - space_id: Optional target space (defaults to the workspace's default space)
 *   - source: Optional label for where the transcript came from (e.g. "google-drive")
 */
async function extractFromApi(req, res) {
  try {
    if (!isClaudeConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'AI extraction not configured'
      });
    }

    // Get workspace info from API key auth (set by requireApiKey middleware)
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id;
    const userName = req.user?.name || 'API User';

    if (!workspaceId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key or missing workspace'
      });
    }

    const { text, fileName, space_id, source } = req.body || {};

    const contentValidation = validateTranscriptContent(text);
    if (!contentValidation.valid) {
      return res.status(400).json({
        success: false,
        error: contentValidation.error
      });
    }

    // Resolve target space: explicit space_id, otherwise the workspace default space
    let spaceId = space_id;
    if (!spaceId) {
      const defaultSpace = await getWorkspaceSpacesCollection().findOne({
        workspace_id: workspaceId,
        is_default: true,
        archived: false
      });
      spaceId = defaultSpace?.space_id;
    }

    if (!spaceId) {
      return res.status(400).json({
        success: false,
        error: 'No space_id provided and the workspace has no default space'
      });
    }

    const canCreate = await canCreateInSpace(null, workspaceId, spaceId, userId);
    if (!canCreate) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to create decisions in this space'
      });
    }

    console.log(`📝 API extraction: ${fileName || 'untitled'} (${text.length} chars) → space ${spaceId}`);

    const result = await processTranscriptWeb(text, {
      workspace_id: workspaceId,
      space_id: spaceId,
      file_name: fileName || 'Transcript',
      file_type: 'text/plain',
      file_size: text.length,
      user_id: userId,
      user_name: userName,
      uploaded_via: typeof source === 'string' && source ? source.slice(0, 50) : 'api'
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    const suggestions = result.suggestions.map(s => ({
      suggestion_id: s.suggestion_id,
      decision_text: s.decision_text,
      decision_type: s.decision_type,
      confidence_score: s.confidence_score,
      tags: s.tags,
      context: s.context
    }));

    res.status(200).json({
      success: true,
      count: suggestions.length,
      suggestions,
      transcript_id: result.transcript_id,
      space_id: spaceId,
      fileName: fileName || 'Transcript',
      cached: result.cached || false,
      message: suggestions.length > 0
        ? `Queued ${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''} for review in the dashboard`
        : 'No decisions found in transcript'
    });
  } catch (error) {
    console.error('❌ Error in API extraction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extract decisions'
    });
  }
}

module.exports = {
  extractFromApi
};
