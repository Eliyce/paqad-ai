import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
import type { ChecksStatus, HostProvider } from '@/providers/host-provider.js';
import type { DeliveryShell } from '@/delivery/runner.js';

/** A shell whose every command succeeds (exit 0). */
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

/** A host stub for the CI gate: fixed checks state + a recording comment(). */
function fakeHost(state: ChecksStatus['state']): { host: HostProvider; comments: string[] } {
  const comments: string[] = [];
  const host = {
    kind: 'github' as const,
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

  it('--dry-run renders branch/commit/PR text and never pushes', async () => {
    const { shell, calls } = okShell();
    const result = await runDeliver(baseDeps(root, { dryRun: true, shell }));
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('dry run');
    expect(result.output).toContain('branch:');
    expect(calls).toEqual([]); // nothing shelled
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
    expect(comments).toEqual(['EVIDENCE-BODY']);
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
    // branch + commit only — never push/pr.
    expect(calls.some((c) => c.includes('push'))).toBe(false);
    expect(calls.some((c) => c[0] === 'gh')).toBe(false);
  });

  it('reports a stopped delivery when a git step fails', async () => {
    const failingShell: DeliveryShell = {
      async run(command, args) {
        // branch ok, commit fails.
        const ok = !(command === 'git' && args[0] === 'commit');
        return { stdout: '', stderr: ok ? '' : 'nothing to commit', exitCode: ok ? 0 : 1 };
      },
    };
    const result = await runDeliver(baseDeps(root, { shell: failingShell }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('delivery stopped');
  });
});

describe('resolveOpenPrDecision (#323)', () => {
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
