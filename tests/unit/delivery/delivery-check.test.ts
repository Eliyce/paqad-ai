import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ResolvedDeliveryPolicy } from '@/core/types/delivery-policy.js';
import {
  evaluateDelivery,
  execaCommandRunner,
  formatDeliverySummary,
  runDeliveryCapability,
  type CommandRun,
  type CommandRunner,
} from '@/delivery/delivery-check.js';
import { defaultDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { readLatestProjectEvent } from '@/session-ledger/project-ledger.js';
import { DELIVERY_EVIDENCE_DOC_TYPE } from '@/delivery/delivery-ledger.js';

/** A policy clone with `enabled`, `branch.base`, `branch.type_map`, `ci.gate` tweakable. */
function policy(over: {
  enabled?: boolean;
  base?: string;
  typeMap?: Record<string, string>;
  ciGate?: 'wait_for_green' | 'warn_only' | 'off';
} = {}): ResolvedDeliveryPolicy {
  const base = defaultDeliveryPolicy();
  return {
    enabled: over.enabled ?? true,
    process: {
      ...base.process,
      branch: {
        ...base.process.branch,
        base: over.base ?? 'main',
        type_map: over.typeMap ?? base.process.branch.type_map,
      },
      ci: { ...base.process.ci, gate: over.ciGate ?? 'wait_for_green' },
    },
  };
}

/** Build a runner from a lookup table keyed by the first arg that identifies the call. */
function runner(handlers: {
  branch?: CommandRun;
  commit?: CommandRun;
  gh?: CommandRun;
}): CommandRunner {
  return async (command, args) => {
    if (command === 'git' && args.includes('--abbrev-ref')) {
      return handlers.branch ?? { stdout: '', exitCode: 1 };
    }
    if (command === 'git') {
      return handlers.commit ?? { stdout: 'abc123', exitCode: 0 };
    }
    // gh pr view …
    return handlers.gh ?? { stdout: '', exitCode: 1 };
  };
}

const ok = (stdout: string): CommandRun => ({ stdout, exitCode: 0 });
const fail: CommandRun = { stdout: '', exitCode: 1 };

describe('evaluateDelivery — convention findings', () => {
  const root = '/tmp/does-not-matter'; // git is faked, so the path is never touched

  it('disabled policy → nothing to check (ran:false)', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy({ enabled: false }),
      run: runner({}),
    });
    expect(result.ran).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it('no branch (git fails) → ran:false', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: fail }),
    });
    expect(result.ran).toBe(false);
  });

  it('detached HEAD (rev-parse prints "HEAD") → ran:false', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('HEAD') }),
    });
    expect(result.ran).toBe(false);
  });

  it('on the base branch → on-base-branch warning', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy({ base: 'main' }),
      run: runner({ branch: ok('main'), commit: ok('sha') }),
    });
    expect(result.ran).toBe(true);
    expect(result.commit).toBe('sha');
    expect(result.findings.map((f) => f.code)).toEqual(['on-base-branch']);
  });

  it('off-convention branch name → branch-shape warning', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('random-thing'), commit: ok('sha') }),
    });
    expect(result.findings.map((f) => f.code)).toEqual(['branch-shape']);
    expect(result.findings[0]?.message).toContain('feat/');
  });

  it('conventional branch, no type_map → no branch-shape warning (nothing to check against)', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy({ typeMap: {} }),
      run: runner({ branch: ok('whatever'), commit: ok('sha') }),
    });
    expect(result.findings).toHaveLength(0);
  });

  it('conventional branch + gh red CI (wait_for_green) → ci-red warning with PR number', async () => {
    const gh = ok(
      JSON.stringify({ number: 42, statusCheckRollup: [{ conclusion: 'FAILURE' }, { conclusion: 'SUCCESS' }] }),
    );
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), commit: ok('sha'), gh }),
    });
    expect(result.ghAvailable).toBe(true);
    expect(result.findings.map((f) => f.code)).toEqual(['ci-red']);
    expect(result.findings[0]?.message).toContain('#42');
  });

  it('gh red but gate is off → no ci-red warning', async () => {
    const gh = ok(JSON.stringify({ number: 7, statusCheckRollup: [{ state: 'FAILURE' }] }));
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy({ ciGate: 'off' }),
      run: runner({ branch: ok('feat/x'), commit: ok('sha'), gh }),
    });
    expect(result.findings).toHaveLength(0);
  });

  it('gh green → clean (ran:true, no findings)', async () => {
    const gh = ok(JSON.stringify({ number: 1, statusCheckRollup: [{ conclusion: 'SUCCESS' }] }));
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), commit: ok('sha'), gh }),
    });
    expect(result.ran).toBe(true);
    expect(result.ghAvailable).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('gh unavailable (missing/unauthed) → PR/CI skipped, never a gh warning', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), commit: ok('sha'), gh: fail }),
    });
    expect(result.ghAvailable).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it('gh answers with unparseable JSON → treated as no CI signal, never throws', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), commit: ok('sha'), gh: ok('not json {') }),
    });
    expect(result.ghAvailable).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it('gh rollup is not an array → no failure', async () => {
    const gh = ok(JSON.stringify({ number: 1, statusCheckRollup: null }));
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), commit: ok('sha'), gh }),
    });
    expect(result.findings).toHaveLength(0);
  });
});

describe('formatDeliverySummary', () => {
  it('no findings → empty string', () => {
    expect(
      formatDeliverySummary({ ran: true, branch: 'feat/x', commit: 's', ghAvailable: true, findings: [] }),
    ).toBe('');
  });

  it('findings → paqad-voice warn block (🟡, never blocking language)', () => {
    const summary = formatDeliverySummary({
      ran: true,
      branch: 'main',
      commit: 's',
      ghAvailable: false,
      findings: [{ code: 'on-base-branch', message: 'on the base branch' }],
    });
    expect(summary).toContain('▸ paqad');
    expect(summary).toContain('Heads up');
    expect(summary).toContain('🟡');
    expect(summary).not.toContain('🔴');
  });
});

describe('runDeliveryCapability — the kernel-wired behaviour', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-delivery-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('no-ops at the pre-mutation seam (delivery is completion-only)', async () => {
    const outcome = await runDeliveryCapability(root, 'pre-mutation', runner({ branch: ok('main') }));
    expect(outcome).toEqual({ ran: false, blocking: false, summary: '' });
  });

  it('completion + no branch → NO_OP (nothing to record)', async () => {
    const outcome = await runDeliveryCapability(root, 'completion', runner({ branch: fail }));
    expect(outcome.ran).toBe(false);
    expect(readLatestProjectEvent(root, DELIVERY_EVIDENCE_DOC_TYPE, () => true)).toBeNull();
  });

  it('completion + findings → warn outcome (never blocking) + a delivery-evidence row', async () => {
    const outcome = await runDeliveryCapability(
      root,
      'completion',
      runner({ branch: ok('main'), commit: ok('sha') }),
    );
    expect(outcome.blocking).toBe(false);
    expect(outcome.summary).toContain('Heads up');
    const row = readLatestProjectEvent(root, DELIVERY_EVIDENCE_DOC_TYPE, () => true);
    expect(row?.kind).toBe('delivery-check');
    expect(row?.branch).toBe('main');
  });

  it('completion + clean → NO_OP but still records the evidence row', async () => {
    const gh = ok(JSON.stringify({ number: 1, statusCheckRollup: [{ conclusion: 'SUCCESS' }] }));
    const outcome = await runDeliveryCapability(
      root,
      'completion',
      runner({ branch: ok('feat/x'), commit: ok('sha'), gh }),
    );
    expect(outcome).toEqual({ ran: false, blocking: false, summary: '' });
    const row = readLatestProjectEvent(root, DELIVERY_EVIDENCE_DOC_TYPE, () => true);
    expect(row?.branch).toBe('feat/x');
    expect(row?.gh_available).toBe(true);
  });
});

describe('execaCommandRunner — the real subprocess seam', () => {
  it('runs a present binary and returns its exit code', async () => {
    const result = await execaCommandRunner('git', ['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('git');
  });

  it('a missing binary resolves to a non-zero code (never throws)', async () => {
    const result = await execaCommandRunner('paqad-no-such-binary-xyz', []);
    expect(result.exitCode).not.toBe(0);
  });
});
