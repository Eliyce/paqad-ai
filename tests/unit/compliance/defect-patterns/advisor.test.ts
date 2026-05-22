import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildPatternAdvisories,
  formatAgentContextWarnings,
} from '@/compliance/defect-patterns/advisor.js';
import { recordFindings } from '@/compliance/defect-patterns/store.js';
import type { DefectFinding } from '@/compliance/defect-patterns/types.js';

async function tempStore(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'paqad-adv-'));
}

function makeFinding(sub: string, frequency = 4): DefectFinding[] {
  return Array.from({ length: frequency }, () => ({
    defect_id: `spec.md:FR-1-T1`,
    source: 'compliance' as const,
    category: 'D5',
    subcategory: sub,
    spec_file: 'docs/spec.md',
    obligation_id: 'FR-1-T1',
    stack_context: { frameworks: ['react'], traits: [] },
    description: `Recurring issue: ${sub}`,
    file_path: null,
    recorded_at: new Date().toISOString(),
    resolved: false,
    recurrence_count: 1,
  }));
}

describe('buildPatternAdvisories', () => {
  it('returns advisories for qualifying patterns (FR-DP4-T1)', async () => {
    const root = await tempStore();
    await recordFindings(makeFinding('D5.missing-boundary'), root);
    const advisories = await buildPatternAdvisories({ min_frequency: 3, storeRoot: root });
    expect(advisories).toHaveLength(1);
    expect(advisories[0]!.advisory_id).toMatch(/^PA-/);
    expect(advisories[0]!.title).toContain('D5.missing-boundary');
    expect(advisories[0]!.description).toContain('4 prior defects');
  });

  it('uses singular "defect" when frequency is 1', async () => {
    const root = await tempStore();
    await recordFindings(makeFinding('D5.missing-boundary', 1), root);
    const advisories = await buildPatternAdvisories({ min_frequency: 1, storeRoot: root });
    expect(advisories[0]!.description).toContain('1 prior defect,');
  });

  it('excludes low-frequency patterns (FR-DP4-T2)', async () => {
    const root = await tempStore();
    await recordFindings(makeFinding('D5.missing-boundary', 1), root);
    const advisories = await buildPatternAdvisories({ min_frequency: 3, storeRoot: root });
    expect(advisories).toHaveLength(0);
  });

  it('returns empty array when store is empty (EC-DP1-T1)', async () => {
    const root = await tempStore();
    const advisories = await buildPatternAdvisories({ storeRoot: root });
    expect(advisories).toHaveLength(0);
  });
});

describe('formatAgentContextWarnings', () => {
  it('returns a formatted warning block for qualifying patterns (FR-DP5-T1)', async () => {
    const root = await tempStore();
    await recordFindings(makeFinding('D5.missing-boundary'), root);
    const block = await formatAgentContextWarnings({ min_frequency: 3, storeRoot: root });
    expect(block).toContain('Common defect patterns');
    expect(block).toContain('D5.missing-boundary');
    expect(block).toContain('Pay specific attention');
  });

  it('returns an empty string when no patterns qualify (EC-DP1-T1)', async () => {
    const root = await tempStore();
    const block = await formatAgentContextWarnings({ min_frequency: 3, storeRoot: root });
    expect(block).toBe('');
  });

  it('caps output at 5 patterns (FR-DP5-T2)', async () => {
    const root = await tempStore();
    const subcats = [
      'D5.missing-boundary',
      'D5.missing-cli-surface',
      'D5.missing-error-handling',
      'D5.missing-empty-case',
      'D5.missing-enum-variant',
      'D5.wrong-file-path',
    ];
    for (const sub of subcats) {
      await recordFindings(makeFinding(sub), root);
    }
    const block = await formatAgentContextWarnings({ min_frequency: 1, storeRoot: root });
    const bulletCount = (block.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBeLessThanOrEqual(5);
  });

  it('filters by stack context — Go patterns excluded from React query (FR-DP5-T5)', async () => {
    const root = await tempStore();
    const goFindings = makeFinding('D5.missing-boundary').map((f) => ({
      ...f,
      stack_context: { frameworks: ['go'], traits: [] },
    }));
    await recordFindings(goFindings, root);

    const block = await formatAgentContextWarnings({
      min_frequency: 1,
      stack_context: { frameworks: ['react'], traits: [] },
      storeRoot: root,
    });
    expect(block).toBe('');
  });
});
