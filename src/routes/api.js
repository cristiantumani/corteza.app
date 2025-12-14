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
        const allowedFields = ['text', 'type', 'epic_key', 'tags', 'alternatives'];
        const sanitizedUpdates = {};

        if (updates.text && typeof updates.text === 'string' && updates.text.trim().length > 0) {
          sanitizedUpdates.text = updates.text.trim();
        }

        if (updates.type && ['product', 'ux', 'technical'].includes(updates.type)) {
          sanitizedUpdates.type = updates.type;
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

    const [total, byType, recentCount] = await Promise.all([
      decisionsCollection.countDocuments(baseFilter),
      decisionsCollection.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$type', count: { $sum: 1 } } }
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
  healthCheck
};
