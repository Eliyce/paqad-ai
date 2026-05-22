import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendCostEntry, predictTokenCeiling, readCostLog } from '@/planning/cost-predictor.js';

describe('cost-predictor', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'planning-costs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses default ceilings when insufficient history exists', async () => {
    await expect(
      predictTokenCeiling(root, {
        lane: 'graduated',
        complexity: 'medium',
        scope: 'single-module',
      }),
    ).resolves.toBe(1800);
  });

  it('uses p75 plus buffer and persists cost entries', async () => {
    for (const actualTokens of [800, 1000, 1200, 1600]) {
      await appendCostEntry(root, {
        slug: `entry-${actualTokens}`,
        timestamp: '2026-04-10T00:00:00.000Z',
        classification: {
          complexity: 'medium',
          risk: 'low',
          lane: 'graduated',
          scope: 'single-module',
          affected_module_count: 1,
        },
        predicted_tokens: 1000,
        actual_tokens: actualTokens,
        slice_count: 1,
        criterion_count: 1,
        auto_injected_count: 0,
      });
    }

    await expect(readCostLog(root)).resolves.toMatchObject({ entries: expect.any(Array) });
    await expect(
      predictTokenCeiling(root, {
        lane: 'graduated',
        complexity: 'medium',
        scope: 'single-module',
      }),
    ).resolves.toBe(1440);

    await expect(
      predictTokenCeiling(root, {
        lane: 'graduated',
        complexity: 'medium',
      }),
    ).resolves.toBe(1800);

    await appendCostEntry(root, {
      slug: 'unknown-scope',
      timestamp: '2026-04-10T00:00:00.000Z',
      classification: {
        complexity: 'medium',
        risk: 'low',
        lane: 'graduated',
        affected_module_count: 1,
      },
      predicted_tokens: 1000,
      actual_tokens: 900,
      slice_count: 1,
      criterion_count: 1,
      auto_injected_count: 0,
    });
    await expect(
      predictTokenCeiling(root, {
        lane: 'graduated',
        complexity: 'medium',
      }),
    ).resolves.toBe(1800);
  });
});
