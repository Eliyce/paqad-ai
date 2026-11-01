import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  'working-directory'?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  name: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  'runs-on': string;
  needs?: string | string[];
  defaults?: { run?: { 'working-directory'?: string } };
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

  it('AC-19: defines exactly the scope, static, test, merge, discovery-plugin, skill-e2e-laravel and gate jobs', () => {
    expect(Object.keys(jobs).sort()).toEqual([
      'discovery-plugin',
      'gate',
      'merge',
      'scope',
      'skill-e2e-laravel',
      'static',
      'test',
    ]);
  });

  it('FR-62, AC-15: runs the Laravel skill and agent e2e in one ubuntu job with a pinned PHP and Composer', () => {
    const job = jobs['skill-e2e-laravel'];
    expect(job['runs-on']).toBe('ubuntu-latest');
    const setup = job.steps.find((step) => step.uses === 'shivammathur/setup-php@v2');
    expect(setup?.with).toMatchObject({ 'php-version': '8.3', tools: 'composer:v2' });
    expect(job.steps.some((step) => step.run?.includes('composer install'))).toBe(true);
    expect(job.steps.at(-1)?.run).toBe(
      'pnpm exec vitest run tests/e2e/skill-orchestrator.e2e.test.ts tests/e2e/agent-orchestrator.e2e.test.ts',
    );
  });

  describe('scope', () => {
    const job = jobs.scope;

    it('AC-17: runs first with job-level read-only access and no install', () => {
      expect(Object.keys(jobs)[0]).toBe('scope');
      expect(job.permissions).toEqual({
        contents: 'read',
        checks: 'read',
        'pull-requests': 'read',
        actions: 'read',
      });
      expect(job.needs).toBeUndefined();
      expect(job.steps[0]?.with).toEqual({ 'fetch-depth': 0 });
      expect(runs(job)).not.toMatch(/pnpm install|npm (ci|install)|corepack/);
      expect(readFileSync('.github/workflows/ci.yml', 'utf8')).not.toContain('pull_request_target');
    });

    it('outputs skip_matrix and skip_reason from the scope command', () => {
      const step = job.steps.find((each) => each.id === 'scope')!;
      expect(step.run).toBe('node scripts/release-sync.mjs scope');
      expect(step.env).toEqual({ GH_TOKEN: '${{ github.token }}' });
      expect(job.outputs).toEqual({
        skip_matrix: '${{ steps.scope.outputs.skip_matrix }}',
        skip_reason: '${{ steps.scope.outputs.skip_reason }}',
      });
    });
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

    it('audits the shipped dependencies once, right after the frozen install', () => {
      const commands = job.steps.map((step) => step.run ?? '');
      const audit = commands.indexOf('pnpm audit --prod --audit-level high');
      expect(audit).toBe(commands.indexOf('pnpm install --frozen-lockfile') + 1);
      expect(commands.indexOf('pnpm run typecheck')).toBeGreaterThan(audit);
      const everyJob = Object.values(jobs).flatMap((each) => each.steps.map((s) => s.run ?? ''));
      expect(everyJob.filter((run) => run.includes('pnpm audit'))).toHaveLength(1);
    });

    it('ignores the braces advisory by its GHSA id only', () => {
      const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
        pnpm: { auditConfig: Record<string, unknown> };
      };
      expect(pkg.pnpm.auditConfig).toEqual({ ignoreGhsas: ['GHSA-vfj7-8cjw-p6xm'] });
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

    it('runs unless scope says the matrix may be skipped', () => {
      expect(job.needs).toBe('scope');
      expect(job.if).toBe("needs.scope.outputs.skip_matrix != 'true'");
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
        '--outputFile.blob=.vitest-reports/blob-${{ matrix.shard }}-${{ matrix.total }}.json',
      );
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
      expect(job.needs).toEqual(['scope', 'test']);
      expect(job.if).toBe(
        "${{ !cancelled() && needs.scope.result == 'success' && needs.scope.outputs.skip_matrix != 'true' }}",
      );
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

    it('AC-10 merges with coverage and the floors on, then checks the time budget', () => {
      const merge = stepNamed(job, /^Merge/)!;
      expect(merge.run).toBe('pnpm exec vitest run --merge-reports=.vitest-reports --coverage');
      for (const step of job.steps) expect(step.env?.PAQAD_TEST_SHARD).toBeUndefined();
      expect(job.env?.PAQAD_TEST_SHARD).toBeUndefined();
      expect(workflow.env.PAQAD_TEST_SHARD).toBeUndefined();
      expect(stepNamed(job, /budget/)?.run).toContain('node scripts/check-shard-budget.mjs');
    });
  });

  describe('discovery-plugin', () => {
    const job = jobs['discovery-plugin'];
    const stepRuns = job.steps.map((step) => step.run ?? '');
    const indexOf = (text: string) => stepRuns.findIndex((run) => run.includes(text));

    it('AC-19: runs on ubuntu 24.04 (the newest image with a Python 3.9 build) with Python 3.9 and Node 22, inside plugins/discovery, with no pnpm install', () => {
      expect(job.name).toBe('Discovery plugin');
      expect(job['runs-on']).toBe('ubuntu-24.04');
      expect(job.strategy).toBeUndefined();
      expect(job.defaults?.run?.['working-directory']).toBe('plugins/discovery');
      const python = job.steps.find((step) => step.uses?.startsWith('actions/setup-python@'));
      expect(python?.with?.['python-version']).toBe('3.9');
      expect(stepNamed(job, /^Setup Node/)?.with?.['node-version']).toBe(22);
      expect(runs(job)).not.toMatch(/pnpm install|npm (ci|install)|corepack/);
    });

    it('AC-19: runs the unit tests, the five checks, every host build, parity, two builds, the zip, coverage, then the plugin build and the drift check, in that order', () => {
      const order = [
        'python build/build.py --dist dist',
        'python -m unittest discover -s tests/scripts',
        'python tests/ci/check_forbidden.py --dist dist',
        'python tests/ci/check_secrets.py',
        'python tests/ci/check_budget.py --dist dist',
        'python tests/ci/check_host_verdicts.py',
        'python tests/ci/check_scenarios.py',
        'python tests/evals/run_parity.py --dist dist',
        'diff -r "$RUNNER_TEMP/dist-a" "$RUNNER_TEMP/dist-b"',
        'cmp "$RUNNER_TEMP/chatgpt-a.zip" "$RUNNER_TEMP/chatgpt-b.zip"',
        'python -m coverage report --fail-under=90',
        'node scripts/build-discovery.mjs',
        'git status --porcelain --untracked-files=all -- runtime/claude-plugin/skills',
      ];
      const positions = order.map(indexOf);
      expect(
        positions.every((position) => position >= 0),
        JSON.stringify(positions),
      ).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it('AC-20 AC-21: packs the ChatGPT zip twice, compares the bytes, then runs the submission check', () => {
      const zip = stepRuns[indexOf('package_chatgpt.py')]!;
      expect(zip.match(/package_chatgpt\.py/g)).toHaveLength(2);
      expect(zip.indexOf('cmp ')).toBeLessThan(zip.indexOf('check_chatgpt_submission.py --zip'));
      const twoBuilds = stepRuns[indexOf('diff -r')]!;
      expect(twoBuilds.match(/build\/build\.py --dist/g)).toHaveLength(2);
    });

    it('AC-20: measures branch coverage of the scripts with a pinned coverage', () => {
      const coverage = stepRuns[indexOf('coverage run')]!;
      expect(coverage).toContain('pip install "coverage==7.6.1"');
      expect(coverage).toContain('--branch');
      expect(coverage).toContain('--source=build,shared/scripts,skills,tests/ci');
    });

    it('AC-13 AC-19: runs the plugin build and the drift check from the repository root and prints the fix', () => {
      const build = job.steps[indexOf('node scripts/build-discovery.mjs')]!;
      const drift = job.steps[indexOf('git status --porcelain')]!;
      expect(build['working-directory']).toBe('.');
      expect(drift['working-directory']).toBe('.');
      expect(drift.run).toContain('echo "$drift"');
      expect(drift.run).toContain(
        'Fix: run pnpm build:discovery, then commit runtime/claude-plugin/skills.',
      );
      expect(drift.run).toContain('exit 1');
    });
  });

  describe('gate', () => {
    const job = jobs.gate;

    it('carries the four required check names exactly', () => {
      expect(job.name).toBe('Node ${{ matrix.node }} / ${{ matrix.os }}');
      const names = job.strategy!.matrix.include.map((leg) => `Node ${leg.node} / ${leg.os}`);
      expect(names.sort()).toEqual([...REQUIRED_CHECKS].sort());
    });

    it('AC-19: always runs, needs scope, static, test, merge, discovery-plugin and skill-e2e-laravel', () => {
      expect(job.if).toBe('always()');
      expect(job.needs).toEqual([
        'scope',
        'static',
        'test',
        'merge',
        'discovery-plugin',
        'skill-e2e-laravel',
      ]);
      expect(job['runs-on']).toBe('ubuntu-latest');
      expect(job.steps[0].env?.NEEDS).toBe('${{ toJSON(needs) }}');
      expect(job.steps.every((s) => s.uses === undefined)).toBe(true);
    });

    it('AC-14: has jq, so the gate expression is really evaluated here', () => {
      expect(spawnSync('jq', ['--version']).status, 'jq must be on PATH to test the gate').toBe(0);
    });
    const gateResult = (needs: Record<string, unknown>) =>
      spawnSync('bash', ['-c', job.steps[0].run!], {
        env: { PATH: process.env.PATH, NEEDS: JSON.stringify(needs) },
        encoding: 'utf8',
      });
    const needsWith = (skip: string | undefined, results: Record<string, string>) => {
      const all: Record<string, unknown> = {};
      for (const name of ['scope', 'static', 'test', 'merge', 'discovery-plugin']) {
        all[name] = { result: results[name] ?? 'success', outputs: {} };
      }
      if (skip !== undefined) {
        all.scope = { ...(all.scope as object), outputs: { skip_matrix: skip, skip_reason: 'r' } };
      }
      return all;
    };

    it('AC-14: passes when everything succeeded', () => {
      expect(gateResult(needsWith('false', {})).status).toBe(0);
    });

    it('AC-14: passes with test and merge skipped only when scope said skip', () => {
      const skipped = { test: 'skipped', merge: 'skipped' };
      expect(gateResult(needsWith('true', skipped)).status).toBe(0);
      expect(gateResult(needsWith('false', skipped)).status).not.toBe(0);
      expect(gateResult(needsWith(undefined, skipped)).status).not.toBe(0);
      expect(gateResult(needsWith('false', { merge: 'skipped' })).status).not.toBe(0);
    });

    it('AC-14: fails when scope failed, or a job other than test and merge was skipped', () => {
      expect(gateResult(needsWith(undefined, { scope: 'failure' })).status).not.toBe(0);
      expect(
        gateResult(needsWith('true', { scope: 'failure', test: 'skipped', merge: 'skipped' }))
          .status,
      ).not.toBe(0);
      expect(gateResult(needsWith('true', { static: 'skipped' })).status).not.toBe(0);
      expect(gateResult(needsWith('true', { 'discovery-plugin': 'skipped' })).status).not.toBe(0);
      expect(gateResult(needsWith('true', { test: 'failure', merge: 'skipped' })).status).not.toBe(
        0,
      );
      expect(gateResult(needsWith('true', { test: 'cancelled' })).status).not.toBe(0);
    });
  });
});

describe('.github/dependabot.yml', () => {
  it('AC-21 groups npm security updates next to the version-update groups', () => {
    const config = parse(readFileSync('.github/dependabot.yml', 'utf8')) as {
      updates: Array<{
        'package-ecosystem': string;
        groups?: Record<string, { 'applies-to'?: string; patterns?: string[] }>;
      }>;
    };
    const npm = config.updates.find((entry) => entry['package-ecosystem'] === 'npm');
    const groups = npm?.groups ?? {};
    expect(Object.keys(groups)).toEqual(
      expect.arrayContaining(['dev-dependencies-minor-patch', 'prod-dependencies-patch']),
    );
    const security = Object.values(groups).filter(
      (group) => group['applies-to'] === 'security-updates',
    );
    expect(security).toEqual([{ 'applies-to': 'security-updates', patterns: ['*'] }]);
  });
});

describe('package.json pnpm.overrides', () => {
  it('AC-22 keeps every override a capped floor on a dev-only package and CI installs then lints', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      scripts: Record<string, string>;
      pnpm: { overrides: Record<string, string> };
    };
    const lock = parse(readFileSync('pnpm-lock.yaml', 'utf8')) as {
      overrides: Record<string, string>;
      importers: Record<string, Record<string, Record<string, { version: string }>>>;
      snapshots: Record<
        string,
        { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
      >;
    };
    const overrides = Object.entries(pkg.pnpm.overrides);
    expect(overrides.length).toBeGreaterThan(0);
    expect(lock.overrides).toEqual(pkg.pnpm.overrides);

    const root = lock.importers['.'];
    const queue = Object.entries({ ...root.dependencies, ...root.optionalDependencies }).map(
      ([name, entry]) => `${name}@${entry.version}`,
    );
    const shipped = new Set<string>();
    while (queue.length > 0) {
      const key = queue.pop()!;
      if (shipped.has(key)) continue;
      shipped.add(key);
      const snapshot = lock.snapshots[key];
      expect(snapshot, key).toBeDefined();
      for (const [name, version] of Object.entries({
        ...snapshot.dependencies,
        ...snapshot.optionalDependencies,
      })) {
        queue.push(`${name}@${version}`);
      }
    }
    expect(shipped.size).toBeGreaterThanOrEqual(Object.keys(pkg.dependencies).length);

    const productionNames = new Set([
      ...Object.keys(pkg.dependencies),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    for (const [selector, range] of overrides) {
      const match = /^(@?[^@]+)(?:@(\d+))?$/.exec(selector);
      expect(match, selector).not.toBeNull();
      const [, name, selectedMajor] = match!;
      expect(productionNames.has(name), selector).toBe(false);

      const floor = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(range);
      expect(floor, `${selector} ${range}`).not.toBeNull();
      const floorMajor = Number(floor![1]);
      expect(Number(floor![4]), selector).toBe(floorMajor + 1);
      if (selectedMajor !== undefined) expect(Number(selectedMajor), selector).toBe(floorMajor);

      const shippedCopies = [...shipped].filter((key) => {
        if (!key.startsWith(`${name}@`)) return false;
        const major = Number(key.slice(name.length + 1).split('.')[0]);
        return selectedMajor === undefined || major === Number(selectedMajor);
      });
      expect(shippedCopies, selector).toEqual([]);
    }

    const commands = jobs.static.steps.map((step) => step.run ?? '');
    const install = commands.indexOf('pnpm install --frozen-lockfile');
    const lint = commands.indexOf('pnpm run lint');
    expect(install).toBeGreaterThan(-1);
    expect(lint).toBeGreaterThan(install);
    expect(pkg.scripts.lint).toBe('eslint .');
  });
});
