import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gatherTraceabilityInputs } from '@/traceability/inputs.js';
import { buildTraceabilityMap } from '@/traceability/map-builder.js';

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
    // Reality: a feature file marked with @ac AC-1 that imports a shared util,
    // plus a genuinely dead file imported by nothing.
    write('src/feature.ts', `// @ac AC-1\nimport './shared-util.js';\nexport const f = 1;\n`);
    write('src/shared-util.ts', `export const u = 2;\n`);
    write('src/dead.ts', `// this is fine\nexport const d = 3;\n`);

    // A compliance report supplies the promise + its proving check (reused, not
    // re-derived).
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
    // The "this is fine" comment in dead.ts does not save it.
    expect(
      map.findings.some((f) => f.code === 'TR-CODE-ORPHAN' && f.paths[0] === 'src/dead.ts'),
    ).toBe(true);
  });

  it('folds verification-evidence ac_id into the proof index', async () => {
    write('src/feature.ts', `// @ac AC-7\nexport const f = 1;\n`);
    write(
      '.paqad/session/verification-evidence.json',
      JSON.stringify({
        schema_version: '1.1.0',
        gates: [
          {
            name: 'tests',
            status: 'fail',
            failures: [{ ac_id: 'AC-7', file: 'tests/feature.test.ts', message: 'x' }],
          },
        ],
      }),
    );

    const input = await gatherTraceabilityInputs({ projectRoot: root, lane: 'full' });
    expect(input.proofs).toContainEqual({ promise_id: 'AC-7', checks: ['gate:tests'] });
  });
});
