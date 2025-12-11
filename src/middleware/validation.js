/**
 * Validates and sanitizes query parameters
 */
function validateQueryParams(query) {
  const validated = {};

  // Page number (default: 1, min: 1)
  if (query.page) {
    const page = parseInt(query.page);
    validated.page = (!isNaN(page) && page > 0) ? page : 1;
  } else {
    validated.page = 1;
  }

  // Limit (default: 50, min: 1, max: 100)
  if (query.limit) {
    const limit = parseInt(query.limit);
    validated.limit = (!isNaN(limit) && limit > 0 && limit <= 100) ? limit : 50;
  } else {
    validated.limit = 50;
  }

  // Type filter (must be one of the allowed types)
  const allowedTypes = ['product', 'ux', 'technical'];
  if (query.type && allowedTypes.includes(query.type.toLowerCase())) {
    validated.type = query.type.toLowerCase();
  }

  // Epic filter (alphanumeric and hyphens only)
  if (query.epic) {
    const epic = query.epic.trim();
    if (/^[A-Z0-9-]+$/i.test(epic)) {
      validated.epic = epic;
    }
  }

  // Search query (limit length, escape regex special chars)
  if (query.search) {
    const search = query.search.trim();
    if (search.length > 0 && search.length <= 200) {
      // Escape special regex characters to prevent regex injection
      validated.search = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  return validated;
}

/**
 * Validates decision ID from path
 */
function validateDecisionId(id) {
  const parsed = parseInt(id);
  if (isNaN(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

/**
 * Validates epic key format
 */
function validateEpicKey(epicKey) {
  if (!epicKey) return null;
  const trimmed = epicKey.trim();
  // Jira keys are typically PROJECT-123 format
  if (/^[A-Z][A-Z0-9]+-\d+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return null;
}

/**
 * Validates and sanitizes tags array
 */
function validateTags(tagsString) {
  if (!tagsString) return [];
  return tagsString
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0 && t.length <= 50)
    .slice(0, 10); // Max 10 tags
}

module.exports = {
  validateQueryParams,
  validateDecisionId,
  validateEpicKey,
  validateTags
};
