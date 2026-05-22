import { vi } from 'vitest';

vi.mock('@/planning/coverage-overlay.js', () => ({
  buildCoverageOverlay: vi
    .fn()
    .mockResolvedValue([
      { criterion_id: 'AC-1', status: 'covered', evidence_files: ['tests/a.test.ts'] },
    ]),
}));

vi.mock('@/planning/defect-advisory.js', () => ({
  queryMatchingDefectPatterns: vi.fn().mockResolvedValue([
    {
      pattern_id: 'DP-1',
      subcategory: 'missing-tests',
      description: 'Missing tests',
      frequency: 3,
    },
  ]),
}));

vi.mock('@/planning/cost-predictor.js', () => ({
  predictTokenCeiling: vi.fn().mockResolvedValue(900),
}));

vi.mock('@/planning/module-health.js', () => ({
  readAllModuleHealth: vi.fn().mockResolvedValue([
    {
      module: 'planning',
      tier: 'stable',
      metrics: {},
      updated_at: '2026-04-10T00:00:00.000Z',
    },
  ]),
}));

vi.mock('@/planning/rule-compiler.js', () => ({
  readCompiledRules: vi.fn().mockResolvedValue({
    schema_version: 1,
    generated_at: '2026-04-10T00:00:00.000Z',
    source_hash: 'sha256:test',
    rules: [],
  }),
}));

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assembleIntelligence } from '@/planning/intelligence-assembler.js';

describe('intelligence-assembler', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'planning-intelligence-'));
    mkdirSync(join(root, 'docs/modules/planning'), { recursive: true });
    mkdirSync(join(root, 'src/planning'), { recursive: true });
    writeFileSync(join(root, 'docs/modules/planning/technical.md'), '# Planning\n');
    writeFileSync(join(root, 'src/planning/index.ts'), 'export const planning = true;\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('assembles intelligence context from parallel sources', async () => {
    const result = await assembleIntelligence(root, {
      workflow: 'feature-development',
      complexity: 'medium',
      risk: 'low',
      lane: 'graduated',
      domain: 'coding',
      stack: 'node-cli',
      scope: 'single-module',
      affected_modules: ['planning'],
      affected_module_count: 1,
    });

    expect(result).toMatchObject({
      predicted_tokens: 900,
      module_health: [expect.objectContaining({ module: 'planning' })],
      coverage_overlay: [expect.objectContaining({ criterion_id: 'AC-1' })],
      defect_patterns: [expect.objectContaining({ pattern_id: 'DP-1' })],
    });
    expect(result.selective_docs[0]?.path).toBe('docs/modules/planning/technical.md');
    expect(result.existing_implementations[0]?.file_path).toBe('src/planning/index.ts');
  });

  it('falls back to broad doc and implementation search when modules are empty', async () => {
    mkdirSync(join(root, 'docs/instructions'), { recursive: true });
    mkdirSync(join(root, 'src/shared'), { recursive: true });
    writeFileSync(join(root, 'docs/instructions/overview.md'), '# Overview\n');
    writeFileSync(join(root, 'src/shared/helper.ts'), 'export const helper = true;\n');

    const result = await assembleIntelligence(root, {
      workflow: 'feature-development',
      complexity: 'medium',
      risk: 'low',
      lane: 'graduated',
      domain: 'coding',
      stack: 'node-cli',
      scope: 'single-module',
      affected_modules: [],
      affected_module_count: 0,
    });

    expect(result.selective_docs[0]?.path).toBe('docs/instructions/overview.md');
    expect(result.existing_implementations).toEqual(
      expect.arrayContaining([expect.objectContaining({ file_path: 'src/shared/helper.ts' })]),
    );
  });
});
