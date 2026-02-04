import * as coda from '@codahq/packs-sdk';
import { DecisionSchema } from './schemas';

/**
 * Decisions Sync Table
 * Syncs all decisions from Corteza into a Coda table
 */
export const DecisionsSyncTable = coda.makeSyncTable({
  name: 'Decisions',
  description: 'Sync all decisions from your Corteza workspace',
  identityName: 'Decision',
  schema: DecisionSchema,
  formula: {
    name: 'SyncDecisions',
    description: 'Syncs decisions from Corteza',
    parameters: [
      coda.makeParameter({
        type: coda.ParameterType.String,
        name: 'type',
        description: 'Filter by decision type (optional)',
        optional: true,
        autocomplete: ['architecture', 'process', 'product', 'strategic', 'technical', 'other'],
      }),
      coda.makeParameter({
        type: coda.ParameterType.String,
        name: 'category',
        description: 'Filter by category (optional)',
        optional: true,
      }),
      coda.makeParameter({
        type: coda.ParameterType.String,
        name: 'search',
        description: 'Search in decision text and tags (optional)',
        optional: true,
      }),
    ],
    execute: async function ([type, category, search], context) {
      const baseUrl = 'https://app.corteza.app';
      const url = coda.withQueryParams(`${baseUrl}/api/decisions`, {
        page: 1,
        limit: 100,
        ...(type && { type }),
        ...(category && { category }),
        ...(search && { search }),
      });

      const response = await context.fetcher.fetch({
        method: 'GET',
        url: url,
        headers: {
          'Authorization': `Bearer ${context.invocationToken}`,
        },
      });

      const { decisions, pagination } = response.body;

      return {
        result: decisions,
        continuation: pagination.page < pagination.pages
          ? { page: pagination.page + 1 }
          : undefined,
      };
    },
    maxUpdateBatchSize: 10,
    executeUpdate: async function (context, updates) {
      // Decisions sync table is read-only for now
      // Future: implement PUT /api/decisions/:id for updates
      throw new coda.UserVisibleError('Updating decisions from Coda is not yet supported');
    },
  },
});
