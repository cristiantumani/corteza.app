const { getDecisionsCollection } = require('../config/database');
const { validateQueryParams, validateDecisionId } = require('../middleware/validation');
const config = require('../config/environment');

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
 * Parses URL path to extract ID for delete endpoint
 */
function parsePathId(url) {
  const match = url.match(/\/api\/decisions\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * GET /api/decisions - Fetch decisions with filtering and pagination
 */
async function getDecisions(req, res) {
  try {
    const query = parseQueryParams(req.url);
    const validated = validateQueryParams(query);

    const { page, limit } = validated;
    const skip = (page - 1) * limit;

    // Build MongoDB filter
    const filter = {};

    // Workspace filter (required for multi-tenancy)
    if (validated.workspace_id) {
      filter.workspace_id = validated.workspace_id;
    }

    if (validated.type) {
      filter.type = validated.type;
    }
    if (validated.category) {
      filter.category = validated.category;
    }
    if (validated.epic) {
      filter.epic_key = { $regex: validated.epic, $options: 'i' };
    }
    if (validated.search) {
      filter.$or = [
        { text: { $regex: validated.search, $options: 'i' } },
        { tags: { $regex: validated.search, $options: 'i' } }
      ];
    }

    // Date range filtering
    if (validated.date_from || validated.date_to) {
      filter.timestamp = {};
      if (validated.date_from) {
        filter.timestamp.$gte = validated.date_from;
      }
      if (validated.date_to) {
        filter.timestamp.$lte = validated.date_to;
      }
    }

    const decisionsCollection = getDecisionsCollection();
    const [decisions, total] = await Promise.all([
      decisionsCollection
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      decisionsCollection.countDocuments(filter)
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      decisions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }));
  } catch (error) {
    console.error('Error fetching decisions:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch decisions' }));
  }
}

/**
 * PUT /api/decisions/:id - Update a decision by ID
 */
async function updateDecision(req, res) {
  try {
    const idString = parsePathId(req.url);
    const id = validateDecisionId(idString);

    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid decision ID' }));
      return;
    }

    // Read request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const updates = JSON.parse(body);

        // Validate and sanitize updates
        const allowedFields = ['text', 'type', 'category', 'epic_key', 'tags', 'alternatives'];
        const sanitizedUpdates = {};

        if (updates.text && typeof updates.text === 'string' && updates.text.trim().length > 0) {
          sanitizedUpdates.text = updates.text.trim();
        }

        if (updates.type && ['decision', 'explanation', 'context'].includes(updates.type)) {
          sanitizedUpdates.type = updates.type;
        }

        // Validate category field (product/ux/technical)
        if (updates.category !== undefined) {
          if (updates.category === null || updates.category === '') {
            sanitizedUpdates.category = null;
          } else if (['product', 'ux', 'technical'].includes(updates.category)) {
            sanitizedUpdates.category = updates.category;
          }
        }

        if (updates.epic_key !== undefined) {
          if (updates.epic_key === null || updates.epic_key === '') {
            sanitizedUpdates.epic_key = null;
            sanitizedUpdates.jira_data = null;
          } else if (typeof updates.epic_key === 'string' && /^[A-Z0-9-]+$/i.test(updates.epic_key.trim())) {
            sanitizedUpdates.epic_key = updates.epic_key.trim().toUpperCase();
            // TODO: Optionally fetch Jira data here
          }
        }

        if (updates.tags && Array.isArray(updates.tags)) {
          sanitizedUpdates.tags = updates.tags
            .filter(t => typeof t === 'string' && t.trim().length > 0)
            .map(t => t.trim().toLowerCase());
        }

        if (updates.alternatives !== undefined) {
          sanitizedUpdates.alternatives = updates.alternatives === null ? null : String(updates.alternatives).trim();
        }

        if (Object.keys(sanitizedUpdates).length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No valid fields to update' }));
          return;
        }

        // Add updated timestamp
        sanitizedUpdates.updated_at = new Date().toISOString();

        const decisionsCollection = getDecisionsCollection();

        // Build filter with optional workspace_id for security
        const updateFilter = { id: id };
        if (req.url.includes('workspace_id=')) {
          const urlParams = new URL(req.url, 'http://localhost').searchParams;
          const workspaceId = urlParams.get('workspace_id');
          if (workspaceId) {
            updateFilter.workspace_id = workspaceId;
          }
        }

        const result = await decisionsCollection.updateOne(
          updateFilter,
          { $set: sanitizedUpdates }
        );

        if (result.matchedCount === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Decision not found' }));
          return;
        }

        console.log(`✏️  Updated decision #${id}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, updated: id }));
      } catch (error) {
        console.error('Update parse error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
  } catch (error) {
    console.error('Update error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Update failed' }));
  }
}

/**
 * DELETE /api/decisions/:id - Delete a decision by ID
 */
async function deleteDecision(req, res) {
  try {
    const idString = parsePathId(req.url);
    const id = validateDecisionId(idString);

    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid decision ID' }));
      return;
    }

    const decisionsCollection = getDecisionsCollection();

    // Build filter with optional workspace_id for security
    const deleteFilter = { id: id };
    if (req.url.includes('workspace_id=')) {
      const urlParams = new URL(req.url, 'http://localhost').searchParams;
      const workspaceId = urlParams.get('workspace_id');
      if (workspaceId) {
        deleteFilter.workspace_id = workspaceId;
      }
    }

    const result = await decisionsCollection.deleteOne(deleteFilter);

    if (result.deletedCount === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Decision not found' }));
      return;
    }

    console.log(`🗑️  Deleted decision #${id}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, deleted: id }));
  } catch (error) {
    console.error('Delete error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Delete failed' }));
  }
}

/**
 * GET /api/stats - Get decision statistics
 */
async function getStats(req, res) {
  try {
    const query = parseQueryParams(req.url);
    const validated = validateQueryParams(query);

    const decisionsCollection = getDecisionsCollection();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Build base filter with optional workspace_id
    const baseFilter = validated.workspace_id ? { workspace_id: validated.workspace_id } : {};

    const [total, byType, byCategory, recentCount] = await Promise.all([
      decisionsCollection.countDocuments(baseFilter),
      decisionsCollection.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]).toArray(),
      decisionsCollection.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$category', count: { $sum: 1 } } }
      ]).toArray(),
      decisionsCollection.countDocuments({
        ...baseFilter,
        timestamp: { $gte: oneWeekAgo }
      })
    ]);

    const typeStats = byType.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const categoryStats = byCategory.reduce((acc, item) => {
      if (item._id) { // Skip null categories
        acc[item._id] = item.count;
      }
      return acc;
    }, {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total,
      byType: typeStats,
      byCategory: categoryStats,
      lastWeek: recentCount
    }));
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch stats' }));
  }
}

/**
 * GET /api/ai-analytics - Get AI feedback analytics
 * Returns comprehensive metrics on AI suggestion quality and user feedback
 */
async function getAIAnalytics(req, res) {
  try {
    const query = parseQueryParams(req.url);
    const validated = validateQueryParams(query);

    const { getAIFeedbackCollection, getAISuggestionsCollection } = require('../config/database');
    const feedbackCollection = getAIFeedbackCollection();
    const suggestionsCollection = getAISuggestionsCollection();

    // Build base filter with optional workspace_id
    const baseFilter = validated.workspace_id ? { workspace_id: validated.workspace_id } : {};

    // 1. Overall feedback stats
    const [totalSuggestions, totalFeedback, feedbackByAction] = await Promise.all([
      suggestionsCollection.countDocuments(baseFilter),
      feedbackCollection.countDocuments(baseFilter),
      feedbackCollection.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$action', count: { $sum: 1 } } }
      ]).toArray()
    ]);

    const feedbackStats = feedbackByAction.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, { approved: 0, rejected: 0, edited_approved: 0 });

    const totalReviewed = totalFeedback;
    const approvalRate = totalReviewed > 0
      ? ((feedbackStats.approved + feedbackStats.edited_approved) / totalReviewed * 100).toFixed(1)
      : 0;
    const rejectionRate = totalReviewed > 0
      ? (feedbackStats.rejected / totalReviewed * 100).toFixed(1)
      : 0;
    const editRate = totalReviewed > 0
      ? (feedbackStats.edited_approved / totalReviewed * 100).toFixed(1)
      : 0;

    // 2. Accuracy by confidence score ranges
    const confidenceRanges = await feedbackCollection.aggregate([
      { $match: baseFilter },
      {
        $bucket: {
          groupBy: '$original_suggestion.confidence',
          boundaries: [0, 0.5, 0.7, 0.9, 1.0, 2.0], // 2.0 catches edge cases
          default: 'unknown',
          output: {
            total: { $sum: 1 },
            approved: {
              $sum: {
                $cond: [{ $in: ['$action', ['approved', 'edited_approved']] }, 1, 0]
              }
            },
            rejected: {
              $sum: {
                $cond: [{ $eq: ['$action', 'rejected'] }, 1, 0]
              }
            }
          }
        }
      }
    ]).toArray();

    const confidenceStats = confidenceRanges.map(range => ({
      range: range._id === 'unknown' ? 'unknown' : `${range._id}-${range._id + 0.2}`,
      total: range.total,
      approved: range.approved,
      rejected: range.rejected,
      approvalRate: range.total > 0 ? (range.approved / range.total * 100).toFixed(1) : 0
    }));

    // 3. Top rejection reasons
    const rejectionReasons = await feedbackCollection.aggregate([
      {
        $match: {
          ...baseFilter,
          action: 'rejected',
          rejection_reason: { $ne: null, $ne: '' }
        }
      },
      { $group: { _id: '$rejection_reason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]).toArray();

    const topReasons = rejectionReasons.map(r => ({
      reason: r._id,
      count: r.count
    }));

    // 4. Accuracy by decision type
    const typeAccuracy = await feedbackCollection.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: '$original_suggestion.decision_type',
          total: { $sum: 1 },
          approved: {
            $sum: {
              $cond: [{ $in: ['$action', ['approved', 'edited_approved']] }, 1, 0]
            }
          }
        }
      }
    ]).toArray();

    const accuracyByType = typeAccuracy.map(t => ({
      type: t._id,
      total: t.total,
      approved: t.approved,
      approvalRate: t.total > 0 ? (t.approved / t.total * 100).toFixed(1) : 0
    }));

    // 5. Timeline (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const timeline = await feedbackCollection.aggregate([
      {
        $match: {
          ...baseFilter,
          created_at: { $gte: thirtyDaysAgo.toISOString() }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$created_at' } }
          },
          total: { $sum: 1 },
          approved: {
            $sum: {
              $cond: [{ $in: ['$action', ['approved', 'edited_approved']] }, 1, 0]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    const timelineData = timeline.map(t => ({
      date: t._id,
      total: t.total,
      approved: t.approved,
      approvalRate: t.total > 0 ? (t.approved / t.total * 100).toFixed(1) : 0
    }));

    // 6. Most common edits (what fields users edit most)
    const editedFields = await feedbackCollection.aggregate([
      {
        $match: {
          ...baseFilter,
          action: 'edited_approved',
          final_version: { $exists: true }
        }
      },
      {
        $project: {
          textChanged: {
            $ne: ['$original_suggestion.decision_text', '$final_version.decision_text']
          },
          typeChanged: {
            $ne: ['$original_suggestion.decision_type', '$final_version.decision_type']
          },
          tagsChanged: {
            $ne: ['$original_suggestion.tags', '$final_version.tags']
          }
        }
      },
      {
        $group: {
          _id: null,
          textEdits: { $sum: { $cond: ['$textChanged', 1, 0] } },
          typeEdits: { $sum: { $cond: ['$typeChanged', 1, 0] } },
          tagsEdits: { $sum: { $cond: ['$tagsChanged', 1, 0] } },
          total: { $sum: 1 }
        }
      }
    ]).toArray();

    const editPatterns = editedFields.length > 0 ? {
      textEdits: editedFields[0].textEdits,
      typeEdits: editedFields[0].typeEdits,
      tagsEdits: editedFields[0].tagsEdits,
      totalEdits: editedFields[0].total
    } : {
      textEdits: 0,
      typeEdits: 0,
      tagsEdits: 0,
      totalEdits: 0
    };

    // Return comprehensive analytics
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      overview: {
        totalSuggestions,
        totalReviewed,
        pendingReview: totalSuggestions - totalReviewed,
        approvalRate: parseFloat(approvalRate),
        rejectionRate: parseFloat(rejectionRate),
        editRate: parseFloat(editRate),
        feedbackStats
      },
      confidenceAccuracy: confidenceStats,
      topRejectionReasons: topReasons,
      accuracyByType,
      timeline: timelineData,
      editPatterns,
      workspace_id: validated.workspace_id || 'all',
      generatedAt: new Date().toISOString()
    }));

  } catch (error) {
    console.error('Error fetching AI analytics:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to fetch AI analytics',
      details: error.message
    }));
  }
}

/**
 * GET /health - Health check endpoint
 * Simple health check that always returns 200 OK for Railway
 * Does NOT depend on database connection
 */
function healthCheck(req, res) {
  // Always return 200 OK so Railway health checks pass
  // Even if database is down, the app itself is running
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString()
  }));
}

module.exports = {
  getDecisions,
  updateDecision,
  deleteDecision,
  getStats,
  getAIAnalytics,
  healthCheck
};
