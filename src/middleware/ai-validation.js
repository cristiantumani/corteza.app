/**
 * Validates uploaded file type and size
 * @param {Object} file - Slack file object
 * @returns {Object} { valid: boolean, error: string | null }
 */
function validateUploadedFile(file) {
  // Check file type
  const allowedExtensions = ['.txt', '.md', '.pdf', '.docx'];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));

  if (!hasValidExtension) {
    return {
      valid: false,
      error: `Invalid file type. Supported formats: ${allowedExtensions.join(', ')}`
    };
  }

  // Check file size (10MB max)
  const maxSizeBytes = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSizeBytes) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `File too large (${sizeMB}MB). Maximum size: 10MB`
    };
  }

  return {
    valid: true,
    error: null
  };
}

/**
 * Validates transcript content length
 * @param {string} content - The extracted text content
 * @returns {Object} { valid: boolean, error: string | null }
 */
function validateTranscriptContent(content) {
  if (!content || typeof content !== 'string') {
    return {
      valid: false,
      error: 'Content is empty or invalid'
    };
  }

  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return {
      valid: false,
      error: 'File contains no text content'
    };
  }

  // Count words (rough approximation)
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  // Minimum 100 words
  if (wordCount < 100) {
    return {
      valid: false,
      error: `Transcript too short (${wordCount} words). Minimum: 100 words`
    };
  }

  // Maximum 50,000 words
  if (wordCount > 50000) {
    return {
      valid: false,
      error: `Transcript too long (${wordCount} words). Maximum: 50,000 words`
    };
  }

  return {
    valid: true,
    error: null
  };
}

/**
 * Validates AI suggestion structure
 * @param {Object} suggestion - AI suggestion object
 * @returns {boolean} True if valid, false otherwise
 */
function validateAISuggestion(suggestion) {
  // Required fields
  const requiredFields = ['decision_text', 'decision_type', 'confidence'];
  for (const field of requiredFields) {
    if (!(field in suggestion)) {
      console.log(`❌ Missing required field: ${field}`);
      return false;
    }
  }

  // Validate decision_type
  const validTypes = ['product', 'ux', 'technical'];
  if (!validTypes.includes(suggestion.decision_type)) {
    console.log(`❌ Invalid decision_type: ${suggestion.decision_type}`);
    return false;
  }

  // Validate confidence score
  if (typeof suggestion.confidence !== 'number' || suggestion.confidence < 0 || suggestion.confidence > 1) {
    console.log(`❌ Invalid confidence score: ${suggestion.confidence}`);
    return false;
  }

  // Validate decision_text
  if (typeof suggestion.decision_text !== 'string' || suggestion.decision_text.trim().length === 0) {
    console.log(`❌ Invalid decision_text`);
    return false;
  }

  // Optional: validate tags if present
  if (suggestion.tags && !Array.isArray(suggestion.tags)) {
    console.log(`❌ Tags must be an array`);
    return false;
  }

  return true;
}

/**
 * Sanitizes transcript text for AI processing
 * @param {string} text - The raw transcript text
 * @returns {string} Sanitized text
 */
function sanitizeTranscriptText(text) {
  if (!text) return '';

  // Remove excessive whitespace
  let sanitized = text.replace(/\s+/g, ' ');

  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trim
  sanitized = sanitized.trim();

  return sanitized;
}

module.exports = {
  validateUploadedFile,
  validateTranscriptContent,
  validateAISuggestion,
  sanitizeTranscriptText
};
