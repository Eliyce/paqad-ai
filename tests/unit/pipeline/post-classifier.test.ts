import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { queryPatterns } from '@/compliance/defect-patterns/store.js';
import { PostClassifier } from '@/pipeline/post-classifier.js';

vi.mock('@/compliance/defect-patterns/store.js', async () => {
  const actual = await vi.importActual<typeof import('@/compliance/defect-patterns/store.js')>(
    '@/compliance/defect-patterns/store.js',
  );
  return { ...actual, queryPatterns: vi.fn() };
});

describe('PostClassifier', () => {
  it('raises risk from fragile health and defect floors, adjusts complexity from history, and writes history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-post-'));
    mkdirSync(join(root, '.paqad/module-health/src/components'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/module-health/src/components/Button.json'),
      JSON.stringify({
        module: 'src/components/Button',
        tier: 'fragile',
        metrics: { defect_frequency: 11 },
        updated_at: new Date().toISOString(),
      }),
    );
    mkdirSync(join(root, '.paqad/specs'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/specs/a.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 50, unplanned_files: ['src/components/Button'] }),
    );
    writeFileSync(
      join(root, '.paqad/specs/b.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 60, unplanned_files: ['src/components/Button'] }),
    );
    writeFileSync(
      join(root, '.paqad/specs/c.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 40, unplanned_files: ['src/components/Button'] }),
    );
    vi.mocked(queryPatterns).mockResolvedValue([
      {
        pattern_id: 'p1',
        subcategory: 'bug',
        description: 'repeat',
        frequency: 12,
        recency: new Date().toISOString(),
        stack_contexts: [],
        example_obligations: [],
        example_files: ['src/components/Button.tsx'],
        severity_distribution: { critical: 0, major: 0, minor: 0, info: 0 },
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        stale: false,
      },
    ] as never);

    const resolutionMap = {
      workflow: 'llm-overridden',
      scope: 'llm-overridden',
      risk: 'llm-guessed',
    } as never;
    const result = await new PostClassifier(root).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'feature-development',
        workflow_source: 'routing-skill',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: ['src/components/Button'],
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
      {} as never,
      resolutionMap,
    );

    expect(result.risk).toBe('high');
    expect(result.risk_floor).toBe('high');
    expect(result.complexity).toBe('medium');
    expect(result.complexity_adjustment).toBe(1);
    expect(result.lane_override_reason).toContain('fragile');
    expect(result.high_override_rate).toBe(true);
  });

  it('floors risk to medium when defect frequency is between 6 and 10 (frequency>5 branch)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-post-freq5-'));
    vi.mocked(queryPatterns).mockResolvedValue([
      {
        pattern_id: 'p1',
        subcategory: 'bug',
        description: 'moderate frequency',
        frequency: 7, // >5 but ≤10 → medium floor
        recency: new Date().toISOString(),
        stack_contexts: [],
        example_obligations: [],
        example_files: ['src/api/handler.ts'],
        severity_distribution: { critical: 0, major: 0, minor: 0, info: 0 },
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        stale: false,
      },
    ] as never);

    const result = await new PostClassifier(root).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'bug-fix',
        workflow_source: 'routing-skill',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: ['src/api/handler'],
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
      {} as never,
      {} as never,
    );

    expect(result.risk_floor).toBe('medium');
    expect(result.risk_floor_reason).toContain('5 relevant recurrences');
  });

  it('returns null risk floor when affected_modules is empty (inner some short-circuits)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-post-empty-'));
    vi.mocked(queryPatterns).mockResolvedValue([
      {
        pattern_id: 'p1',
        subcategory: 'bug',
        description: 'some pattern',
        frequency: 8,
        recency: new Date().toISOString(),
        stack_contexts: [],
        example_obligations: [],
        example_files: ['src/api/handler.ts'],
        severity_distribution: { critical: 0, major: 0, minor: 0, info: 0 },
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        stale: false,
      },
    ] as never);

    const result = await new PostClassifier(root).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'bug-fix',
        workflow_source: 'routing-skill',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: [], // empty → inner affectedModules.some() short-circuits to false
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
      {} as never,
      {} as never,
    );

    expect(result.risk_floor).toBeNull();
  });

  it('keeps defaults when no signals are available', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-post-'));
    vi.mocked(queryPatterns).mockResolvedValue([]);
    const result = await new PostClassifier(root).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'cleanup',
        workflow_source: 'routing-skill',
        complexity: 'trivial',
        risk: 'low',
        scope: 'single-file',
        affected_modules: ['src/components/Button'],
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
      {} as never,
      {} as never,
    );

    expect(result.risk).toBe('low');
    expect(result.risk_floor).toBeNull();
    expect(result.complexity_adjustment).toBe(0);
  });

  it('returns null risk floor when patterns exist but no affected modules match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-post-nomatch-'));
    vi.mocked(queryPatterns).mockResolvedValue([
      {
        pattern_id: 'p1',
        subcategory: 'bug',
        description: 'unrelated',
        frequency: 8,
        recency: new Date().toISOString(),
        stack_contexts: [],
        example_obligations: [],
        example_files: ['src/completely/different/path.ts'],
        severity_distribution: { critical: 0, major: 0, minor: 0, info: 0 },
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        stale: false,
      },
    ] as never);

    const result = await new PostClassifier(root).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'bug-fix',
        workflow_source: 'routing-skill',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: ['src/api/unrelated'],
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
      {} as never,
      {} as never,
    );

    // pattern's example_files don't include our affected modules → frequency 0 → no floor
    expect(result.risk_floor).toBeNull();
  });

  it('treats queryPatterns rejection as zero defect stats (catch branch)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-post-catch-'));
    vi.mocked(queryPatterns).mockRejectedValue(new Error('store unavailable'));

    const result = await new PostClassifier(root).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'bug-fix',
        workflow_source: 'routing-skill',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: ['src/api/handler'],
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
      {} as never,
      {} as never,
    );

    // queryPatterns threw → defect stats zeroed → no risk floor applied
    expect(result.risk_floor).toBeNull();
  });

  it('floors risk to medium when more than 3 open defect patterns match (matchCount>3 branch)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-post-open-'));
    // 4 matching patterns with low individual frequency (≤5) — triggers matchCount>3 floor
    vi.mocked(queryPatterns).mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({
        pattern_id: `p${i}`,
        subcategory: 'bug',
        description: `pattern ${i}`,
        frequency: 2,
        recency: new Date().toISOString(),
        stack_contexts: [],
        example_obligations: [],
        example_files: ['src/api/handler.ts'],
        severity_distribution: { critical: 0, major: 0, minor: 0, info: 0 },
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        stale: false,
      })) as never,
    );

    const result = await new PostClassifier(root).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'bug-fix',
        workflow_source: 'routing-skill',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: ['src/api/handler'],
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
      {} as never,
      {} as never,
    );

    expect(result.risk).toBe('medium');
    expect(result.risk_floor).toBe('medium');
    expect(result.risk_floor_reason).toContain('open defect patterns');
  });
});
