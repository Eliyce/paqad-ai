import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gatherTraceabilityInputs } from '@/traceability/inputs.js';
import { buildTraceabilityMap } from '@/traceability/map-builder.js';

import { seedGitChangedFiles, writeChangedFilesCache } from '../pipeline/changed-files.fixture.js';

describe('gatherTraceabilityInputs — rebuilt from reality', () => {
  let root: string;

  function write(rel: string, contents: string): void {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-traceability-inputs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('joins source markers, the import graph, and compliance reports into a map', async () => {
    write('src/feature.ts', `// @ac AC-1\nimport './shared-util.js';\nexport const f = 1;\n`);
    write('src/shared-util.ts', `export const u = 2;\n`);
    write('src/dead.ts', `// this is fine\nexport const d = 3;\n`);

    write(
      '.paqad/compliance/spec/report.json',
      JSON.stringify({
        metadata: { spec_file: 'docs/spec.md', schema_version: 1 },
        summary: {},
        obligations: [
          {
            obligation_id: 'AC-1',
            description: 'the feature works',
            evidence: ['tests/feature.test.ts'],
            state: 'covered',
          },
        ],
        uncovered_obligations: [],
      }),
    );

    const input = await gatherTraceabilityInputs({ projectRoot: root, lane: 'full' });

    expect(input.promises.map((p) => p.promise_id)).toContain('AC-1');
    expect(input.proofs).toContainEqual({ promise_id: 'AC-1', checks: ['tests/feature.test.ts'] });
    expect(input.markers).toContainEqual({ file: 'src/feature.ts', promise_ids: ['AC-1'] });
    expect(input.edges).toContainEqual({ from: 'src/feature.ts', to: 'src/shared-util.ts' });

    const map = buildTraceabilityMap(input);
    const roles = Object.fromEntries(map.backward.map((b) => [b.file, b.role]));
    expect(roles['src/feature.ts']).toBe('delivers-promise');
    expect(roles['src/shared-util.ts']).toBe('shared-groundwork');
    expect(roles['src/dead.ts']).toBe('orphan');
    expect(
      map.findings.some((f) => f.code === 'TR-CODE-ORPHAN' && f.paths[0] === 'src/dead.ts'),
    ).toBe(true);
  });

  it('AC-35: never counts a failing gate ac_id as a proof, and takes away the proof it had', async () => {
    write('src/feature.ts', `// @ac AC-7\nexport const f = 1;\n`);
    write(
      '.paqad/compliance/spec/report.json',
      JSON.stringify({
        obligations: [
          { obligation_id: 'AC-7', description: 'x', evidence: ['tests/feature.test.ts'] },
          { obligation_id: 'AC-8', description: 'y', evidence: ['tests/other.test.ts'] },
        ],
      }),
    );
    write(
      '.paqad/session/verification-evidence.json',
      JSON.stringify({
        schema_version: '1.1.0',
        gates: [
          {
            name: 'tests',
            status: 'fail',
            failures: [
              { ac_id: 'AC-7', file: 'tests/feature.test.ts', message: 'x' },
              { ac_id: null, file: 'tests/feature.test.ts', message: 'no id' },
            ],
          },
          { name: 'lint', status: 'pass' },
        ],
      }),
    );

    const input = await gatherTraceabilityInputs({ projectRoot: root, lane: 'full' });
    expect(input.proofs.find((proof) => proof.promise_id === 'AC-7')).toBeUndefined();
    expect(input.proofs.some((proof) => proof.checks.includes('gate:tests'))).toBe(false);
    expect(input.proofs).toContainEqual({ promise_id: 'AC-8', checks: ['tests/other.test.ts'] });
  });

  it('ignores corrupt or gate-less verification evidence', async () => {
    write('src/feature.ts', 'export const f = 1;\n');
    write('.paqad/session/verification-evidence.json', '{not json');
    expect((await gatherTraceabilityInputs({ projectRoot: root, lane: 'full' })).proofs).toEqual(
      [],
    );
    write('.paqad/session/verification-evidence.json', JSON.stringify({ gates: 'nope' }));
    expect((await gatherTraceabilityInputs({ projectRoot: root, lane: 'full' })).proofs).toEqual(
      [],
    );
  });

  it('reads changed files from git and ignores a leftover session cache', async () => {
    write('src/base.ts', 'export const b = 1;\n');
    write('src/edited.ts', 'export const e = 1;\n');
    seedGitChangedFiles(root, ['src/edited.ts']);
    writeChangedFilesCache(root, ['src/base.ts']);

    const input = await gatherTraceabilityInputs({ projectRoot: root, lane: 'graduated' });
    expect(input.changedFiles).toEqual(['src/edited.ts']);
  });

  it('has no changed files on a clean tree with no branch commits', async () => {
    write('src/base.ts', 'export const b = 1;\n');
    seedGitChangedFiles(root, []);

    const input = await gatherTraceabilityInputs({ projectRoot: root, lane: 'graduated' });
    expect(input.changedFiles).toEqual([]);
  });
});
