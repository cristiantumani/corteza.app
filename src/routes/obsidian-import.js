const { getDecisionsCollection, getDatabase } = require('../config/database');
const { generateDecisionEmbedding, isEmbeddingsEnabled } = require('../services/embeddings');

/**
 * POST /api/v1/import/obsidian
 *
 * Imports notes from Obsidian, extracts decisions using AI, and saves them.
 * Requires API key authentication.
 *
 * Body:
 *   - text: The markdown content to process
 *   - fileName: Optional filename for reference
 *   - saveDirectly: If true, saves without review. If false, returns extracted decisions for confirmation.
 */
async function importFromObsidian(req, res) {
  console.log('📝 Obsidian import endpoint called');

  try {
    const { extractDecisionsFromTranscript, isClaudeConfigured } = require('../services/claude');

    // Check if Claude is configured
    if (!isClaudeConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'AI extraction not configured'
      });
    }

    // Get workspace info from API key auth (set by requireApiKey middleware)
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id;
    const userName = req.user?.name || 'Obsidian User';

    if (!workspaceId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key or missing workspace'
      });
    }

    const { text, fileName, saveDirectly = true } = req.body;

    // Validate required fields
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: text'
      });
    }

    console.log(`📝 Processing Obsidian import: ${fileName || 'untitled'} (${text.length} chars)`);

    // Extract decisions using Claude
    const result = await extractDecisionsFromTranscript(text, workspaceId);
    const extractedDecisions = result.decisions || [];

    if (extractedDecisions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No decisions found in the note',
        decisions: [],
        saved: 0
      });
    }

    console.log(`✅ Extracted ${extractedDecisions.length} decisions from Obsidian note`);

    // If not saving directly, return for confirmation
    if (!saveDirectly) {
      return res.status(200).json({
        success: true,
        message: `Found ${extractedDecisions.length} decisions`,
        decisions: extractedDecisions,
        saved: 0,
        requiresConfirmation: true
      });
    }

    // Save decisions directly
    const decisionsCollection = getDecisionsCollection();

    // Get next ID
    const lastDecision = await decisionsCollection
      .find({ workspace_id: workspaceId })
      .sort({ id: -1 })
      .limit(1)
      .toArray();

    let nextId = lastDecision.length > 0 ? lastDecision[0].id + 1 : 1;
    const savedDecisions = [];

    for (const decision of extractedDecisions) {
      // Generate embedding if configured
      let embedding = null;
      if (isEmbeddingsEnabled()) {
        try {
          embedding = await generateDecisionEmbedding(decision.text);
        } catch (err) {
          console.warn('⚠️ Failed to generate embedding:', err.message);
        }
      }

      const decisionDoc = {
        id: nextId,
        text: decision.text,
        type: decision.type || 'decision',
        category: decision.category || null,
        tags: decision.tags || [],
        epic_key: decision.epic_key || null,
        alternatives: decision.alternatives || null,
        user_id: userId,
        creator: userName,
        workspace_id: workspaceId,
        source: 'obsidian',
        source_file: fileName || null,
        timestamp: new Date().toISOString(),
        created_at: new Date(),
        embedding: embedding
      };

      await decisionsCollection.insertOne(decisionDoc);
      savedDecisions.push({
        id: nextId,
        text: decision.text,
        type: decision.type
      });

      console.log(`✅ Saved decision #${nextId} from Obsidian`);
      nextId++;
    }

    return res.status(200).json({
      success: true,
      message: `Imported ${savedDecisions.length} decisions from Obsidian`,
      decisions: savedDecisions,
      saved: savedDecisions.length
    });

  } catch (error) {
    console.error('❌ Obsidian import error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process import',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/import/obsidian/direct
 *
 * Saves a single decision directly without AI extraction.
 * Use when user has already identified what to save.
 */
async function saveDirectFromObsidian(req, res) {
  try {
    // Get workspace info from API key auth
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id;
    const userName = req.user?.name || 'Obsidian User';

    if (!workspaceId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key or missing workspace'
      });
    }

    const { text, type = 'decision', category, tags, epic_key, alternatives, fileName } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: text'
      });
    }

    // Validate type
    const validTypes = ['decision', 'explanation', 'context', 'learning', 'risk', 'assumption'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const decisionsCollection = getDecisionsCollection();

    // Get next ID
    const lastDecision = await decisionsCollection
      .find({ workspace_id: workspaceId })
      .sort({ id: -1 })
      .limit(1)
      .toArray();

    const nextId = lastDecision.length > 0 ? lastDecision[0].id + 1 : 1;

    // Generate embedding if configured
    let embedding = null;
    if (isEmbeddingsEnabled()) {
      try {
        embedding = await generateDecisionEmbedding(text);
      } catch (err) {
        console.warn('⚠️ Failed to generate embedding:', err.message);
      }
    }

    const decisionDoc = {
      id: nextId,
      text: text.trim(),
      type,
      category: category || null,
      tags: tags || [],
      epic_key: epic_key || null,
      alternatives: alternatives || null,
      user_id: userId,
      creator: userName,
      workspace_id: workspaceId,
      source: 'obsidian',
      source_file: fileName || null,
      timestamp: new Date().toISOString(),
      created_at: new Date(),
      embedding
    };

    await decisionsCollection.insertOne(decisionDoc);

    console.log(`✅ Direct save from Obsidian: decision #${nextId}`);

    return res.status(200).json({
      success: true,
      message: 'Decision saved successfully',
      decision: {
        id: nextId,
        text: text.trim(),
        type
      }
    });

  } catch (error) {
    console.error('❌ Direct save error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save decision',
      details: error.message
    });
  }
}

module.exports = {
  importFromObsidian,
  saveDirectFromObsidian
};
