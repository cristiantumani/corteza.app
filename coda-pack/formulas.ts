import * as coda from '@codahq/packs-sdk';
import { DecisionSchema } from './schemas';

/**
 * Search Formula
 * Searches decisions using Corteza's semantic search
 */
export const SearchFormula = coda.makeFormula({
  name: 'Search',
  description: 'Search decisions using AI semantic search',
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: 'query',
      description: 'Search query (natural language)',
    }),
    coda.makeParameter({
      type: coda.ParameterType.Number,
      name: 'limit',
      description: 'Maximum number of results (default: 10)',
      optional: true,
    }),
  ],
  resultType: coda.ValueType.Array,
  items: DecisionSchema,
  execute: async function ([query, limit = 10], context) {
    const baseUrl = 'https://app.corteza.app';
    const url = `${baseUrl}/api/semantic-search`;

    const response = await context.fetcher.fetch({
      method: 'POST',
      url: url,
      headers: {
        'Authorization': `Bearer ${context.invocationToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit,
      }),
    });

    const { results } = response.body;
    return results.all || [];
  },
});

/**
 * GetDecision Formula
 * Fetches a single decision by ID
 */
export const GetDecisionFormula = coda.makeFormula({
  name: 'GetDecision',
  description: 'Get a single decision by ID',
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.Number,
      name: 'decisionId',
      description: 'Decision ID',
    }),
  ],
  resultType: coda.ValueType.Object,
  schema: DecisionSchema,
  execute: async function ([decisionId], context) {
    const baseUrl = 'https://app.corteza.app';
    const url = `${baseUrl}/api/v1/decisions/${decisionId}`;

    const response = await context.fetcher.fetch({
      method: 'GET',
      url: url,
      headers: {
        'Authorization': `Bearer ${context.invocationToken}`,
      },
    });

    return response.body.decision;
  },
});
