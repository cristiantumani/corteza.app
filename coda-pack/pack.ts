import * as coda from '@codahq/packs-sdk';

export const pack = coda.newPack();

// Add network domain
pack.addNetworkDomain('corteza.app');

// Set up Bearer token authentication
pack.setUserAuthentication({
  type: coda.AuthenticationType.HeaderBearerToken,
  instructionsUrl: 'https://app.corteza.app/dashboard',
});

// Decision Schema
const DecisionSchema = coda.makeObjectSchema({
  properties: {
    id: {
      type: coda.ValueType.Number,
      fromKey: 'id',
      required: true,
      description: 'Unique decision ID',
    },
    text: {
      type: coda.ValueType.String,
      fromKey: 'text',
      required: true,
      description: 'Decision description',
    },
    type: {
      type: coda.ValueType.String,
      fromKey: 'type',
      description: 'Decision type',
    },
    category: {
      type: coda.ValueType.String,
      fromKey: 'category',
      description: 'Decision category',
    },
    timestamp: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.DateTime,
      fromKey: 'timestamp',
      description: 'When the decision was made',
    },
    user_name: {
      type: coda.ValueType.String,
      fromKey: 'user_name',
      description: 'Person who logged the decision',
    },
    tags: {
      type: coda.ValueType.String,
      fromKey: 'tags',
      description: 'Comma-separated tags',
    },
    epic_key: {
      type: coda.ValueType.String,
      fromKey: 'epic_key',
      description: 'Related Jira epic key',
    },
    additionalContext: {
      type: coda.ValueType.String,
      fromKey: 'alternatives',
      description: 'Additional context or alternatives considered',
    },
    notionUrl: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.Url,
      fromKey: 'notion_page_url',
      description: 'Link to Notion page',
    },
    jiraUrl: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.Url,
      fromKey: 'jira_url',
      description: 'Link to Jira epic',
    },
  },
  displayProperty: 'text',
  idProperty: 'id',
  featuredProperties: ['text', 'type', 'category', 'user_name', 'timestamp', 'additionalContext'],
});

// Decisions Sync Table
pack.addSyncTable({
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
      const page = (context.sync.continuation as any)?.page || 1;
      const baseUrl = 'https://app.corteza.app';

      const queryParams: any = {
        page: page,
        limit: 100,
      };

      if (type) queryParams.type = type;
      if (category) queryParams.category = category;
      if (search) queryParams.search = search;

      const url = coda.withQueryParams(`${baseUrl}/api/decisions`, queryParams);

      const response = await context.fetcher.fetch({
        method: 'GET',
        url: url,
      });

      const { decisions, pagination } = response.body;

      return {
        result: decisions,
        continuation: pagination.page < pagination.pages
          ? { page: pagination.page + 1 }
          : undefined,
      };
    },
  },
});

// Search Formula
pack.addFormula({
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

// GetDecision Formula
pack.addFormula({
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
    });

    return response.body.decision;
  },
});
