import * as coda from '@codahq/packs-sdk';

/**
 * Decision Schema
 * Defines the structure of a decision object in Coda
 */
export const DecisionSchema = coda.makeObjectSchema({
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
      description: 'Decision type (architecture, process, product, strategic, technical, other)',
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
