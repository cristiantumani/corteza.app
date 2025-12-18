const OpenAI = require('openai');

let openaiClient = null;
let embeddingsEnabled = false;

/**
 * Initialize OpenAI client for embeddings
 */
function initializeEmbeddings() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.log('ℹ️  Semantic search disabled (OPENAI_API_KEY not set)');
    return;
  }

  openaiClient = new OpenAI({ apiKey });
  embeddingsEnabled = true;
  console.log('✅ Semantic search enabled (OpenAI embeddings)');
}

/**
 * Check if embeddings are enabled
 */
function isEmbeddingsEnabled() {
  return embeddingsEnabled;
}

/**
 * Generate embedding vector for a decision
 * Combines all relevant text fields for better semantic search
 *
 * @param {Object} decision - Decision object from database
 * @returns {Promise<Array<number>>} - 1536-dimensional embedding vector
 */
async function generateDecisionEmbedding(decision) {
  if (!embeddingsEnabled) {
    throw new Error('Embeddings not enabled. Set OPENAI_API_KEY.');
  }

  // Combine all relevant fields for embedding
  const textToEmbed = buildDecisionText(decision);

  try {
    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-3-small', // 1536 dimensions, cheap and fast
      input: textToEmbed,
      encoding_format: 'float'
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('❌ Error generating embedding:', error.message);
    throw error;
  }
}

/**
 * Generate embedding for a search query
 *
 * @param {string} query - User's search query
 * @returns {Promise<Array<number>>} - 1536-dimensional embedding vector
 */
async function generateQueryEmbedding(query) {
  if (!embeddingsEnabled) {
    throw new Error('Embeddings not enabled. Set OPENAI_API_KEY.');
  }

  try {
    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      encoding_format: 'float'
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('❌ Error generating query embedding:', error.message);
    throw error;
  }
}

/**
 * Build comprehensive text from decision for embedding
 * Includes all searchable fields weighted by importance
 */
function buildDecisionText(decision) {
  const parts = [];

  // Decision text (most important) - repeat 3x for higher weight
  if (decision.text) {
    parts.push(decision.text);
    parts.push(decision.text);
    parts.push(decision.text);
  }

  // Decision type
  if (decision.type) {
    parts.push(`Type: ${decision.type}`);
  }

  // Tags (important for categorization)
  if (decision.tags && decision.tags.length > 0) {
    parts.push(`Tags: ${decision.tags.join(', ')}`);
    parts.push(`Tags: ${decision.tags.join(', ')}`); // Repeat for weight
  }

  // Epic/Jira context
  if (decision.epic_key) {
    parts.push(`Epic: ${decision.epic_key}`);
  }

  if (decision.jira_data) {
    if (decision.jira_data.summary) {
      parts.push(`Jira: ${decision.jira_data.summary}`);
    }
    if (decision.jira_data.description) {
      parts.push(decision.jira_data.description.substring(0, 500)); // Limit length
    }
  }

  // Additional context/alternatives
  if (decision.alternatives) {
    parts.push(decision.alternatives);
  }

  // Creator (for "decisions by Sarah" queries)
  if (decision.creator) {
    parts.push(`Creator: ${decision.creator}`);
  }

  // AI suggestion context (if available)
  if (decision.context) {
    parts.push(decision.context.substring(0, 300));
  }

  // Combine with newlines
  return parts.join('\n');
}

/**
 * Batch generate embeddings for multiple decisions
 * More efficient than one-by-one
 *
 * @param {Array<Object>} decisions - Array of decision objects
 * @returns {Promise<Array<Object>>} - Decisions with embeddings added
 */
async function batchGenerateEmbeddings(decisions) {
  if (!embeddingsEnabled) {
    throw new Error('Embeddings not enabled. Set OPENAI_API_KEY.');
  }

  console.log(`🔄 Generating embeddings for ${decisions.length} decisions...`);

  const results = [];
  const batchSize = 100; // OpenAI allows up to 2048 inputs per batch

  for (let i = 0; i < decisions.length; i += batchSize) {
    const batch = decisions.slice(i, i + batchSize);
    const texts = batch.map(d => buildDecisionText(d));

    try {
      const response = await openaiClient.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
        encoding_format: 'float'
      });

      // Add embeddings to decisions
      batch.forEach((decision, idx) => {
        results.push({
          ...decision,
          embedding: response.data[idx].embedding
        });
      });

      console.log(`✅ Processed ${Math.min(i + batchSize, decisions.length)}/${decisions.length}`);
    } catch (error) {
      console.error(`❌ Error in batch ${i}-${i + batchSize}:`, error.message);
      // Continue with remaining batches
    }
  }

  return results;
}

module.exports = {
  initializeEmbeddings,
  isEmbeddingsEnabled,
  generateDecisionEmbedding,
  generateQueryEmbedding,
  batchGenerateEmbeddings,
  buildDecisionText
};
