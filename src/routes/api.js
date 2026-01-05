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
 * Helper: Get user productivity metrics
 * @param {string} workspace_id - Workspace ID
 * @returns {Object} Productivity metrics including totals, timeline, and breakdowns
 */
async function getUserProductivityMetrics(workspace_id) {
  const decisionsCollection = getDecisionsCollection();
  const { getMeetingTranscriptsCollection } = require('../config/database');
  const transcriptsCollection = getMeetingTranscriptsCollection();

  const baseFilter = workspace_id ? { workspace_id } : {};
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Get totals and breakdowns
  const [total, byType, byCategory, totalThisMonth, aiExtracted, totalMeetings] = await Promise.all([
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
      timestamp: { $gte: thirtyDaysAgo.toISOString() }
    }),

    // AI-extracted decisions have the pattern in alternatives field
    decisionsCollection.countDocuments({
      ...baseFilter,
      alternatives: { $regex: /This decision was taken during/i }
    }),

    transcriptsCollection.countDocuments(baseFilter)
  ]);

  const manualEntries = total - aiExtracted;
  const averagePerMeeting = totalMeetings > 0 ? (aiExtracted / totalMeetings) : 0;

  // Format type stats
  const typeStats = byType.reduce((acc, item) => {
    if (item._id) acc[item._id] = item.count;
    return acc;
  }, { decision: 0, explanation: 0, context: 0 });

  // Format category stats
  const categoryStats = byCategory.reduce((acc, item) => {
    if (item._id) acc[item._id] = item.count;
    return acc;
  }, { product: 0, ux: 0, technical: 0 });

  // Weekly timeline for last 90 days
  const weeklyTimeline = await decisionsCollection.aggregate([
    {
      $match: {
        ...baseFilter,
        timestamp: { $gte: ninetyDaysAgo.toISOString() }
      }
    },
    {
      $group: {
        _id: {
          week: {
            $dateToString: {
              format: '%Y-W%U',
              date: { $toDate: '$timestamp' }
            }
          },
          type: '$type'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.week',
        total: { $sum: '$count' },
        byType: {
          $push: {
            type: '$_id.type',
            count: '$count'
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  // Format weekly timeline for frontend
  const formattedTimeline = weeklyTimeline.map(w => {
    const byTypeObj = w.byType.reduce((acc, item) => {
      acc[item.type] = item.count;
      return acc;
    }, {});

    return {
      week: w._id,
      total: w.total,
      decisions: byTypeObj.decision || 0,
      explanations: byTypeObj.explanation || 0,
      context: byTypeObj.context || 0
    };
  });

  return {
    total,
    totalThisMonth,
    totalMeetings,
    manualEntries,
    aiExtracted,
    averagePerMeeting: Math.round(averagePerMeeting * 10) / 10,
    byType: typeStats,
    byCategory: categoryStats,
    weeklyTimeline: formattedTimeline
  };
}

/**
 * Helper: Get meeting insights
 * @param {string} workspace_id - Workspace ID
 * @returns {Object} Meeting productivity metrics
 */
async function getMeetingInsights(workspace_id) {
  const decisionsCollection = getDecisionsCollection();
  const { getMeetingTranscriptsCollection } = require('../config/database');
  const transcriptsCollection = getMeetingTranscriptsCollection();

  const baseFilter = workspace_id ? { workspace_id } : {};

  // Top 5 most productive meetings
  const topMeetings = await transcriptsCollection.aggregate([
    { $match: baseFilter },
    { $sort: { decisions_found: -1 } },
    { $limit: 5 },
    {
      $project: {
        fileName: '$file_name',
        uploadedAt: '$uploaded_at',
        uploadedBy: '$uploaded_by_name',
        itemsCaptured: '$decisions_found',
        transcriptId: '$transcript_id',
        wordCount: '$word_count'
      }
    }
  ]).toArray();

  // Bottom 5 least productive meetings (but > 0)
  const leastProductiveMeetings = await transcriptsCollection.aggregate([
    {
      $match: {
        ...baseFilter,
        decisions_found: { $gt: 0 }
      }
    },
    { $sort: { decisions_found: 1 } },
    { $limit: 5 },
    {
      $project: {
        fileName: '$file_name',
        uploadedAt: '$uploaded_at',
        uploadedBy: '$uploaded_by_name',
        itemsCaptured: '$decisions_found',
        transcriptId: '$transcript_id',
        wordCount: '$word_count'
      }
    }
  ]).toArray();

  // Channel activity breakdown
  const channelActivity = await decisionsCollection.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: '$channel_id',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]).toArray();

  return {
    topMeetings,
    bottomMeetings: leastProductiveMeetings,
    channelActivity: channelActivity.map(c => ({
      channelId: c._id,
      channelName: c._id, // Could be enriched with actual channel names from Slack API
      count: c.count
    }))
  };
}

/**
 * Helper: Get team engagement metrics
 * @param {string} workspace_id - Workspace ID
 * @returns {Object} Engagement metrics including contributors and patterns
 */
async function getEngagementMetrics(workspace_id) {
  const decisionsCollection = getDecisionsCollection();
  const { getAIFeedbackCollection } = require('../config/database');
  const feedbackCollection = getAIFeedbackCollection();

  const baseFilter = workspace_id ? { workspace_id } : {};

  // Count manual entries by creator
  const manualContributors = await decisionsCollection.aggregate([
    {
      $match: {
        ...baseFilter,
        alternatives: { $not: { $regex: /This decision was taken during/i } }
      }
    },
    {
      $group: {
        _id: { userId: '$user_id', userName: '$creator' },
        manualEntries: { $sum: 1 }
      }
    }
  ]).toArray();

  // Count AI reviews by user_id
  const aiReviewers = await feedbackCollection.aggregate([
    {
      $match: {
        ...baseFilter,
        action: { $in: ['approved', 'edited_approved'] }
      }
    },
    {
      $group: {
        _id: '$user_id',
        aiReviews: { $sum: 1 }
      }
    }
  ]).toArray();

  // Combine manual and AI contributions
  const contributorMap = new Map();

  manualContributors.forEach(c => {
    contributorMap.set(c._id.userId, {
      userName: c._id.userName,
      userId: c._id.userId,
      manualEntries: c.manualEntries,
      aiReviews: 0
    });
  });

  aiReviewers.forEach(r => {
    const existing = contributorMap.get(r._id);
    if (existing) {
      existing.aiReviews = r.aiReviews;
    } else {
      contributorMap.set(r._id, {
        userId: r._id,
        userName: 'User',
        manualEntries: 0,
        aiReviews: r.aiReviews
      });
    }
  });

  const topContributors = Array.from(contributorMap.values())
    .map(c => ({
      ...c,
      totalContributions: c.manualEntries + c.aiReviews
    }))
    .sort((a, b) => b.totalContributions - a.totalContributions)
    .slice(0, 10);

  // Bot usage stats
  const totalManual = manualContributors.reduce((sum, c) => sum + c.manualEntries, 0);

  // Get total AI-extracted decisions
  const totalAIExtracted = await decisionsCollection.countDocuments({
    ...baseFilter,
    alternatives: { $regex: /This decision was taken during/i }
  });

  return {
    topContributors,
    botUsage: {
      manual: totalManual,
      aiExtracted: totalAIExtracted
    }
  };
}

/**
 * Helper: Get content analysis
 * @param {string} workspace_id - Workspace ID
 * @returns {Object} Content metrics including tags, epics, and patterns
 */
async function getContentAnalysis(workspace_id) {
  const decisionsCollection = getDecisionsCollection();
  const baseFilter = workspace_id ? { workspace_id } : {};

  // Top 20 tags (unwind array and count)
  const topTags = await decisionsCollection.aggregate([
    { $match: baseFilter },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 }
  ]).toArray();

  // Top 10 epics
  const topEpics = await decisionsCollection.aggregate([
    {
      $match: {
        ...baseFilter,
        epic_key: { $ne: null, $ne: '' }
      }
    },
    { $group: { _id: '$epic_key', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]).toArray();

  // Day-of-week activity
  const dayOfWeekActivity = await decisionsCollection.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: {
          $dayOfWeek: { $toDate: '$timestamp' }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  return {
    topTags: topTags.map(t => ({
      tag: t._id,
      count: t.count
    })),
    topEpics: topEpics.map(e => ({
      epic: e._id,
      count: e.count
    })),
    dayOfWeekActivity: dayOfWeekActivity.map(d => ({
      day: d._id, // 1-7 where 1=Sunday
      count: d.count
    }))
  };
}

/**
 * GET /api/ai-analytics - Get AI feedback analytics
 * Returns comprehensive metrics on AI suggestion quality and user feedback
 */
async function getAIAnalytics(req, res) {
  try {
    const query = parseQueryParams(req.url);
    const validated = validateQueryParams(query);
    const view = query.view || 'all'; // 'user', 'ai', or 'all'

    const result = {};

    // User-centric metrics
    if (view === 'user' || view === 'all') {
      const [productivity, meetings, engagement, content] = await Promise.all([
        getUserProductivityMetrics(validated.workspace_id),
        getMeetingInsights(validated.workspace_id),
        getEngagementMetrics(validated.workspace_id),
        getContentAnalysis(validated.workspace_id)
      ]);

      result.productivity = productivity;
      result.meetings = meetings;
      result.engagement = engagement;
      result.contentAnalysis = content;
    }

    // AI model metrics (existing analytics)
    if (view === 'ai' || view === 'all') {
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

      // Store AI model metrics in result
      result.aiModel = {
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
        editPatterns
      };
    }

    // Add metadata
    result.workspace_id = validated.workspace_id || 'all';
    result.generatedAt = new Date().toISOString();

    // Return comprehensive analytics
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));

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

/**
 * POST /api/feedback - Submit user feedback to n8n webhook
 * Proxies feedback from frontend to n8n to avoid CORS issues
 */
async function submitFeedback(req, res) {
  console.log('📝 Feedback endpoint called');
  try {
    const feedbackData = req.body;
    console.log('📝 Feedback data:', feedbackData);

    // Validate required fields
    if (!feedbackData.type || !feedbackData.feedback) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Missing required fields: type and feedback'
      }));
      return;
    }

    // Forward to n8n webhook (server-to-server, no CORS)
    const n8nWebhookUrl = 'https://cristiantumani.app.n8n.cloud/webhook/feedback';

    const https = require('https');
    const url = require('url');

    const webhookUrl = url.parse(n8nWebhookUrl);
    const postData = JSON.stringify(feedbackData);

    const options = {
      hostname: webhookUrl.hostname,
      port: 443,
      path: webhookUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const webhookReq = https.request(options, (webhookRes) => {
      let responseData = '';

      webhookRes.on('data', (chunk) => {
        responseData += chunk;
      });

      webhookRes.on('end', () => {
        // Forward n8n response to frontend
        res.writeHead(webhookRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: webhookRes.statusCode === 200,
          message: 'Feedback submitted successfully'
        }));
      });
    });

    webhookReq.on('error', (error) => {
      console.error('Error forwarding to n8n:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Failed to submit feedback to webhook'
      }));
    });

    webhookReq.write(postData);
    webhookReq.end();

  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to submit feedback'
    }));
  }
}

module.exports = {
  getDecisions,
  updateDecision,
  deleteDecision,
  getStats,
  getAIAnalytics,
  healthCheck,
  submitFeedback
};
