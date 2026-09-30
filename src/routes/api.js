const crypto = require('crypto');
const { getDecisionsCollection, getWorkspaceSpacesCollection, getWorkspaceMembersCollection, getDatabase } = require('../config/database');
const { validateQueryParams, validateDecisionId } = require('../middleware/validation');
const config = require('../config/environment');
const { canModifyDecision, isAdmin, getUserAccessibleSpaces, canCreateInSpace, canAccessSpace } = require('../services/permissions');
const { getSlackClient } = require('../config/slack-client');
const { sendFeedbackNotificationEmail } = require('../utils/n8n-client');
const { DECISION_TYPES } = require('../core/decisions/types');
const { PENDING_REVIEW } = require('../core/decisions/review-service');
const { jsonBody } = require('../middleware/input-safety');

/**
 * Security: Escapes regex special characters to prevent ReDoS attacks
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

    // SECURITY: the workspace comes from the session (requireWorkspaceAccess checked the query matches it)
    validated.workspace_id = req.session?.user?.workspace_id || req.user?.workspace_id || validated.workspace_id;
    if (!validated.workspace_id) {
      return res.status(400).json({
        error: 'workspace_id is required'
      });
    }

    // Build MongoDB filter
    const filter = {
      workspace_id: validated.workspace_id
    };

    // SPACE FILTERING: space_id is REQUIRED (space-first architecture)
    if (!validated.space_id) {
      return res.status(400).json({
        error: 'space_id is required',
        message: 'You must select a space to view decisions'
      });
    }

    // Validate user has access to this space
    try {
      const client = await getSlackClient(validated.workspace_id);
      const userId = req.session?.user?.user_id || req.user?.user_id;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const hasAccess = await canAccessSpace(client, validated.workspace_id, validated.space_id, userId);

      if (!hasAccess) {
        console.log(`⚠️  User ${userId} attempted to access space ${validated.space_id} without permission`);
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to access this space'
        });
      }

      filter.space_id = validated.space_id;
    } catch (spaceError) {
      console.error('Error validating space access:', spaceError);
      return res.status(500).json({
        error: 'Failed to validate space access',
        message: 'An error occurred while checking space permissions'
      });
    }

    // How many outcomes in this space are waiting for review (before the other filters)
    const pendingFilter = { ...filter, ...PENDING_REVIEW };
    if (validated.review === 'pending') Object.assign(filter, PENDING_REVIEW);

    if (validated.type) {
      filter.type = Array.isArray(validated.type) ? { $in: validated.type } : validated.type;
    }
    if (validated.category) {
      filter.category = validated.category;
    }
    if (validated.epic) {
      // Security: Escape regex to prevent ReDoS attacks
      filter.epic_key = { $regex: escapeRegex(validated.epic), $options: 'i' };
    }
    if (validated.search) {
      // Security: Escape regex to prevent ReDoS attacks
      const escapedSearch = escapeRegex(validated.search);
      filter.$or = [
        { text: { $regex: escapedSearch, $options: 'i' } },
        { tags: { $regex: escapedSearch, $options: 'i' } }
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
    const [decisions, total, pendingReview] = await Promise.all([
      decisionsCollection
        .find(filter, { projection: { embedding: 0 } }) // embeddings are large and only used server-side
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      decisionsCollection.countDocuments(filter),
      decisionsCollection.countDocuments(pendingFilter)
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      decisions,
      pending_review: pendingReview,
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
/** A real calendar date written as YYYY-MM-DD */
function isValidDueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !isNaN(date) && date.toISOString().slice(0, 10) === value;
}

async function updateDecision(req, res) {
  try {
    const idString = parsePathId(req.url);
    const id = validateDecisionId(idString);

    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid decision ID' }));
      return;
    }

    // Body parsed by the global JSON parser (src/index.js)
    {
      try {
        const updates = jsonBody(req);

        // Validate and sanitize updates
        const sanitizedUpdates = {};

        if (updates.text && typeof updates.text === 'string' && updates.text.trim().length > 0) {
          sanitizedUpdates.text = updates.text.trim();
        }

        if (updates.type && DECISION_TYPES.includes(updates.type)) {
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

        // Why / owner / due date (AI extraction v2 fields); null or '' clears them
        const optionalText = (value, max) => {
          if (value === null || value === '') return null;
          if (typeof value !== 'string') return undefined;
          return value.trim().slice(0, max) || null;
        };
        if (updates.rationale !== undefined) {
          const rationale = optionalText(updates.rationale, 2000);
          if (rationale !== undefined) sanitizedUpdates.rationale = rationale;
        }
        if (updates.owner_name !== undefined) {
          const ownerName = optionalText(updates.owner_name, 200);
          if (ownerName !== undefined) {
            sanitizedUpdates.owner_name = ownerName;
            sanitizedUpdates.owner_user_id = null; // a typed name isn't linked to a member
          }
        }
        // Owner picked from the members list; resolved to a name after the permission check
        const ownerUserId = updates.owner_user_id === null || typeof updates.owner_user_id === 'string'
          ? updates.owner_user_id
          : undefined;
        if (ownerUserId === null || ownerUserId === '') {
          sanitizedUpdates.owner_user_id = null;
          sanitizedUpdates.owner_name = null;
        }
        if (updates.due_date !== undefined) {
          if (updates.due_date === null || updates.due_date === '') {
            sanitizedUpdates.due_date = null;
          } else if (isValidDueDate(updates.due_date)) {
            sanitizedUpdates.due_date = updates.due_date;
          }
        }

        if (Object.keys(sanitizedUpdates).length === 0 && !ownerUserId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No valid fields to update' }));
          return;
        }

        // Add updated timestamp
        sanitizedUpdates.updated_at = new Date().toISOString();

        const decisionsCollection = getDecisionsCollection();

        // Security: REQUIRE workspace_id to prevent cross-workspace updates
        // Use authenticated workspace from middleware, not URL parameter
        if (!req.authenticatedWorkspaceId) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Workspace authentication required' }));
          return;
        }

        const updateFilter = {
          id: id,
          workspace_id: req.authenticatedWorkspaceId // Always filter by authenticated workspace
        };

        // Get decision to check creator for permission validation
        const decision = await decisionsCollection.findOne(updateFilter);

        if (!decision) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Decision not found' }));
          return;
        }

        // CHECK PERMISSION: Can this user modify this decision?
        const client = await getSlackClient(req.authenticatedWorkspaceId);
        // Also needs access to its space: admins never edit a colleague's personal space
        const canModify = await canModifyDecision(
          client,
          req.authenticatedWorkspaceId,
          req.session.user.user_id,
          decision.user_id
        ) && await canAccessSpace(client, req.authenticatedWorkspaceId, decision.space_id, req.session.user.user_id);

        if (!canModify) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Forbidden',
            message: 'You can only edit your own decisions. Admins can edit any decision.'
          }));
          return;
        }

        if (ownerUserId) {
          const member = await getWorkspaceMembersCollection().findOne(
            { workspace_id: req.authenticatedWorkspaceId, user_id: ownerUserId, removed_at: null },
            { projection: { user_id: 1, user_name: 1, email: 1 } }
          );
          if (!member) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'That person is not a member of this workspace' }));
            return;
          }
          sanitizedUpdates.owner_user_id = member.user_id;
          sanitizedUpdates.owner_name = member.user_name || member.email;
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
        // The saved values, so the page shows what was stored (e.g. tags lowercased, epic key uppercased)
        const saved = Object.fromEntries(Object.entries(sanitizedUpdates).filter(([key]) => key !== 'updated_at'));
        res.end(JSON.stringify({ success: true, updated: id, decision: { id, ...saved } }));
      } catch (error) {
        console.error('Update parse error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    }
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

    // Security: Use authenticated workspace from middleware
    if (!req.authenticatedWorkspaceId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Workspace authentication required' }));
      return;
    }

    // Build filter with workspace_id for security
    const deleteFilter = {
      id: id,
      workspace_id: req.authenticatedWorkspaceId
    };

    // Get decision to check creator for permission validation
    const decision = await decisionsCollection.findOne(deleteFilter);

    if (!decision) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Decision not found' }));
      return;
    }

    // CHECK PERMISSION: Can this user delete this decision?
    const client = await getSlackClient(req.authenticatedWorkspaceId);
    // Also needs access to its space: admins never delete from a colleague's personal space
    const canModify = await canModifyDecision(
      client,
      req.authenticatedWorkspaceId,
      req.session.user.user_id,
      decision.user_id
    ) && await canAccessSpace(client, req.authenticatedWorkspaceId, decision.space_id, req.session.user.user_id);

    if (!canModify) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Forbidden',
        message: 'You can only delete your own decisions. Admins can delete any decision.'
      }));
      return;
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

    // Only the signed-in workspace's outcomes, never all workspaces
    const workspaceId = req.session?.user?.workspace_id || req.user?.workspace_id || validated.workspace_id;
    if (!workspaceId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'workspace_id is required' }));
      return;
    }
    // Only outcomes in spaces this person can see: never a colleague's personal space
    const userId = req.session?.user?.user_id || req.user?.user_id;
    const spaceIds = userId ? await getUserAccessibleSpaces(null, workspaceId, userId) : [];
    const baseFilter = { workspace_id: workspaceId, space_id: { $in: spaceIds } };

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
 * POST /api/feedback - Submit user feedback
 * Stores feedback in the `feedback` collection and emails FEEDBACK_EMAIL (if set) via Resend
 */
async function submitFeedback(req, res) {
  try {
    const { type, feedback, email, source } = req.body || {};

    // Validate required fields
    if (typeof type !== 'string' || !type.trim() || typeof feedback !== 'string' || !feedback.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Missing required fields: type and feedback'
      }));
      return;
    }

    if (feedback.length > 10000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Feedback is too long (max 10,000 characters)'
      }));
      return;
    }

    // Identity comes from the session, not the request body
    const user = req.session.user;
    const contactEmail = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ? email.trim()
      : (user.email || null);

    const feedbackDoc = {
      type: type.trim().slice(0, 50),
      feedback: feedback.trim(),
      email: contactEmail,
      workspace_id: user.workspace_id,
      workspace_name: user.workspace_name || null,
      user_id: user.user_id,
      user_name: user.user_name || null,
      source: typeof source === 'string' ? source.slice(0, 50) : 'dashboard',
      created_at: new Date()
    };

    await getDatabase().collection('feedback').insertOne(feedbackDoc);
    console.log(`📝 Feedback (${feedbackDoc.type}) saved from ${feedbackDoc.user_name} in ${feedbackDoc.workspace_id}`);

    // Notify the team; feedback is already saved, so an email failure doesn't fail the request
    const notifyTo = process.env.FEEDBACK_EMAIL;
    if (notifyTo && process.env.RESEND_API_KEY) {
      sendFeedbackNotificationEmail({
        to: notifyTo,
        type: feedbackDoc.type,
        feedback: feedbackDoc.feedback,
        user_name: feedbackDoc.user_name,
        user_email: feedbackDoc.email,
        workspace_name: feedbackDoc.workspace_name,
        workspace_id: feedbackDoc.workspace_id,
        source: feedbackDoc.source
      }).catch(error => console.error('❌ Feedback notification email failed:', error.message));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Feedback submitted successfully'
    }));
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to submit feedback'
    }));
  }
}

/**
 * CREDIT OPTIMIZATION: In-memory cache for API extraction results
 * Uses content hash as key, caches for 10 minutes
 * Prevents duplicate API calls when same text is submitted multiple times
 */
const extractionCache = new Map();
const EXTRACTION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * POST /api/extract-decisions - Extract decisions from transcript text
 * Session-authenticated
 *
 * CREDIT OPTIMIZATION: Added caching to prevent duplicate Claude API calls
 * - Caches extraction results by content hash
 * - Passes workspace_id for few-shot learning (reduces tokens via targeted examples)
 */
async function extractDecisionsFromText(req, res) {
  console.log('🤖 AI extraction endpoint called');

  try {
    const { extractDecisionsFromTranscript, isClaudeConfigured } = require('../services/claude');

    // Check if Claude is configured
    if (!isClaudeConfigured()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'AI extraction not configured (missing ANTHROPIC_API_KEY)'
      }));
      return;
    }

    const { text, fileName, user_id, user_name } = req.body;
    // Set by requireWorkspaceAccess, so callers can only use their own workspace
    const workspace_id = req.authenticatedWorkspaceId;

    // Validate required fields
    if (!text || !workspace_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Missing required field: text'
      }));
      return;
    }

    // CREDIT OPTIMIZATION: Check cache before calling Claude
    const contentHash = crypto.createHash('sha256').update(text + workspace_id).digest('hex');
    const cached = extractionCache.get(contentHash);
    if (cached && (Date.now() - cached.timestamp) < EXTRACTION_CACHE_TTL_MS) {
      console.log('♻️  CREDIT SAVED: Returning cached extraction results');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        decisions: cached.decisions,
        count: cached.decisions.length,
        fileName: fileName || 'transcript.txt',
        workspace_id,
        user_id,
        user_name,
        cached: true
      }));
      return;
    }

    console.log('🤖 Extracting decisions from:', fileName || 'text', `(${text.length} chars)`);

    // CREDIT OPTIMIZATION: Pass workspace_id for few-shot learning
    const result = await extractDecisionsFromTranscript(text, workspace_id, { userId: req.session?.user?.user_id || null });
    const extractedDecisions = result.decisions;

    if (!extractedDecisions || extractedDecisions.length === 0) {
      // CREDIT OPTIMIZATION: Cache empty results too
      extractionCache.set(contentHash, { decisions: [], timestamp: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        decisions: [],
        message: 'No decisions found in transcript'
      }));
      return;
    }

    console.log(`✅ Extracted ${extractedDecisions.length} decisions`);

    // CREDIT OPTIMIZATION: Cache successful results
    extractionCache.set(contentHash, { decisions: extractedDecisions, timestamp: Date.now() });

    // Cleanup old cache entries if cache is getting large
    if (extractionCache.size > 50) {
      const now = Date.now();
      for (const [key, value] of extractionCache.entries()) {
        if (now - value.timestamp > EXTRACTION_CACHE_TTL_MS) {
          extractionCache.delete(key);
        }
      }
    }

    // Return extracted decisions
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      decisions: extractedDecisions,
      count: extractedDecisions.length,
      fileName: fileName || 'transcript.txt',
      workspace_id,
      user_id,
      user_name
    }));

  } catch (error) {
    console.error('❌ Error extracting decisions:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to extract decisions',
      details: error.message
    }));
  }
}

/**
 * GET /api/permissions/check - Check if current user is admin
 * Used by dashboard to determine UI permissions
 */
async function checkAdminStatus(req, res) {
  try {
    if (!req.session || !req.session.user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const { workspace_id, user_id } = req.session.user;

    // Get Slack client (may be null for test workspaces)
    let client = null;
    try {
      client = await getSlackClient(workspace_id);
    } catch (error) {
      // Slack client unavailable - will use database-only admin check
    }
    const userIsAdmin = await isAdmin(client, workspace_id, user_id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      is_admin: userIsAdmin,
      user_id: user_id,
      workspace_id: workspace_id
    }));

  } catch (error) {
    console.error('❌ Error checking admin status:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to check admin status' }));
  }
}

/**
 * POST /api/memory/create - Create a new memory entry from dashboard
 * Body: { text, type, category, tags, epic_key, alternatives, workspace_id, source }
 */
async function createMemory(req, res) {
  try {
    // Get user info from session
    const userId = req.session?.user?.user_id;
    const userName = req.session?.user?.user_name;
    const workspaceId = req.session?.user?.workspace_id;

    if (!userId || !workspaceId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized', message: 'You must be logged in' }));
      return;
    }

    // Validate input
    const { text, type, category, tags, epic_key, alternatives, source, space_id } = req.body;

    if (!text || !text.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Validation error', message: 'Text is required' }));
      return;
    }

    if (!type || !DECISION_TYPES.includes(type)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Validation error', message: 'Valid type is required' }));
      return;
    }

    // Space assignment (space-first architecture: space_id is REQUIRED)
    if (!space_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'space_id is required',
        message: 'You must select a space to create a decision. Switch spaces from the dashboard header if needed.'
      }));
      return;
    }

    const targetSpaceId = space_id;
    const spacesCollection = getWorkspaceSpacesCollection();

    // Verify user has permission to create in this space
    const client = await getSlackClient(workspaceId);
    const canCreate = await canCreateInSpace(client, workspaceId, targetSpaceId, userId);

    if (!canCreate) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Permission denied',
        message: 'You do not have permission to create decisions in this space'
      }));
      return;
    }

    // Get space details
    const space = await spacesCollection.findOne({
      workspace_id: workspaceId,
      space_id: targetSpaceId,
      archived: false
    });

    if (!space) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Space not found',
        message: 'The specified space does not exist or has been archived'
      }));
      return;
    }

    const targetSpaceName = space.name;

    // Get next ID
    const decisionsCollection = getDecisionsCollection();
    const lastDecision = await decisionsCollection
      .find({ workspace_id: workspaceId })
      .sort({ id: -1 })
      .limit(1)
      .toArray();

    const nextId = lastDecision.length > 0 ? lastDecision[0].id + 1 : 1;

    // Create memory document
    const memory = {
      id: nextId,
      text: text.trim(),
      type: type,
      category: category || null,
      tags: tags || null,
      epic_key: epic_key || null,
      alternatives: alternatives || null,
      user_id: userId,
      user_name: userName,
      workspace_id: workspaceId,
      space_id: targetSpaceId,
      space_name: targetSpaceName,
      source: source || 'dashboard', // Track where it came from
      timestamp: new Date().toISOString(),
      created_at: new Date(),
      jira_url: null
    };

    // Insert into database
    await decisionsCollection.insertOne(memory);

    console.log(`✅ Memory #${nextId} created from ${source} by ${userName} in workspace ${workspaceId}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      memory: memory,
      message: 'Memory saved successfully'
    }));

  } catch (error) {
    console.error('❌ Error creating memory:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to create memory', message: error.message }));
  }
}

module.exports = {
  getDecisions,
  updateDecision,
  deleteDecision,
  getStats,
  healthCheck,
  submitFeedback,
  extractDecisionsFromText,
  checkAdminStatus,
  createMemory,
  isValidDueDate
};
