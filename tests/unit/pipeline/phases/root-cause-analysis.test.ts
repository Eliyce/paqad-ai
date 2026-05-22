import { describe, expect, it } from 'vitest';

import { RootCauseAnalysisPhase } from '@/pipeline/phases/root-cause-analysis.js';

describe('RootCauseAnalysisPhase', () => {
  it('no-ops when the workflow is not root-cause-analysis', async () => {
    const result = await new RootCauseAnalysisPhase().execute({
      project_root: '/tmp/demo',
      lane: 'fast',
      classification: {
        request_text: 'Implement a billing change',
        domain: 'coding',
        stack: 'laravel',
        workflow: 'feature-development',
        complexity: 'low',
        risk: 'low',
        scope: 'single-module',
        affected_modules: ['billing'],
        process_depth: 'fast lane',
        certainty: 'well-defined',
        output_type: 'code',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
      started_at: new Date().toISOString(),
      phases: [],
    });

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('No RCA workflow requested');
  });
});
