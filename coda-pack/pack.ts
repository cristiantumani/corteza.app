import * as coda from '@codahq/packs-sdk';
import { DecisionsSyncTable } from './sync-tables';
import { SearchFormula, GetDecisionFormula } from './formulas';

export const pack = coda.newPack();

/**
 * Pack Metadata
 */
pack.setUserAuthentication({
  type: coda.AuthenticationType.CustomHeaderToken,
  headerName: 'Authorization',
  tokenPrefix: 'Bearer',
  instructionsUrl: 'https://app.corteza.app/dashboard',
  getConnectionName: async function (context) {
    // Optional: fetch user info to display connection name
    return 'Corteza';
  },
});

pack.addNetworkDomain('corteza.app');

/**
 * Pack Information
 */
pack.setName('Corteza');
pack.setDescription('Access and sync decisions from your Corteza workspace');
pack.setVersion('1.0.0');

/**
 * Register Sync Tables
 */
pack.addSyncTable(DecisionsSyncTable);

/**
 * Register Formulas
 */
pack.addFormula(SearchFormula);
pack.addFormula(GetDecisionFormula);
