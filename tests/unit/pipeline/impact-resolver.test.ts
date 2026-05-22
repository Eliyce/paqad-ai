import { describe, expect, it } from 'vitest';

import { resolveImpacts } from '@/pipeline/impact-resolver.js';

describe('resolveImpacts', () => {
  it('infers impacts from module paths', () => {
    const result = resolveImpacts({
      requestText: 'change routes and page',
      modulePaths: ['database/migrations/add_users', 'src/api/users', 'src/pages/home'],
    });

    expect(result.database_impact).toBe('schema-change');
    expect(result.api_impact).toBe('additive-endpoint');
    expect(result.ui_impact).toBe('new-screen');
    expect(result.customer_facing_impact).toBe('customer-visible');
    expect(result.resolution_sources.database_impact).toBe('deterministic');
    expect(result.resolution_sources.api_impact).toBe('deterministic');
    expect(result.resolution_sources.ui_impact).toBe('deterministic');
  });

  it('falls back to request text for migrations, redesigns, and sensitivity', () => {
    const result = resolveImpacts({
      requestText: 'breaking api redesign with data migration for gdpr pii health payment',
      modulePaths: [],
    });

    expect(result.database_impact).toBe('data-migration');
    expect(result.api_impact).toBe('breaking-change');
    expect(result.ui_impact).toBe('redesign');
    expect(result.compliance_sensitivity).toBe('high');
    expect(result.data_sensitivity).toBe('pii');
    expect(result.reversibility).toBe('difficult');
    expect(result.resolution_sources.compliance_sensitivity).toBe('deterministic');
    expect(result.resolution_sources.reversibility).toBe('deterministic');
  });

  it('returns none defaults when no signals exist', () => {
    const result = resolveImpacts({
      requestText: 'internal cleanup',
      modulePaths: [],
    });

    expect(result.database_impact).toBe('none');
    expect(result.api_impact).toBe('none');
    expect(result.ui_impact).toBe('none');
    expect(result.customer_facing_impact).toBe('internal');
    expect(result.data_sensitivity).toBe('none');
  });

  it('detects health and financial data sensitivity', () => {
    const healthResult = resolveImpacts({
      requestText: 'update health records',
      modulePaths: [],
    });
    expect(healthResult.data_sensitivity).toBe('health');

    const paymentResult = resolveImpacts({
      requestText: 'process payment flow',
      modulePaths: [],
    });
    expect(paymentResult.data_sensitivity).toBe('financial');
  });

  it('detects modified-endpoint from path + modify keyword', () => {
    const result = resolveImpacts({
      requestText: 'update the existing endpoint behaviour',
      modulePaths: ['src/api/users'],
    });
    expect(result.api_impact).toBe('modified-endpoint');
  });

  it('detects modified-endpoint from keyword alone when no route path present', () => {
    const result = resolveImpacts({
      requestText: 'modify the api endpoint',
      modulePaths: [],
    });
    expect(result.api_impact).toBe('modified-endpoint');
  });

  it('detects new-component from component path', () => {
    const result = resolveImpacts({
      requestText: 'add button',
      modulePaths: ['src/components/Button'],
    });
    expect(result.ui_impact).toBe('new-component');
  });

  it('detects new-component from request keyword alone', () => {
    const result = resolveImpacts({
      requestText: 'add a new button form widget',
      modulePaths: [],
    });
    expect(result.ui_impact).toBe('new-component');
  });

  it('detects new-screen from request keyword alone', () => {
    const result = resolveImpacts({
      requestText: 'build a dashboard page',
      modulePaths: [],
    });
    expect(result.ui_impact).toBe('new-screen');
  });

  it('detects query-change from request text', () => {
    const result = resolveImpacts({
      requestText: 'optimise the database query',
      modulePaths: [],
    });
    expect(result.database_impact).toBe('query-change');
  });

  it('detects schema-change from schema/column/table keywords', () => {
    const schemaResult = resolveImpacts({ requestText: 'add a new column', modulePaths: [] });
    expect(schemaResult.database_impact).toBe('schema-change');

    const tableResult = resolveImpacts({ requestText: 'create a new table', modulePaths: [] });
    expect(tableResult.database_impact).toBe('schema-change');
  });

  it('sets customer_facing_impact to internal when no UI impact and no customer keyword', () => {
    const result = resolveImpacts({
      requestText: 'refactor internal service',
      modulePaths: [],
    });
    expect(result.customer_facing_impact).toBe('internal');
  });
});
