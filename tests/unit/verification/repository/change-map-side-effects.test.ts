import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangeTraceabilityBuild } from '@/traceability/index.js';
import { buildRepositoryVerificationContext } from '@/verification/repository/repository-context.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { seedGitChangedFiles } from '../../pipeline/changed-files.fixture.js';
import { openChange, writeSpec } from '../../traceability/change-map.fixture.js';

const mode: { build: 'real' | 'absent' | 'fails' } = { build: 'real' };

vi.mock('@/traceability/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/traceability/index.js')>();
  return {
    ...actual,
    buildAndWriteChangeTraceabilityMap: async (
      ...args: Parameters<typeof actual.buildAndWriteChangeTraceabilityMap>
    ): Promise<ChangeTraceabilityBuild> => {
      if (mode.build === 'absent') return { result: null, error: null };
      if (mode.build === 'fails') return { result: null, error: 'could not read the spec' };
      return actual.buildAndWriteChangeTraceabilityMap(...args);
    },
  };
});

const roots: string[] = [];
let priorSession: string | undefined;

beforeEach(() => {
  priorSession = process.env.CLAUDE_SESSION_ID;
  mode.build = 'real';
});

afterEach(() => {
  if (priorSession === undefined) delete process.env.CLAUDE_SESSION_ID;
  else process.env.CLAUDE_SESSION_ID = priorSession;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function cleanChange(session: string): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-ac-side-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  const files: Record<string, string> = {
    'src/export/csv.ts': 'export const toCsv = (rows: string[]) => rows.join(",");\n',
    'tests/export/csv.test.ts':
      "describe('CSV export', () => {\n  it('AC-1 joins rows', () => {});\n  it('AC-2 keeps order', () => {});\n});\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  seedGitChangedFiles(root, Object.keys(files));
  const dir = openChange(root, session);
  writeSpec(root, dir, [
    { id: 'AC-1', proof: 'automated' },
    { id: 'AC-2', proof: 'automated' },
    { id: 'AC-3', proof: 'visual' },
  ]);
  process.env.CLAUDE_SESSION_ID = session;
  return root;
}

async function stopRun(root: string) {
  const built = await buildRepositoryVerificationContext({
    projectRoot: root,
    origin: 'hook-completion',
  });
  const verdict = await runRepositoryVerification({
    projectRoot: root,
    origin: 'hook-completion',
    prebuiltContext: built,
  });
  return { ...built, verdict };
}

function headline(summary: string): string {
  return summary.split('\n')[0]!;
}

function deadCode(context: Awaited<ReturnType<typeof stopRun>>['context']) {
  return context.quality_ratchet_result?.verdicts.filter((v) => v.measure === 'dead_code');
}

describe('change map side effects on the other map readers', () => {
  it('a clean frozen-spec change keeps its verdict word; only ac-test-mapping moves', async () => {
    mode.build = 'absent';
    const before = await stopRun(cleanChange('ses-before'));
    mode.build = 'real';
    const after = await stopRun(cleanChange('ses-after'));

    expect(headline(after.verdict.summary)).toBe(headline(before.verdict.summary));
    expect(after.verdict.ok).toBe(before.verdict.ok);

    const acBefore = before.verdict.gates.find((g) => g.gate === 'ac-test-mapping');
    const acAfter = after.verdict.gates.find((g) => g.gate === 'ac-test-mapping');
    expect(acBefore).toMatchObject({ status: 'skipped', skip_kind: 'not-required' });
    expect(acAfter).toMatchObject({
      status: 'pass',
      detail: 'All 2 automated acceptance criteria map to a proving test.',
    });

    const others = (gates: typeof before.verdict.gates) =>
      gates
        .filter((g) => g.gate !== 'ac-test-mapping')
        .map((g) => ({ gate: g.gate, status: g.status, skip_kind: g.skip_kind }));
    expect(others(after.verdict.gates)).toEqual(others(before.verdict.gates));

    expect(before.context.spec_boundary).toBeUndefined();
    expect(after.context.spec_boundary).toBeUndefined();

    expect(deadCode(before.context)).toEqual([
      expect.objectContaining({ measure: 'dead_code', current_value: null }),
    ]);
    expect(deadCode(after.context)).toEqual(deadCode(before.context));

    expect(before.context.spec_review_passed).toBe(true);
    expect(after.context.spec_review_passed).toBe(true);
    expect(before.escalations.some((e) => e.startsWith('spec-review:'))).toBe(true);
    expect(after.escalations.some((e) => e.startsWith('spec-review:'))).toBe(false);
    expect(after.escalations.filter((e) => !e.startsWith('spec-review:'))).toEqual(
      before.escalations.filter((e) => !e.startsWith('spec-review:')),
    );
  });

  it('AC-34: a frozen spec whose map could not be built reads did not run at Stop, never the canned line', async () => {
    mode.build = 'fails';
    const run = await stopRun(cleanChange('ses-fails'));

    const acGate = run.verdict.gates.find((g) => g.gate === 'ac-test-mapping');
    expect(acGate).toMatchObject({ status: 'skipped', skip_kind: 'did-not-run' });
    expect(acGate?.detail).toContain('map is missing (could not read the spec)');
    expect(run.verdict.summary).not.toContain('Acceptance criteria map to tests');
    expect(JSON.stringify(run.verdict.gates)).not.toContain('Acceptance criteria map to tests');
    expect(run.escalations.some((e) => e.startsWith('spec-review:'))).toBe(true);
  });
});
