import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

import { createManifest } from './fixtures.js';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/planning/slice-budget.js');
});

describe('SliceExecutor budget fallback', () => {
  it('uses the buffered summary budget when a per-slice entry is unavailable', async () => {
    vi.doMock('@/planning/slice-budget.js', async () => {
      const actual = await vi.importActual<typeof import('@/planning/slice-budget.js')>(
        '@/planning/slice-budget.js',
      );
      return {
        ...actual,
        computeSliceBudgetPlan: vi.fn(() => ({
          perSlice: {},
          summary: {
            total: 10_000,
            per_slice_base: 5_000,
            per_slice_with_buffer: 6_500,
            consumed: 0,
            remaining: 10_000,
          },
          warnings: [],
        })),
      };
    });

    const { SliceExecutor } = await import('@/planning/slice-executor.js');

    const root = mkdtempSync(join(tmpdir(), 'slice-budget-fallback-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      const manifest = createManifest({
        slug: 'budget-fallback',
        execution_slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-1' }],
      });
      writeFileSync(
        join(root, '.paqad/specs', `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const prepared = await new SliceExecutor().prepare(root, manifest.slug);
      expect(prepared.currentSliceId).toBe('SL-1');
      expect(prepared.context?.token_budget).toBe(6500);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
