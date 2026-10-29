import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeliveryLinkCommand } from '@/cli/commands/delivery-link.js';
import { createProgram } from '@/cli/program.js';
import { hooksLogPath } from '@/core/logging/hooks-log.js';
import type { CommandRun, CommandRunner } from '@/delivery/delivery-check.js';
import { readFeatureDelivery, recordShip } from '@/feature-evidence/delivery.js';
import { updateFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { deliveryPolicyPath } from '@/pipeline/delivery-policy.js';
import { featureReportPath } from '@/feature-evidence/paths.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';

describe('paqad-ai delivery-link', () => {
  let root: string;
  const SES = 'ses_cli_dl';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-dl-'));
    const g = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    g('init', '-q', '-b', 'feat/x');
    g('config', 'user.email', 't@t.dev');
    g('config', 'user.name', 'T');
    writeFileSync(join(root, 'a.txt'), 'a');
    g('add', '-A');
    g('commit', '-q', '-m', 'feat: work');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => lines.push(String(l)));
    await createDeliveryLinkCommand().parseAsync(
      [...args, '--project-root', root, '--session', SES],
      { from: 'user' },
    );
    return lines;
  }

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('delivery-link');
  });

  it('commit records HEAD against the active feature', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const lines = await run('commit');
    expect(lines.some((l) => l.includes('"linked":true'))).toBe(true);
    const dir = currentFeature(root, SES)!;
    expect(readFeatureDelivery(root, dir).commits).toHaveLength(1);
  });

  it('commit regenerates the feature report after linking (AC-6)', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    await run('commit');
    const dir = currentFeature(root, SES)!;
    expect(existsSync(join(root, featureReportPath(dir)))).toBe(true);
  });

  it('commit reports linked:false when no feature is active', async () => {
    const lines = await run('commit');
    expect(lines.some((l) => l.includes('"linked":false'))).toBe(true);
  });

  it('reconcile backfills the active feature from local git', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const lines = await run('reconcile');
    expect(lines.some((l) => l.includes('"reconciled":true'))).toBe(true);
  });

  it('merge stamps the merge commit on the branch-matched feature', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const lines = await run('merge');
    expect(lines.some((l) => l.includes('"linked":true'))).toBe(true);
    const dir = currentFeature(root, SES)!;
    expect(readFeatureDelivery(root, dir).merge_commit).not.toBeNull();
  });

  it('reconcile reports reconciled:false when no feature can be resolved', async () => {
    const lines = await run('reconcile');
    expect(lines.some((l) => l.includes('"reconciled":false'))).toBe(true);
  });

  it('AC-8: merge on main stamps nothing, even with an active change on another branch', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const dir = currentFeature(root, SES)!;
    execFileSync('git', ['checkout', '-q', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    writeFileSync(join(root, 'release.txt'), 'release');
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-q', '-m', 'chore: release'], { cwd: root, stdio: 'ignore' });

    const lines = await run('merge');

    expect(lines).toEqual([JSON.stringify({ linked: false, reason: 'no merge target' })]);
    expect(readFeatureDelivery(root, dir).merge_commit).toBeNull();
    expect(process.exitCode).toBeUndefined();
  });

  it('merge reports linked:false when there is no feature to stamp', async () => {
    const lines = await run('merge');
    expect(lines.some((l) => l.includes('"linked":false'))).toBe(true);
  });

  it.each(['commit', 'decline', 'ignored', 'user-requested'] as const)(
    'AC-35: commit-decision %s records the answer on delivery.json',
    async (answer) => {
      openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
      const lines = await run('commit-decision', answer);
      expect(lines.some((l) => l.includes('"recorded":true'))).toBe(true);
      const decision = readFeatureDelivery(root, currentFeature(root, SES)!).commit_decision;
      expect(decision).toMatchObject({ answer, asked: answer !== 'user-requested' });
      expect(decision?.recorded_at).not.toBeNull();
    },
  );

  it('AC-35: commit-decision rejects an unknown answer with exit code 1', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await run('commit-decision', 'maybe');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('unknown commit decision "maybe"');
    expect(
      readFeatureDelivery(root, currentFeature(root, SES)!).commit_decision?.answer,
    ).toBeNull();
  });

  it('commit-decision reports recorded:false when no feature is active', async () => {
    const lines = await run('commit-decision', 'commit');
    expect(lines.some((l) => l.includes('"recorded":false'))).toBe(true);
  });

  it('install writes the git hooks', async () => {
    const lines = await run('install');
    expect(lines.some((l) => l.includes('post-commit'))).toBe(true);
    expect(existsSync(join(root, '.git', 'hooks', 'post-commit'))).toBe(true);
  });
});

describe('paqad-ai delivery-link refresh', () => {
  let root: string;
  const SES = 'ses_cli_refresh';
  const HEAD = 'a'.repeat(40);
  const T0 = '2026-10-29T10:00:00.000Z';
  const ok = (stdout: string): CommandRun => ({ stdout, exitCode: 0 });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-refresh-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  function change(): string {
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 3 });
    updateFeatureRecord(root, dir, { branch: 'feat/x' });
    return dir;
  }

  function prView(rollup: unknown[], body = ''): CommandRun {
    return ok(
      JSON.stringify({
        number: 8,
        url: 'https://example.test/pull/8',
        state: 'OPEN',
        headRefOid: HEAD,
        body,
        statusCheckRollup: rollup,
      }),
    );
  }

  function runner(gh: CommandRun, branch: CommandRun = ok('feat/x')) {
    const calls: string[][] = [];
    const run: CommandRunner = async (command, args) => {
      calls.push([command, ...args]);
      if (command === 'gh') return gh;
      if (args.includes('--abbrev-ref')) return branch;
      if (args.includes('@{upstream}')) return ok(HEAD);
      if (args.includes('log')) return ok('');
      return ok(HEAD);
    };
    return { run, calls };
  }

  async function refresh(run: CommandRunner, ...extra: string[]) {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => lines.push(String(l)));
    await createDeliveryLinkCommand({ run, now: () => new Date(T0) }).parseAsync(
      ['refresh', '--project-root', root, '--session', SES, ...extra],
      { from: 'user' },
    );
    return JSON.parse(lines.at(-1)!) as Record<string, unknown>;
  }

  const deliveryText = (dir: string) =>
    readFileSync(join(root, featureFilePath(dir, 'delivery')), 'utf8');

  it('FR-5: reads the PR, CI and push for the branch change and prints one line', async () => {
    const dir = change();
    const { run } = runner(prView([{ conclusion: 'SUCCESS' }, { state: 'PENDING' }]));
    const out = await refresh(run);
    expect(out).toEqual({
      refreshed: true,
      feature: dir,
      reason: null,
      push: 'pushed',
      ci: { state: 'pending', done: 1, total: 2 },
    });
    const record = readFeatureDelivery(root, dir);
    expect(record.ci).toMatchObject({ sha: HEAD, state: 'pending' });
    expect(record.ci_read).toEqual({ ok: true, reason: null, at: T0 });
  });

  it.each([
    ['gh missing', { stdout: '', exitCode: 1, missing: true }, 'gh is not installed'],
    [
      'gh signed out',
      { stdout: '', exitCode: 4, stderr: 'You are not logged into any GitHub hosts' },
      'gh is signed out',
    ],
    ['gh timed out', { stdout: '', exitCode: 1, timedOut: true }, 'gh timed out after 10 s'],
    ['unreadable gh output', ok('not json'), 'gh returned unreadable output'],
    [
      'no PR for the branch',
      { stdout: '', exitCode: 1, stderr: 'no pull requests found for branch "feat/x"' },
      'no pull request for this branch',
    ],
  ] as const)(
    'AC-4: %s keeps pr and ci byte-identical and records only ci_read',
    async (_n, gh, reason) => {
      const dir = change();
      recordShip(
        root,
        dir,
        {
          pr: { number: 8, state: 'open', head_sha: HEAD },
          ci: {
            sha: HEAD,
            state: 'pending',
            done: 1,
            total: 2,
            reason: null,
            source: 'stop-check',
          },
        },
        '2026-10-29T09:00:00.000Z',
      );
      const before = readFeatureDelivery(root, dir);
      const out = await refresh(runner({ ...gh }).run);
      expect(out).toMatchObject({ refreshed: false, feature: dir, reason });
      const after = readFeatureDelivery(root, dir);
      expect(JSON.stringify(after.pr)).toBe(JSON.stringify(before.pr));
      expect(JSON.stringify(after.ci)).toBe(JSON.stringify(before.ci));
      expect(after.ci_read).toEqual({ ok: false, reason, at: T0 });
      expect(after.commits).toEqual(before.commits);
      expect(after.commit_decision).toEqual(before.commit_decision);
    },
  );

  it('AC-4: with the policy off, no branch, or no change on the branch it writes nothing', async () => {
    expect(await refresh(runner(prView([])).run)).toEqual({
      refreshed: false,
      feature: null,
      reason: 'no change on this branch',
      push: null,
      ci: null,
    });
    const dir = change();
    const { run: detached, calls } = runner(prView([]), ok('HEAD'));
    expect(await refresh(detached)).toMatchObject({ refreshed: false, reason: 'no branch' });
    expect(calls.some(([command]) => command === 'gh')).toBe(false);
    mkdirSync(join(deliveryPolicyPath(root), '..'), { recursive: true });
    writeFileSync(deliveryPolicyPath(root), 'schema_version: "1"\nenabled: false\n');
    const before = deliveryText(dir);
    expect(await refresh(runner(prView([])).run)).toMatchObject({
      refreshed: false,
      reason: 'delivery policy is off',
    });
    expect(deliveryText(dir)).toBe(before);
  });

  it('AC-25: skips gh when the stored reading is younger than --min-age-seconds', async () => {
    const dir = change();
    recordShip(root, dir, { ci_read: { ok: true, reason: null } }, '2026-10-29T09:59:50.000Z');
    const { run, calls } = runner(prView([]));
    const out = await refresh(run, '--min-age-seconds', '30');
    expect(out).toMatchObject({ refreshed: false, feature: dir, reason: 'fresh' });
    expect(calls.some(([command]) => command === 'gh')).toBe(false);
    await refresh(run, '--min-age-seconds', '5');
    expect(calls.some(([command]) => command === 'gh')).toBe(true);
  });

  it('AC-21: no token, stderr text or PR body reaches delivery.json or hooks.log', async () => {
    const dir = change();
    const secret = 'ghp_SECRETTOKEN0123456789';
    await refresh(runner({ stdout: '', exitCode: 4, stderr: `bad credentials ${secret}` }).run);
    await refresh(runner(prView([{ state: 'PENDING' }], `body text ${secret} PRBODYTEXT`)).run);
    const texts = [deliveryText(dir)];
    if (existsSync(hooksLogPath(root))) texts.push(readFileSync(hooksLogPath(root), 'utf8'));
    for (const text of texts) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain('PRBODYTEXT');
      expect(text).not.toContain('bad credentials');
    }
  });
});
