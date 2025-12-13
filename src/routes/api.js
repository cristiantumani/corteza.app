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
    if (validated.type) {
      filter.type = validated.type;
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
    const result = await decisionsCollection.deleteOne({ id: id });

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
    const decisionsCollection = getDecisionsCollection();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [total, byType, recentCount] = await Promise.all([
      decisionsCollection.countDocuments(),
      decisionsCollection.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]).toArray(),
      decisionsCollection.countDocuments({
        timestamp: { $gte: oneWeekAgo }
      })
    ]);

    const typeStats = byType.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total,
      byType: typeStats,
      lastWeek: recentCount
    }));
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch stats' }));
  }
}

/**
 * GET /health - Health check endpoint
 */
function healthCheck(req, res) {
  const { getDatabase } = require('../config/database');

  const status = {
    status: 'ok',
    mongodb: 'unknown',
    jira: config.jira.isConfigured ? 'configured' : 'not configured'
  };

  try {
    const db = getDatabase();
    status.mongodb = db ? 'connected' : 'disconnected';
  } catch (error) {
    status.mongodb = 'disconnected';
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
}

module.exports = {
  getDecisions,
  deleteDecision,
  getStats,
  healthCheck
};
