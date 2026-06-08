import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { SliceExecutor } from '@/planning/index.js';

import { createManifest } from './fixtures.js';

/**
 * Issue #104 AC: on graduated/full, each slice is taken fully through its checks
 * before the next one starts. This records the interleaving of executeSlice and
 * the gate's full-suite run across two dependent slices and asserts the strict
 * one-at-a-time ordering.
 */
describe('slice sequencing (issue #104)', () => {
  it('takes each slice fully through its checks before the next begins', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-sequencing-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      const manifest = createManifest({
        slug: 'sequencing-manifest',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-1',
            touches: ['src/planning/one.ts'],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            depends_on: ['SL-1'],
            touches: ['src/planning/two.ts'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/sequencing-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const events: string[] = [];
      let currentSliceId = '';

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: async ({ context }) => {
          currentSliceId = context.current_slice.slice_id;
          events.push(`execute:${currentSliceId}`);
          writeFileSync(join(root, context.current_slice.touches[0]!), 'export const ok = true;\n');
          return { tokens_used: 10, files_changed: [context.current_slice.touches[0]!] };
        },
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => {
          events.push(`gate:${currentSliceId}`);
          return { total_tests: 1, passing: 1, failing: 0, failing_tests: [], duration_ms: 1 };
        },
      });

      expect(result.completedSliceIds).toEqual(['SL-1', 'SL-2']);
      // SL-1 must be built AND checked before SL-2 is ever started.
      expect(events).toEqual(['execute:SL-1', 'gate:SL-1', 'execute:SL-2', 'gate:SL-2']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
