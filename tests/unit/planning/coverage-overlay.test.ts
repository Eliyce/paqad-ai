import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCoverageOverlay, markCriteriaFromOverlay } from '@/planning/coverage-overlay.js';
import { buildRegressionWatchList } from '@/planning/regression-detector.js';

import { createManifest } from './fixtures.js';

describe('coverage overlay and regression detector', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'planning-overlay-'));
    mkdirSync(join(root, 'tests/unit/planning'), { recursive: true });
    mkdirSync(join(root, 'src/planning'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('builds overlay evidence and marks criteria as covered, partial, or uncovered', async () => {
    writeFileSync(
      join(root, 'tests/unit/planning/covered.test.ts'),
      "it('covered', () => { /* @obligation AC-1 */ });\n",
    );
    writeFileSync(
      join(root, 'tests/unit/planning/covered-duplicate.test.ts'),
      "it('covered again', () => { /* @obligation AC-1 */ });\n",
    );
    writeFileSync(
      join(root, 'tests/unit/planning/generated.test.ts'),
      "it('partial', () => {});\n",
    );
    writeFileSync(join(root, 'tests/unit/planning/alpha.test.ts'), "it('alpha', () => {});\n");

    const overlay = await buildCoverageOverlay(root, []);
    expect(overlay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterion_id: 'AC-1', status: 'covered' }),
      ]),
    );

    const criteria = markCriteriaFromOverlay(
      [
        ...createManifest().verification_matrix,
        {
          criterion_id: 'AC-2',
          given: 'g',
          when: 'w',
          then: 't',
          proof_type: 'automated',
          proof_target: 'tests/unit/planning/generated.test.ts',
          status: 'uncovered',
          source: 'planned',
          linked_requirement_ids: ['FR-1'],
        },
        {
          criterion_id: 'AC-3',
          given: 'g',
          when: 'w',
          then: 't',
          proof_type: 'manual',
          status: 'uncovered',
          source: 'planned',
          linked_requirement_ids: ['FR-1'],
        },
        {
          criterion_id: 'GENERATED',
          given: 'g',
          when: 'w',
          then: 't',
          proof_type: 'manual',
          status: undefined as never,
          source: 'planned',
          linked_requirement_ids: ['FR-1'],
        },
        {
          criterion_id: 'alpha',
          given: 'g',
          when: 'w',
          then: 't',
          proof_type: 'manual',
          status: 'uncovered',
          source: 'planned',
          linked_requirement_ids: ['FR-1'],
        },
        {
          criterion_id: 'AC-NONE',
          given: 'g',
          when: 'w',
          then: 't',
          proof_type: 'manual',
          status: undefined as never,
          source: 'planned',
          linked_requirement_ids: ['FR-1'],
        },
      ],
      overlay,
    );

    expect(criteria.map((criterion) => criterion.status)).toEqual([
      'covered',
      'partial',
      'uncovered',
      'partial',
      'partial',
      'uncovered',
    ]);
  });

  it('builds a regression watch list from touched files', async () => {
    writeFileSync(join(root, 'src/planning/index.ts'), 'export const planning = true;\n');
    writeFileSync(
      join(root, 'tests/unit/planning/index.test.ts'),
      "import '@/planning/index.js';\nit('uses planning', () => {});\n",
    );

    await expect(
      buildRegressionWatchList(root, createManifest().execution_slices),
    ).resolves.toEqual([
      expect.objectContaining({
        test_file: 'tests/unit/planning/index.test.ts',
        touched_file: 'src/planning/index.ts',
      }),
    ]);

    await expect(
      buildRegressionWatchList(root, [
        { ...createManifest().execution_slices[0], touches: ['src/planning/missing.ts'] },
      ]),
    ).resolves.toEqual([]);
  });

  it('filters non-test files by module name when building overlay', async () => {
    mkdirSync(join(root, 'src/other'), { recursive: true });
    writeFileSync(join(root, 'src/other/helper.test.ts'), '/* @obligation AC-9 */\n');
    writeFileSync(
      join(root, 'tests/unit/planning/module-filter.test.ts'),
      '/* @obligation AC-10 */\n',
    );

    const overlay = await buildCoverageOverlay(root, ['planning']);
    expect(overlay).toEqual(
      expect.arrayContaining([expect.objectContaining({ criterion_id: 'AC-10' })]),
    );
    expect(overlay).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ criterion_id: 'AC-9' })]),
    );
  });
});
