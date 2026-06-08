import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TraceabilityPhase } from '@/pipeline/phases/traceability.js';
import { traceabilityMapPath } from '@/traceability/writer.js';
import type { PhaseExecutor } from '@/pipeline/phases/phase.interface.js';
import type { PhaseResult, PipelineRunContext } from '@/core/types/pipeline.js';
import type { Lane } from '@/core/types/routing.js';

class StubInner implements PhaseExecutor {
  readonly phase = 'documentation-update' as const;
  constructor(private readonly result: PhaseResult) {}
  async execute(): Promise<PhaseResult> {
    return this.result;
  }
}

function pass(summary = 'Canonical docs updated'): PhaseResult {
  return { phase: 'documentation-update', status: 'pass', summary, artifacts: ['handoff:1'] };
}

function context(root: string, lane: Lane = 'graduated'): PipelineRunContext {
  return {
    project_root: root,
    lane,
    phases: [],
    started_at: '2026-06-08T00:00:00.000Z',
    feature_policy: null,
    policy_warnings: [],
  } as unknown as PipelineRunContext;
}

describe('TraceabilityPhase', () => {
  let root: string;

  function write(rel: string, contents: string): void {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-traceability-phase-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('inherits the wrapped phase name', () => {
    const phase = new TraceabilityPhase(new StubInner(pass()));
    expect(phase.phase).toBe('documentation-update');
  });

  it('is transparent on a clean run and still writes the map', async () => {
    const phase = new TraceabilityPhase(new StubInner(pass()));
    const result = await phase.execute(context(root));

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('Canonical docs updated');
    expect(existsSync(traceabilityMapPath(root))).toBe(true);
  });

  it('downgrades to a warning (non-blocking) when traceability flags something', async () => {
    write('src/feature.ts', `// @ac AC-1\nexport const f = 1;\n`);
    write('src/dead.ts', `export const d = 2;\n`);
    write(
      '.paqad/compliance/spec/report.json',
      JSON.stringify({
        metadata: { spec_file: 'docs/spec.md', schema_version: 1 },
        summary: {},
        obligations: [
          {
            obligation_id: 'AC-1',
            description: 'feature',
            evidence: ['tests/feature.test.ts'],
            state: 'covered',
          },
        ],
        uncovered_obligations: [],
      }),
    );

    const phase = new TraceabilityPhase(new StubInner(pass()));
    const result = await phase.execute(context(root, 'full'));

    expect(result.status).toBe('warning');
    expect(result.summary).toContain('orphan code file');
    expect(result.artifacts).toContain('.paqad/traceability/map.json');
  });

  it('returns a failing host result unchanged', async () => {
    const failResult: PhaseResult = {
      phase: 'documentation-update',
      status: 'fail',
      summary: 'doc sync blocked',
      artifacts: ['handoff:1'],
    };
    const phase = new TraceabilityPhase(new StubInner(failResult));
    const result = await phase.execute(context(root));

    expect(result).toEqual(failResult);
  });
});
