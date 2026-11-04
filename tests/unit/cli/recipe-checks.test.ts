import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { runRecipeScript } from '@/stage-isolation/recipe-check.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const SESSION = 'ses_recipe_check';
const AGENT = 'agent_check';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-recipe-check-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '/nowhere\n');
  return root;
}

async function cli(root: string, args: string[]) {
  return execa('node', [CLI, ...args], {
    cwd: root,
    env: { SE_SESSION: SESSION, SE_AGENT_ID: AGENT },
    reject: false,
  });
}

function bundleDir(root: string): string {
  const base = join(root, '.paqad/ledger/feature-evidence');
  return join(base, readdirSync(base).filter((name) => name !== '_session')[0]!);
}

function rows(root: string): Array<Record<string, unknown>> {
  return readFileSync(join(bundleDir(root), 'stage-evidence.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function skillUsed(root: string) {
  return rows(root).filter((row) => row.kind === 'skill-used');
}

async function opened(root: string, stage: string): Promise<void> {
  await cli(root, ['stage', 'start', stage, '--title', 'checks', '--issue', '1']);
}

function template(root: string, name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

const REVIEW = {
  summary: 's',
  verdict: 'safe-to-merge',
  rollback: 'revert',
  findings: [],
  checked: [],
};
const REUSE = {
  consulted: [{ source: 'grep', query: 'x', hits: 0 }],
  reusing: [],
  new_constructs: [],
};

describe('review record checks the template with the recipe script', () => {
  it('refuses a template that fails, writing no review.json and printing the errors', async () => {
    const root = tempRoot();
    await opened(root, 'review');
    const run = await cli(root, [
      'review',
      'record',
      template(root, 'r.json', {
        ...REVIEW,
        findings: [
          { severity: 'minor', description: 'a' },
          { severity: 'blocker', description: 'b' },
        ],
      }),
    ]);
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain('severity out of order');
    expect(existsSync(join(bundleDir(root), 'review.json'))).toBe(false);
    expect(skillUsed(root)).toEqual([]);
  });

  it('writes review.json and a skill-used row on a pass', async () => {
    const root = tempRoot();
    await opened(root, 'review');
    const run = await cli(root, ['review', 'record', template(root, 'r.json', REVIEW)]);
    expect(run.exitCode).toBe(0);
    expect(existsSync(join(bundleDir(root), 'review.json'))).toBe(true);
    expect(skillUsed(root)).toMatchObject([
      {
        stage: 'review',
        recipe: 'review-recipe',
        source: 'script',
        script: 'lint-findings.mjs',
        agent_id: AGENT,
      },
    ]);
    expect(String(skillUsed(root)[0]!.output_hash)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('only notes a failure when the stage started before the update', async () => {
    const root = tempRoot();
    await opened(root, 'planning');
    const ledger = join(bundleDir(root), 'stage-evidence.jsonl');
    const stale = rows(root).map((row) =>
      row.kind === 'stage_start' ? { ...row, stage: 'review', schema_version: 2 } : row,
    );
    writeFileSync(ledger, `${stale.map((row) => JSON.stringify(row)).join('\n')}\n`);
    const run = await cli(root, [
      'review',
      'record',
      template(root, 'r.json', {
        ...REVIEW,
        findings: [
          { severity: 'minor', description: 'a' },
          { severity: 'blocker', description: 'b' },
        ],
      }),
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain('noted only');
  });
});

describe('plan compile checks the plan', () => {
  it('refuses zero consulted entries with the plain message', async () => {
    const root = tempRoot();
    await opened(root, 'planning');
    const run = await cli(root, [
      'plan',
      'compile',
      template(root, 'p.json', {
        summary: 's',
        steps: [{ id: 'S1', description: 'd', classification: 'ac-satisfying', files: ['a'] }],
        reuse: { ...REUSE, consulted: [] },
      }),
    ]);
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain('a plan must record what existing code was checked');
  });

  it('refuses a step with no verdict and records a passing one', async () => {
    const root = tempRoot();
    await opened(root, 'planning');
    const bad = await cli(root, [
      'plan',
      'compile',
      template(root, 'p.json', {
        summary: 's',
        steps: [{ id: 'S1', description: 'd', files: ['a'] }],
        reuse: REUSE,
      }),
    ]);
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr).toContain('S1 has no keep-or-drop verdict');
    const good = await cli(root, [
      'plan',
      'compile',
      template(root, 'p2.json', {
        summary: 's',
        steps: [{ id: 'S1', description: 'd', classification: 'ac-satisfying', files: ['a'] }],
        reuse: REUSE,
      }),
    ]);
    expect(good.exitCode).toBe(0);
    expect(skillUsed(root)).toMatchObject([{ stage: 'planning', script: 'check-plan.mjs' }]);
  });
});

describe('stage end checks development and documentation sync', () => {
  it('refuses development when a criterion has no test, and passes once one names it', async () => {
    const root = tempRoot();
    await opened(root, 'development');
    writeFileSync(
      join(bundleDir(root), 'specification.json'),
      JSON.stringify({ acceptance_criteria: [{ criterion_id: 'AC-1', proof_type: 'automated' }] }),
    );
    const bad = await cli(root, ['stage', 'end', 'development']);
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr).toContain('AC-1 has no test');
    expect(rows(root).some((row) => row.kind === 'stage_end')).toBe(false);
    writeFileSync(join(root, 'a.test.ts'), "it('AC-1', () => {});");
    const good = await cli(root, ['stage', 'end', 'development']);
    expect(good.exitCode).toBe(0);
    expect(skillUsed(root)).toMatchObject([{ stage: 'development', script: 'check-ac-map.mjs' }]);
  });

  it('holds acknowledged stale docs on the row', async () => {
    const root = tempRoot();
    await opened(root, 'documentation_sync');
    const run = await cli(root, [
      'stage',
      'end',
      'documentation_sync',
      '--stale-ok',
      'docs/modules/x/index/summary.md',
    ]);
    expect(run.exitCode).toBe(0);
    expect(skillUsed(root)[0]).toMatchObject({
      script: 'stale-docs.mjs',
      stale_ok: ['docs/modules/x/index/summary.md'],
    });
  });
});

describe('spec freeze checks the spec', () => {
  it('refuses a spec with no edge cases, printing why', async () => {
    const root = tempRoot();
    await opened(root, 'specification');
    const spec = join(root, 'spec.md');
    writeFileSync(
      spec,
      '# Spec\n\n## Acceptance criteria\n\n- AC-1: Given a, when b, then c (proof: automated).\n',
    );
    const run = await cli(root, ['spec', 'freeze', spec, '--confirm-invariants']);
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain('no "## Edge cases" section');
    expect(existsSync(join(bundleDir(root), 'specification.json'))).toBe(false);
  });
});

describe('a broken install', () => {
  it('is told apart from a bad artifact', () => {
    const run = runRecipeScript('review', ['x'], undefined, join(tmpdir(), 'no-such-paqad-root'));
    expect(run.status).toBe('broken');
    expect(run.errors[0]).toContain('paqad-ai update');
  });

  it('treats a script that crashes as broken, not as a pass', () => {
    const run = runRecipeScript('planning', ['/no/such/plan.json']);
    expect(run.status).toBe('broken');
    expect(run.errors[0]).toContain('did not run cleanly');
  });
});
