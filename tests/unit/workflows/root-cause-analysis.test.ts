import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RootCauseAnalysisWorkflow } from '@/workflows/root-cause-analysis.js';

describe('RootCauseAnalysisWorkflow', () => {
  it('creates a canonical RCA file with the required sections in order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-rca-'));
    const result = await new RootCauseAnalysisWorkflow().run({
      projectRoot: root,
      classification: {
        request_text: 'Run a root cause analysis for API timeout spikes',
        domain: 'coding',
        stack: 'laravel',
        workflow: 'root-cause-analysis',
        complexity: 'medium',
        risk: 'medium',
        scope: 'system-wide',
        affected_modules: ['billing'],
        process_depth: 'graduated lane',
        certainty: 'well-defined',
        output_type: 'report',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
    });

    expect(result.output_path).toMatch(
      /^docs\/rca\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-run-a-root-cause-analysis-for-api-timeout-spikes\.md$/,
    );

    const content = readFileSync(join(root, result.output_path), 'utf8');
    expect(content).toMatch(
      /# Run a root cause analysis for API timeout spikes[\s\S]*## Summary[\s\S]*## Problem Statement[\s\S]*## Impact[\s\S]*## Symptoms[\s\S]*## Timeline[\s\S]*## Root Cause[\s\S]*## Contributing Factors[\s\S]*## Evidence[\s\S]*## Solution[\s\S]*## Verification[\s\S]*## Follow-Up Actions/,
    );
    expect(content).toContain('## Solution');
  });

  it('falls back to the default slug when the request title slugifies to empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-rca-'));
    const result = await new RootCauseAnalysisWorkflow().run({
      projectRoot: root,
      classification: {
        request_text: '!!!',
        domain: 'coding',
        stack: 'laravel',
        workflow: 'root-cause-analysis',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: [],
        process_depth: 'fast lane',
        certainty: 'well-defined',
        output_type: 'report',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
    });

    expect(result.output_path).toMatch(
      /^docs\/rca\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-root-cause-analysis\.md$/,
    );
  });

  it('uses the default title when the request text is blank', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-rca-'));
    const result = await new RootCauseAnalysisWorkflow().run({
      projectRoot: root,
      classification: {
        request_text: '   ',
        domain: 'coding',
        stack: 'laravel',
        workflow: 'root-cause-analysis',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: [],
        process_depth: 'fast lane',
        certainty: 'well-defined',
        output_type: 'report',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
    });

    expect(result.title).toBe('Root Cause Analysis');
    expect(readFileSync(join(root, result.output_path), 'utf8')).toContain('# Root Cause Analysis');
  });
});
