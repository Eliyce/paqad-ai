import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runDeliver,
  resolveOpenPrDecision,
  createDeliveryCommand,
  type DeliverDeps,
} from '@/cli/commands/delivery.js';
import { createProgram } from '@/cli/program.js';
import { PATHS } from '@/core/constants/paths.js';
import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import { readFeatureDelivery } from '@/feature-evidence/delivery.js';
import { featureBranch } from '@/feature-evidence/adoption.js';
import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import {
  currentFeature,
  openFeatureChange,
  resolveActiveFeature,
} from '@/feature-evidence/stage-ledger.js';
import { raiseTechDebt } from '@/tech-debt/index.js';
import type { ChecksStatus, HostProvider } from '@/providers/host-provider.js';
import type { DeliveryShell } from '@/delivery/runner.js';

function okShell(): { shell: DeliveryShell; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    shell: {
      async run(command, args) {
        calls.push([command, ...args]);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}

function fakeHost(state: ChecksStatus['state']): { host: HostProvider; comments: string[] } {
  const comments: string[] = [];
  const host = {
    kind: 'github' as const,
    async openPR(input: { draft: boolean }) {
      comments.push(`opened draft=${input.draft}`);
      return { ok: true, pr: { number: 12, url: 'https://example.test/pull/12' } };
    },
    async getChecksStatus(): Promise<ChecksStatus> {
      return { state, checks: state === 'red' ? [{ name: 'build', state: 'red' }] : [] };
    },
    async comment(_prOrBranch: string, body: string) {
      comments.push(body);
      return { ok: true };
    },
  } as unknown as HostProvider;
  return { host, comments };
}

function baseDeps(root: string, overrides: Partial<DeliverDeps> = {}): DeliverDeps {
  return {
    projectRoot: root,
    dryRun: false,
    inputs: { ticket: '#7', title: 'Add retries', summary: 'retry transient failures' },
    base: 'main',
    draft: false,
    reviewers: [],
    labels: [],
    shell: okShell().shell,
    host: fakeHost('green').host,
    resolveOpenPr: () => ({ status: 'resolved', choice: 'yes' }),
    evidenceBody: null,
    ci: { now: () => 0, sleep: async () => {} },
    ...overrides,
  };
}

describe('paqad-ai deliver', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-deliver-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('deliver');
  });

  it('the command action runs a dry-run end-to-end (real wiring, no push)', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => logs.push(String(l)));
    await createDeliveryCommand().parseAsync(
      ['--dry-run', '--project-root', root, '--title', 'Add retries', '--summary', 's'],
      { from: 'user' },
    );
    spy.mockRestore();
    expect(logs.join('\n')).toContain('dry run');
  });

  async function dryRunOutput(): Promise<string> {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => logs.push(String(l)));
    await createDeliveryCommand().parseAsync(
      ['--dry-run', '--project-root', root, '--session', 'ses-deliver', '--title', 'T'],
      { from: 'user' },
    );
    spy.mockRestore();
    return logs.join('\n');
  }

  it('lists the tech debt this change raised in the PR body, and nothing when it raised none', async () => {
    const dir = openFeatureChange(root, 'ses-deliver', { adapter: 'claude-code', title: 'T' });
    expect(await dryRunOutput()).not.toContain('Tech debt');
    const ids = ['First finding', 'Second finding'].map(
      (title) =>
        raiseTechDebt(
          root,
          {
            title,
            kind: 'bug',
            severity: 'low',
            files: [],
            foundIn: { change: featureChangeKey(dir) },
          },
          new Date(),
          { dirName: dir, sessionId: 'ses-deliver' },
        ).id,
    );
    const output = await dryRunOutput();
    expect(output).toContain('## Tech debt found in this change');
    for (const id of ids) expect(output).toContain(`- ${id} (bug, low)`);
  });

  it('--dry-run renders branch/commit/PR text and never pushes', async () => {
    const { shell, calls } = okShell();
    const result = await runDeliver(baseDeps(root, { dryRun: true, shell }));
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('dry run');
    expect(result.output).toContain('branch:');
    expect(calls).toEqual([]);
  });

  it('pauses (non-zero) when the open_pr decision is unresolved', async () => {
    const result = await runDeliver(
      baseDeps(root, { resolveOpenPr: () => ({ status: 'paused', message: 'ASK FIRST' }) }),
    );
    expect(result.exitCode).toBe(2);
    expect(result.output).toBe('ASK FIRST');
  });

  it('runs the chain and posts evidence on green CI (Safe to merge)', async () => {
    const { host, comments } = fakeHost('green');
    const result = await runDeliver(baseDeps(root, { host, evidenceBody: 'EVIDENCE-BODY' }));
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Safe to merge');
    expect(comments).toEqual(['opened draft=false', 'EVIDENCE-BODY']);
  });

  it('stops with a non-zero exit on red CI (never reports success)', async () => {
    const result = await runDeliver(baseDeps(root, { host: fakeHost('red').host }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Needs your attention');
    expect(result.output).not.toContain('Safe to merge');
  });

  it('commits without a PR when open_pr resolves to "no"', async () => {
    const { shell, calls } = okShell();
    const result = await runDeliver(
      baseDeps(root, { shell, resolveOpenPr: () => ({ status: 'resolved', choice: 'no' }) }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('no PR requested');
    expect(calls.some((c) => c.includes('push'))).toBe(false);
    expect(calls.some((c) => c[0] === 'gh')).toBe(false);
  });

  it('keeps the owner on its change when delivery cuts a new branch', async () => {
    const g = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t.dev');
    g('config', 'user.name', 'T');
    writeFileSync(join(root, 'a.txt'), 'a');
    g('add', '-A');
    g('commit', '-q', '-m', 'base');
    g('checkout', '-q', '-b', 'feat/work');
    const dir = openFeatureChange(root, 'ses-owner', { adapter: 'claude-code', title: 'T' });
    const calls: string[][] = [];
    const shell: DeliveryShell = {
      async run(command, args) {
        calls.push([command, ...args]);
        if (command === 'git' && args[0] === 'checkout') g(...args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };

    const result = await runDeliver(
      baseDeps(root, {
        dirName: dir,
        shell,
        resolveOpenPr: () => ({ status: 'resolved', choice: 'no' }),
      }),
    );

    expect(result.exitCode).toBe(0);
    const delivered = calls.find((call) => call[1] === 'checkout')!.at(-1)!;
    expect(featureBranch(root, dir)).toBe(delivered);
    expect(currentFeature(root, 'ses-owner')).toBe(dir);
    expect(resolveActiveFeature(root, 'ses-owner')).toBe(dir);
    expect(listFeatureDirs(root)).toEqual([dir]);
  });

  it('leaves the recorded branch alone when the branch step fails', async () => {
    const dir = openFeatureChange(root, 'ses-owner', { adapter: 'claude-code', title: 'T' });
    const before = featureBranch(root, dir);
    const shell: DeliveryShell = {
      async run() {
        return { stdout: '', stderr: 'exists', exitCode: 1 };
      },
    };
    const result = await runDeliver(baseDeps(root, { dirName: dir, shell }));
    expect(result.exitCode).toBe(1);
    expect(featureBranch(root, dir)).toBe(before);
  });

  it('saves push, PR and CI on the change after a delivery', async () => {
    const dir = openFeatureChange(root, 'ses-deliver', { adapter: 'claude-code', title: 'T' });
    const result = await runDeliver(
      baseDeps(root, {
        dirName: dir,
        resolveOpenPr: () => ({ status: 'resolved', choice: 'draft' }),
        now: () => new Date('2026-10-20T00:00:00.000Z'),
      }),
    );
    expect(result.exitCode).toBe(0);
    const record = readFeatureDelivery(root, dir);
    expect(record.push).toMatchObject({ state: 'pushed', at: '2026-10-20T00:00:00.000Z' });
    expect(record.pr).toMatchObject({
      number: 12,
      url: 'https://example.test/pull/12',
      draft: true,
    });
    expect(record.ci).toMatchObject({ state: 'pass', done: 0, total: 0, source: 'ci-gate' });
  });

  it('saves the PR as open on its head and the running jobs while checks run', async () => {
    const dir = openFeatureChange(root, 'ses-deliver', { adapter: 'claude-code', title: 'T' });
    const polls: ChecksStatus[] = [
      {
        state: 'pending',
        checks: [
          { name: 'build', state: 'green' },
          { name: 'test', state: 'pending' },
        ],
      },
      {
        state: 'red',
        checks: [
          { name: 'build', state: 'green' },
          { name: 'test', state: 'red' },
        ],
      },
    ];
    const seen: Array<NonNullable<ReturnType<typeof readFeatureDelivery>['ci']>> = [];
    let poll = 0;
    const host = {
      ...fakeHost('green').host,
      async getChecksStatus(): Promise<ChecksStatus> {
        const ci = readFeatureDelivery(root, dir).ci;
        if (ci) seen.push(ci);
        return polls[Math.min(poll++, polls.length - 1)]!;
      },
    } as unknown as HostProvider;
    let clock = 0;
    await runDeliver(
      baseDeps(root, {
        dirName: dir,
        host,
        ci: {
          now: () => clock,
          sleep: async () => {
            clock += 60_000;
          },
        },
      }),
    );
    expect(seen[0]).toMatchObject({ state: 'pending', done: 1, total: 2 });
    expect(seen[0]!.jobs).toEqual([
      {
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        started_at: null,
        completed_at: null,
      },
      {
        status: 'IN_PROGRESS',
        conclusion: null,
        started_at: null,
        completed_at: null,
      },
    ]);
    const record = readFeatureDelivery(root, dir);
    expect(record.pr).toMatchObject({ number: 12, state: 'open' });
    expect(record.ci).toMatchObject({ state: 'fail', done: 2, total: 2 });
    expect(record.ci!.jobs![1]).toEqual({
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      started_at: null,
      completed_at: null,
    });
  });

  it('writes every CI read with its read time while it waits a minute between reads', async () => {
    const dir = openFeatureChange(root, 'ses-deliver', { adapter: 'claude-code', title: 'T' });
    const running: ChecksStatus = {
      state: 'pending',
      checks: [
        { name: 'build', state: 'green' },
        { name: 'test', state: 'pending' },
      ],
    };
    const polls: ChecksStatus[] = [
      running,
      running,
      {
        state: 'green',
        checks: [
          { name: 'build', state: 'green' },
          { name: 'test', state: 'green' },
        ],
      },
    ];
    const start = Date.parse('2026-10-20T00:00:00.000Z');
    let clock = start;
    let reads = 0;
    const readTimes: Array<string | undefined> = [];
    const host = {
      ...fakeHost('green').host,
      async getChecksStatus(): Promise<ChecksStatus> {
        readTimes.push(readFeatureDelivery(root, dir).ci?.at);
        return polls[Math.min(reads++, polls.length - 1)]!;
      },
    } as unknown as HostProvider;
    const waits: number[] = [];
    const result = await runDeliver(
      baseDeps(root, {
        dirName: dir,
        host,
        now: () => new Date(clock),
        ci: {
          now: () => clock,
          sleep: async (ms) => {
            waits.push(ms);
            clock += ms;
          },
        },
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(reads).toBe(3);
    expect(waits).toEqual([60_000, 60_000]);
    expect(readTimes).toEqual([undefined, '2026-10-20T00:00:00.000Z', '2026-10-20T00:01:00.000Z']);
    expect(readFeatureDelivery(root, dir).ci).toMatchObject({
      state: 'pass',
      done: 2,
      total: 2,
      at: '2026-10-20T00:02:00.000Z',
    });
  });

  it('records an unknown CI read with its reason and never as a pass', async () => {
    const dir = openFeatureChange(root, 'ses-deliver', { adapter: 'claude-code', title: 'T' });
    const result = await runDeliver(
      baseDeps(root, { dirName: dir, host: fakeHost('unknown').host }),
    );
    expect(result.exitCode).toBe(1);
    expect(readFeatureDelivery(root, dir).ci).toMatchObject({ state: 'unknown' });
    expect(readFeatureDelivery(root, dir).ci?.reason).toBeTruthy();
  });

  it('logs and carries on when delivery.json cannot be written', async () => {
    const result = await runDeliver(baseDeps(root, { dirName: 'not-a-bundle\u0000' }));
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, '.paqad', 'logs', 'hooks.log'), 'utf8')).toContain(
      'deliver: delivery.json not updated',
    );
  });

  it('reports a stopped delivery when a git step fails', async () => {
    const failingShell: DeliveryShell = {
      async run(command, args) {
        const ok = !(command === 'git' && args[0] === 'commit');
        return { stdout: '', stderr: ok ? '' : 'nothing to commit', exitCode: ok ? 0 : 1 };
      },
    };
    const result = await runDeliver(baseDeps(root, { shell: failingShell }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('delivery stopped');
  });
});

describe('resolveOpenPrDecision', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-openpr-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('mints a pending delivery.open_pr packet and pauses when none exists', () => {
    const decision = resolveOpenPrDecision(root, 'yes');
    expect(decision.status).toBe('paused');
    const pendingDir = join(root, PATHS.DECISIONS_PENDING_DIR);
    const files = existsSync(pendingDir) ? readdirSync(pendingDir) : [];
    const minted = files
      .map((f) => JSON.parse(readFileSync(join(pendingDir, f), 'utf8')))
      .find((p) => p.category === 'delivery.open_pr');
    expect(minted).toBeDefined();
    expect(minted.options.map((o: { option_key: string }) => o.option_key)).toEqual([
      'yes',
      'draft',
      'no',
    ]);
  });

  it('drives the choice from a resolved delivery.open_pr packet', () => {
    const { id } = createPendingDecision(root, {
      category: 'delivery.open_pr',
      title: 'Open a PR?',
      context: 'ctx',
      options: [
        { option_key: 'yes', label: 'Yes' },
        { option_key: 'no', label: 'No' },
      ],
    });
    resolvePendingDecision(root, id, 'no', 'commit only for now');
    const decision = resolveOpenPrDecision(root, 'yes');
    expect(decision).toEqual({ status: 'resolved', choice: 'no' });
  });

  function sharedRepo(): string {
    const g = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    const commit = (subject: string) => {
      writeFileSync(join(root, `${subject.replace(/\W+/g, '-')}.txt`), subject);
      g('add', '-A');
      g('commit', '-q', '-m', subject);
    };
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t.dev');
    g('config', 'user.name', 'T');
    commit('chore: base');
    g('checkout', '-q', '-b', 'feat/ORD-470-contact-matching');
    commit('feat(ORD-470): match');
    commit('feat(ORD-471): trim');
    return openFeatureChange(root, 'ses-pr', {
      adapter: 'claude-code',
      title: 'Matcher',
      issue: 'ORD-482',
    });
  }

  function pendingOpenPr(): Record<string, unknown> & {
    context: string;
    change?: string;
    options: Array<{ option_key: string; evidence?: { findings?: string[] } }>;
  } {
    const pendingDir = join(root, PATHS.DECISIONS_PENDING_DIR);
    return readdirSync(pendingDir)
      .map((f) => JSON.parse(readFileSync(join(pendingDir, f), 'utf8')))
      .find((p) => p.category === 'delivery.open_pr');
  }

  it('carries own and riding-along commit counts on a shared branch', () => {
    const dir = sharedRepo();
    writeFileSync(join(root, 'own.txt'), 'own');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'feat(ORD-482): matcher'], { cwd: root });
    const before = execFileSync('git', ['rev-list', '--all'], { cwd: root, encoding: 'utf8' });
    expect(resolveOpenPrDecision(root, 'yes', dir).status).toBe('paused');
    const packet = pendingOpenPr();
    expect(packet.change).toBe(featureChangeKey(dir));
    expect(packet.context).toContain(
      'This PR carries 1 own commit and 2 commits from earlier work on tickets ORD-470, ORD-471.',
    );
    expect(packet.context).toContain('paqad never moves, cherry-picks or rebases commits');
    const evidence = Object.fromEntries(packet.options.map((o) => [o.option_key, o.evidence]));
    expect(evidence.yes?.findings).toEqual([
      '1 own commit',
      '2 commits from earlier work on tickets ORD-470, ORD-471',
    ]);
    expect(evidence.draft?.findings).toEqual(evidence.yes?.findings);
    expect(evidence.no?.findings).toBeUndefined();
    expect(execFileSync('git', ['rev-list', '--all'], { cwd: root, encoding: 'utf8' })).toBe(
      before,
    );
  });

  it('says nothing rides along on a clean branch, and nothing when the split is unknown', () => {
    const g = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t.dev');
    g('config', 'user.name', 'T');
    writeFileSync(join(root, 'a.txt'), 'a');
    g('add', '-A');
    g('commit', '-q', '-m', 'base');
    g('checkout', '-q', '-b', 'feat/ORD-482-clean');
    const dir = openFeatureChange(root, 'ses-pr', {
      adapter: 'claude-code',
      title: 'M',
      issue: 'ORD-482',
    });
    resolveOpenPrDecision(root, 'yes', dir);
    expect(pendingOpenPr().context).toContain('0 own commits and no commits from earlier work.');
    rmSync(join(root, PATHS.DECISIONS_PENDING_DIR), { recursive: true, force: true });
    g('checkout', '-q', '--detach', 'HEAD');
    resolveOpenPrDecision(root, 'yes', dir);
    expect(pendingOpenPr().context).not.toContain('This PR carries');
    expect(pendingOpenPr().options[0]?.evidence?.findings).toBeUndefined();
  });

  it('stays paused (no duplicate mint) while a pending packet exists', () => {
    resolveOpenPrDecision(root, 'yes');
    resolveOpenPrDecision(root, 'yes');
    const pendingDir = join(root, PATHS.DECISIONS_PENDING_DIR);
    const deliveryPackets = readdirSync(pendingDir)
      .map((f) => JSON.parse(readFileSync(join(pendingDir, f), 'utf8')))
      .filter((p) => p.category === 'delivery.open_pr');
    expect(deliveryPackets).toHaveLength(1);
  });
});
