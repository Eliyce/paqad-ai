import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

// The sharded CI layout (issue #654). Branch protection requires the four gate names below,
// so they must never drift, and the coverage floors must be checked on the merged result only.

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  name: string;
  'runs-on': string;
  needs?: string | string[];
  if?: string;
  env?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix: { include: Record<string, string | number>[] } };
  steps: Step[];
};
type Workflow = {
  on: unknown;
  permissions: unknown;
  concurrency: unknown;
  env: Record<string, string>;
  jobs: Record<string, Job>;
};

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as Workflow;
const { jobs } = workflow;
const runs = (job: Job) => job.steps.map((step) => step.run ?? '').join('\n');
const stepNamed = (job: Job, pattern: RegExp) =>
  job.steps.find((step) => pattern.test(step.name ?? ''));

const REQUIRED_CHECKS = [
  'Node 22 / ubuntu-latest',
  'Node 24 / ubuntu-latest',
  'Node 22 / macos-latest',
  'Node 22 / windows-latest',
];

describe('.github/workflows/ci.yml', () => {
  it('keeps the triggers, permissions, concurrency and heap size', () => {
    expect(workflow.on).toEqual({
      pull_request: { branches: ['main'] },
      push: { branches: ['main'] },
    });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group: 'ci-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    });
    expect(workflow.env.NODE_OPTIONS).toBe('--max-old-space-size=4096');
  });

  it('defines exactly the static, test, merge and gate jobs', () => {
    expect(Object.keys(jobs).sort()).toEqual(['gate', 'merge', 'static', 'test']);
  });

  describe('static', () => {
    const job = jobs.static;

    it('runs once on ubuntu with Node 22', () => {
      expect(job['runs-on']).toBe('ubuntu-latest');
      expect(job.strategy).toBeUndefined();
      expect(stepNamed(job, /^Setup Node/)?.with?.['node-version']).toBe(22);
    });

    it('runs every check that gives the same answer on every OS', () => {
      const script = runs(job);
      for (const check of [
        'pnpm run typecheck',
        'pnpm run lint',
        'pnpm run format:check',
        'pnpm run graph-ui:test',
        'pnpm run build',
        'pnpm run plugin:validate',
        'pnpm run plugin:test',
      ]) {
        expect(script).toContain(check);
      }
    });

    it('installs the pinned Claude Code so the plugin checks really run', () => {
      expect(runs(job)).toContain('npm install -g @anthropic-ai/claude-code@2.1.302');
    });
  });

  describe('test', () => {
    const job = jobs.test;
    const legs = job.strategy!.matrix.include;

    it('splits windows into 4 shards and every other OS into 3, with fail-fast off', () => {
      expect(job.strategy!['fail-fast']).toBe(false);
      const byTarget = new Map<string, number[]>();
      for (const leg of legs) {
        const key = `Node ${leg.node} / ${leg.os}`;
        byTarget.set(key, [...(byTarget.get(key) ?? []), Number(leg.shard)]);
        expect(leg.total).toBe(leg.os === 'windows-latest' ? 4 : 3);
      }
      expect([...byTarget.keys()].sort()).toEqual([...REQUIRED_CHECKS].sort());
      expect(byTarget.get('Node 22 / windows-latest')).toEqual([1, 2, 3, 4]);
      for (const target of REQUIRED_CHECKS.filter((name) => !name.includes('windows'))) {
        expect(byTarget.get(target)).toEqual([1, 2, 3]);
      }
    });

    it('never reuses a required check name for a shard', () => {
      expect(REQUIRED_CHECKS).not.toContain(job.name);
      expect(job.name).toContain('Shard ${{ matrix.shard }}/${{ matrix.total }}');
    });

    it('installs expect on ubuntu and builds once before the tests', () => {
      const expectStep = stepNamed(job, /expect/);
      expect(expectStep?.if).toBe("runner.os == 'Linux'");
      expect(expectStep?.run).toContain('apt-get install -y expect');
      const names = job.steps.map((step) => step.name ?? '');
      const build = names.findIndex((name) => /^Build/.test(name));
      const shard = names.findIndex((name) => /^Run test shard/.test(name));
      expect(job.steps[build].run).toBe('pnpm run build');
      expect(build).toBeGreaterThan(-1);
      expect(build).toBeLessThan(shard);
    });

    it('runs its shard with coverage, a blob report and the floors switched off', () => {
      const step = stepNamed(job, /^Run test shard/)!;
      expect(step.env?.PAQAD_TEST_SHARD).toBe('1');
      expect(step.run).toContain('vitest run --coverage --reporter=blob');
      expect(step.run).toContain('--reporter=json');
      expect(step.run).toContain(
        '--outputFile.json=.vitest-durations/durations-${{ matrix.shard }}.json',
      );
      expect(step.run).toContain('--shard=${{ matrix.shard }}/${{ matrix.total }}');
    });

    it('uploads its reports under a per-shard name, hidden files included, for one day', () => {
      const step = stepNamed(job, /^Upload/)!;
      expect(step.uses).toMatch(/^actions\/upload-artifact@v\d+$/);
      expect(step.if).toBe('${{ !cancelled() }}');
      expect(step.with).toMatchObject({
        name: 'blob-${{ matrix.os }}-node${{ matrix.node }}-${{ matrix.shard }}',
        'include-hidden-files': true,
        'retention-days': 1,
      });
      expect(String(step.with?.path)).toContain('.vitest-reports');
      expect(String(step.with?.path)).toContain('.vitest-durations');
    });
  });

  describe('merge', () => {
    const job = jobs.merge;
    const legs = job.strategy!.matrix.include;

    it('merges each OS on that same OS, after the shards, even when one failed', () => {
      expect(job.needs).toBe('test');
      expect(job.if).toBe('${{ !cancelled() }}');
      expect(job['runs-on']).toBe('${{ matrix.os }}');
      expect(job.strategy!['fail-fast']).toBe(false);
      expect(legs.map((leg) => `Node ${leg.node} / ${leg.os}`).sort()).toEqual(
        [...REQUIRED_CHECKS].sort(),
      );
      for (const leg of legs) {
        const shards = jobs.test.strategy!.matrix.include.filter(
          (test) => test.os === leg.os && test.node === leg.node,
        );
        expect(leg.total).toBe(shards.length);
      }
    });

    it("downloads only its own OS and Node's shard reports", () => {
      const step = stepNamed(job, /^Download/)!;
      expect(step.uses).toMatch(/^actions\/download-artifact@v\d+$/);
      expect(step.with).toMatchObject({
        pattern: 'blob-${{ matrix.os }}-node${{ matrix.node }}-*',
        'merge-multiple': true,
      });
    });

    it('fails when a shard report is missing', () => {
      expect(runs(job)).toContain('test "${#blobs[@]}" -eq "${{ matrix.total }}"');
    });

    it('merges with coverage and the floors on, then checks the time budget', () => {
      const merge = stepNamed(job, /^Merge/)!;
      expect(merge.run).toBe('pnpm exec vitest run --merge-reports --coverage');
      for (const step of job.steps) expect(step.env?.PAQAD_TEST_SHARD).toBeUndefined();
      expect(job.env?.PAQAD_TEST_SHARD).toBeUndefined();
      expect(workflow.env.PAQAD_TEST_SHARD).toBeUndefined();
      expect(stepNamed(job, /budget/)?.run).toContain('node scripts/check-shard-budget.mjs');
    });
  });

  describe('gate', () => {
    const job = jobs.gate;

    it('carries the four required check names exactly', () => {
      expect(job.name).toBe('Node ${{ matrix.node }} / ${{ matrix.os }}');
      const names = job.strategy!.matrix.include.map((leg) => `Node ${leg.node} / ${leg.os}`);
      expect(names.sort()).toEqual([...REQUIRED_CHECKS].sort());
    });

    it('always runs, needs static, test and merge, and fails unless all succeeded', () => {
      expect(job.if).toBe('always()');
      expect(job.needs).toEqual(['static', 'test', 'merge']);
      expect(job['runs-on']).toBe('ubuntu-latest');
      const step = job.steps[0];
      expect(step.env?.NEEDS).toBe('${{ toJSON(needs) }}');
      expect(step.run).toContain(`jq -e 'all(.[]; .result == "success")'`);
      expect(job.steps.every((s) => s.uses === undefined)).toBe(true);
    });
  });
});
