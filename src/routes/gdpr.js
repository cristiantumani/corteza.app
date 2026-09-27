const { getDecisionsCollection, getDatabase } = require('../config/database');
const { validateQueryParams } = require('../middleware/validation');

/**
 * Parses URL query parameters
 */
function parseQueryParams(url) {
  const params = {};
  const urlParts = url.split('?');
  if (urlParts.length > 1) {
    urlParts[1].split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }
  return params;
}

/**
 * GET /api/gdpr/export - Export all workspace data
 * Supports formats: json, csv
 */
async function exportWorkspaceData(req, res) {
  try {
    const query = parseQueryParams(req.url);
    const validated = validateQueryParams(query);

    if (!validated.workspace_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'workspace_id is required' }));
      return;
    }

    const workspace_id = validated.workspace_id;
    const format = query.format || 'json'; // Default to JSON

    const db = getDatabase();
    const decisionsCollection = db.collection('decisions');
    const aiSuggestionsCollection = db.collection('ai_suggestions');
    const meetingTranscriptsCollection = db.collection('meeting_transcripts');
    const aiFeedbackCollection = db.collection('ai_feedback');

    // Fetch all data for this workspace
    const [decisions, aiSuggestions, transcripts, feedback] = await Promise.all([
      decisionsCollection.find({ workspace_id }).toArray(),
      aiSuggestionsCollection.find({ workspace_id }).toArray(),
      meetingTranscriptsCollection.find({ workspace_id }).toArray(),
      aiFeedbackCollection.find({ workspace_id }).toArray()
    ]);

    const exportData = {
      workspace_id,
      export_date: new Date().toISOString(),
      total_decisions: decisions.length,
      total_ai_suggestions: aiSuggestions.length,
      total_transcripts: transcripts.length,
      total_feedback: feedback.length,
      data: {
        decisions,
        ai_suggestions: aiSuggestions,
        meeting_transcripts: transcripts,
        ai_feedback: feedback
      }
    };

    // Log the export for audit trail
    console.log(`📦 Data export requested for workspace: ${workspace_id} (format: ${format})`);

    if (format === 'csv') {
      // CSV format - export decisions as CSV (most important data)
      const csvHeader = ['ID', 'Decision', 'Type', 'Epic Key', 'Tags', 'Creator', 'Date', 'Comments'];
      const csvRows = decisions.map(d => [
        d.id,
        `"${(d.text || '').replace(/"/g, '""')}"`, // Escape quotes
        d.type,
        d.epic_key || '',
        (d.tags || []).join(';'),
        d.creator,
        d.timestamp,
        `"${(d.alternatives || '').replace(/"/g, '""')}"`
      ]);

      const csv = [
        csvHeader.join(','),
        ...csvRows.map(row => row.join(','))
      ].join('\n');

      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="workspace_${workspace_id}_export_${Date.now()}.csv"`
      });
      res.end(csv);
    } else {
      // JSON format - export everything
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="workspace_${workspace_id}_export_${Date.now()}.json"`
      });
      res.end(JSON.stringify(exportData, null, 2));
    }

    console.log(`✅ Data export completed for workspace: ${workspace_id}`);
  } catch (error) {
    console.error('❌ Error exporting workspace data:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to export data' }));
  }
}

/**
 * DELETE /api/gdpr/delete-all - Delete all workspace data
 * DANGEROUS: This permanently deletes all data for a workspace
 */
async function deleteAllWorkspaceData(req, res) {
  try {
    const query = parseQueryParams(req.url);
    const validated = validateQueryParams(query);

    if (!validated.workspace_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'workspace_id is required' }));
      return;
    }

    const workspace_id = validated.workspace_id;

    // Require confirmation parameter
    if (query.confirm !== 'DELETE_ALL_DATA') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Confirmation required',
        message: 'Add query parameter: confirm=DELETE_ALL_DATA'
      }));
      return;
    }

    console.log(`🗑️  GDPR deletion requested for workspace: ${workspace_id}`);

    const db = getDatabase();
    const decisionsCollection = db.collection('decisions');
    const aiSuggestionsCollection = db.collection('ai_suggestions');
    const meetingTranscriptsCollection = db.collection('meeting_transcripts');
    const aiFeedbackCollection = db.collection('ai_feedback');
    const installationsCollection = db.collection('slack_installations');

    // Delete all data for this workspace
    const [
      decisionsResult,
      suggestionsResult,
      transcriptsResult,
      feedbackResult,
      installationResult
    ] = await Promise.all([
      decisionsCollection.deleteMany({ workspace_id }),
      aiSuggestionsCollection.deleteMany({ workspace_id }),
      meetingTranscriptsCollection.deleteMany({ workspace_id }),
      aiFeedbackCollection.deleteMany({ workspace_id }),
      installationsCollection.deleteMany({ team_id: workspace_id })
    ]);

    const deletionSummary = {
      workspace_id,
      deletion_date: new Date().toISOString(),
      deleted: {
        decisions: decisionsResult.deletedCount,
        ai_suggestions: suggestionsResult.deletedCount,
        meeting_transcripts: transcriptsResult.deletedCount,
        ai_feedback: feedbackResult.deletedCount,
        installation: installationResult.deletedCount > 0 ? 'yes' : 'no'
      },
      total_records_deleted:
        decisionsResult.deletedCount +
        suggestionsResult.deletedCount +
        transcriptsResult.deletedCount +
        feedbackResult.deletedCount +
        installationResult.deletedCount
    };

    console.log(`✅ GDPR deletion completed for workspace: ${workspace_id}`);
    console.log(`   - Decisions: ${decisionsResult.deletedCount}`);
    console.log(`   - AI Suggestions: ${suggestionsResult.deletedCount}`);
    console.log(`   - Transcripts: ${transcriptsResult.deletedCount}`);
    console.log(`   - Feedback: ${feedbackResult.deletedCount}`);
    console.log(`   - Installation: ${installationResult.deletedCount}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'All workspace data has been permanently deleted',
      summary: deletionSummary
    }));
  } catch (error) {
    console.error('❌ Error deleting workspace data:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to delete data' }));
  }
}

/**
 * GET /api/gdpr/info - Get GDPR information about workspace data
 * Shows what data we have for a workspace without exporting it
 */
async function getWorkspaceDataInfo(req, res) {
  try {
    const query = parseQueryParams(req.url);
    const validated = validateQueryParams(query);

    if (!validated.workspace_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'workspace_id is required' }));
      return;
    }

    const workspace_id = validated.workspace_id;

    const db = getDatabase();
    const decisionsCollection = db.collection('decisions');
    const aiSuggestionsCollection = db.collection('ai_suggestions');
    const meetingTranscriptsCollection = db.collection('meeting_transcripts');
    const aiFeedbackCollection = db.collection('ai_feedback');
    const installationsCollection = db.collection('slack_installations');

    // Count records for this workspace
    const [
      decisionsCount,
      suggestionsCount,
      transcriptsCount,
      feedbackCount,
      installation
    ] = await Promise.all([
      decisionsCollection.countDocuments({ workspace_id }),
      aiSuggestionsCollection.countDocuments({ workspace_id }),
      meetingTranscriptsCollection.countDocuments({ workspace_id }),
      aiFeedbackCollection.countDocuments({ workspace_id }),
      installationsCollection.findOne({ team_id: workspace_id })
    ]);

    const info = {
      workspace_id,
      installed: !!installation,
      installed_at: installation?.installed_at || null,
      data_summary: {
        decisions: decisionsCount,
        ai_suggestions: suggestionsCount,
        meeting_transcripts: transcriptsCount,
        ai_feedback: feedbackCount
      },
      total_records: decisionsCount + suggestionsCount + transcriptsCount + feedbackCount,
      gdpr_rights: {
        export: 'You can export all your data in JSON or CSV format',
        delete: 'You can request deletion of all your workspace data',
        access: 'You can view all your data via the dashboard'
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
  } catch (error) {
    console.error('❌ Error getting workspace data info:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to get data info' }));
  }
}

module.exports = {
  exportWorkspaceData,
  deleteAllWorkspaceData,
  getWorkspaceDataInfo
};
