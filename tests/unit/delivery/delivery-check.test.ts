import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ResolvedDeliveryPolicy } from '@/core/types/delivery-policy.js';
import {
  evaluateDelivery,
  execaCommandRunner,
  formatDeliverySummary,
  ghFailureReason,
  readPrState,
  readRollup,
  runDeliveryCapability,
  saveDeliveryReading,
  type CommandRun,
  type CommandRunner,
} from '@/delivery/delivery-check.js';
import { defaultDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { readLatestProjectEvent } from '@/session-ledger/project-ledger.js';
import { readFeatureDelivery, recordShip } from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { updateFeatureRecord } from '@/feature-evidence/feature-record.js';
import { DELIVERY_EVIDENCE_DOC_TYPE } from '@/delivery/delivery-ledger.js';
import { ticketRef } from '../../shared/ticket-ref.js';

function policy(
  over: {
    enabled?: boolean;
    base?: string;
    typeMap?: Record<string, string>;
    ciGate?: 'wait_for_green' | 'warn_only' | 'off';
  } = {},
): ResolvedDeliveryPolicy {
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
    return handlers.gh ?? { stdout: '', exitCode: 1 };
  };
}

const ok = (stdout: string): CommandRun => ({ stdout, exitCode: 0 });
const fail: CommandRun = { stdout: '', exitCode: 1 };

describe('evaluateDelivery — convention findings', () => {
  const root = '/tmp/does-not-matter';

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
      JSON.stringify({
        number: 42,
        statusCheckRollup: [{ conclusion: 'FAILURE' }, { conclusion: 'SUCCESS' }],
      }),
    );
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), commit: ok('sha'), gh }),
    });
    expect(result.ghAvailable).toBe(true);
    expect(result.findings.map((f) => f.code)).toEqual(['ci-red']);
    expect(result.findings[0]?.message).toContain(ticketRef(42));
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
      formatDeliverySummary({
        ran: true,
        branch: 'feat/x',
        commit: 's',
        ghAvailable: true,
        findings: [],
      }),
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
    const outcome = await runDeliveryCapability(
      root,
      'pre-mutation',
      runner({ branch: ok('main') }),
    );
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
    expect(result.missing).toBe(true);
  });
});

describe('the Stop delivery check saves what ships', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-delivery-ship-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function branchChange(): string {
    const dir = openFeatureChange(root, 'ses_ship', { adapter: 'claude-code', ulidSeed: 9 });
    updateFeatureRecord(root, dir, { branch: 'feat/x' });
    return dir;
  }

  it('reads the PR and a partial CI state from gh pr view', async () => {
    const gh = ok(
      JSON.stringify({
        number: 7,
        url: 'https://example.test/pull/7',
        isDraft: true,
        statusCheckRollup: [
          { conclusion: 'SUCCESS' },
          { status: 'IN_PROGRESS', conclusion: '' },
          { state: 'PENDING' },
        ],
      }),
    );
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), commit: ok('sha-1'), gh }),
    });
    expect(result.pr).toEqual({
      number: 7,
      url: 'https://example.test/pull/7',
      draft: true,
      state: null,
      head_sha: null,
    });
    expect(result.ci).toMatchObject({ state: 'pending', done: 1, total: 3, reason: null });
  });

  it('saves the PR state and head commit gh already reports (FR-8)', async () => {
    const dir = branchChange();
    const gh = ok(
      JSON.stringify({
        number: 9,
        url: 'https://example.test/pull/9',
        state: 'MERGED',
        headRefOid: 'head-9',
        statusCheckRollup: [],
      }),
    );
    await runDeliveryCapability(
      root,
      'completion',
      runner({ branch: ok('feat/x'), commit: ok('sha-1'), gh }),
    );
    expect(readFeatureDelivery(root, dir).pr).toMatchObject({
      number: 9,
      state: 'merged',
      head_sha: 'head-9',
    });
    expect(readPrState('OPEN')).toBe('open');
    expect(readPrState('closed')).toBe('closed');
    expect(readPrState('DRAFT')).toBeNull();
    expect(readPrState(undefined)).toBeNull();
  });

  it('AC-7: a failed gh pr view leaves pr.state null and throws nothing', async () => {
    const dir = branchChange();
    await expect(
      runDeliveryCapability(root, 'completion', runner({ branch: ok('feat/x'), gh: fail })),
    ).resolves.toMatchObject({ blocking: false });
    expect(readFeatureDelivery(root, dir).pr?.state ?? null).toBeNull();
    const noState = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), gh: ok(JSON.stringify({ number: 3 })) }),
    });
    expect(noState.pr?.state).toBeNull();
  });

  it('AC-13: keeps every job of both rollup shapes, counting only finished ones as done', () => {
    const reading = readRollup([
      {
        __typename: 'CheckRun',
        name: 'build',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        startedAt: '2026-10-20T10:00:00Z',
        completedAt: '2026-10-20T10:03:00Z',
      },
      { __typename: 'CheckRun', name: 'test', status: 'QUEUED', conclusion: '' },
      { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: null },
      { __typename: 'StatusContext', context: 'deploy', state: 'PENDING' },
      { __typename: 'StatusContext', context: 'license', state: 'EXPECTED' },
      { __typename: 'StatusContext', context: 'cla', state: 'SUCCESS' },
      {},
    ]);
    expect(reading).toMatchObject({ state: 'pending', done: 2, total: 7 });
    expect(reading.jobs).toEqual([
      {
        name: 'build',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        started_at: '2026-10-20T10:00:00Z',
        completed_at: '2026-10-20T10:03:00Z',
      },
      { name: 'test', status: 'QUEUED', conclusion: null, started_at: null, completed_at: null },
      {
        name: 'lint',
        status: 'IN_PROGRESS',
        conclusion: null,
        started_at: null,
        completed_at: null,
      },
      { name: 'deploy', status: 'PENDING', conclusion: null, started_at: null, completed_at: null },
      {
        name: 'license',
        status: 'EXPECTED',
        conclusion: null,
        started_at: null,
        completed_at: null,
      },
      { name: 'cla', status: 'SUCCESS', conclusion: null, started_at: null, completed_at: null },
      { name: 'check', status: null, conclusion: null, started_at: null, completed_at: null },
    ]);
  });

  it('records unknown with the reason when gh cannot answer, and the outcome is unchanged', async () => {
    const dir = branchChange();
    const missing = { stdout: '', exitCode: 1, missing: true };
    const outcome = await runDeliveryCapability(
      root,
      'completion',
      runner({ branch: ok('feat/x'), commit: ok('sha-1'), gh: missing }),
    );
    expect(outcome.blocking).toBe(false);
    expect(readFeatureDelivery(root, dir).ci).toMatchObject({
      sha: 'sha-1',
      state: 'unknown',
      reason: 'gh is not installed',
      source: 'stop-check',
    });
    expect(readFeatureDelivery(root, dir).pr ?? null).toBeNull();
  });

  it('AC-33: keeps a recorded pass when gh later signs out for the same commit', async () => {
    const dir = branchChange();
    recordShip(
      root,
      dir,
      {
        ci: {
          sha: 'sha-1',
          state: 'pass',
          done: 3,
          total: 3,
          reason: null,
          source: 'ci-gate',
        },
      },
      '2026-10-20T00:00:00.000Z',
    );
    const signedOut = {
      stdout: '',
      stderr: 'To get started with GitHub CLI, please run:  gh auth login',
      exitCode: 4,
    };
    await runDeliveryCapability(
      root,
      'completion',
      runner({ branch: ok('feat/x'), commit: ok('sha-1'), gh: signedOut }),
    );
    expect(readFeatureDelivery(root, dir).ci).toMatchObject({ state: 'pass', done: 3 });
  });

  it.each([
    ['missing', { stdout: '', exitCode: 1, missing: true }, 'gh is not installed'],
    [
      'signed out',
      { stdout: '', stderr: 'You are not logged into any GitHub hosts', exitCode: 4 },
      'gh is signed out',
    ],
    ['timing out', { stdout: '', exitCode: 1, timedOut: true }, 'gh timed out after 10 s'],
  ] as const)(
    'AC-33: gh %s records CI unknown with the reason and leaves the Stop outcome unchanged',
    async (_name, gh, reason) => {
      const dir = branchChange();
      const baseline = await runDeliveryCapability(
        root,
        'completion',
        runner({ branch: ok('feat/x'), commit: ok('sha-1'), gh: fail }),
      );
      const outcome = await runDeliveryCapability(
        root,
        'completion',
        runner({ branch: ok('feat/x'), commit: ok('sha-1'), gh: { ...gh } }),
      );
      expect(outcome.blocking).toBe(false);
      expect(outcome.blocking).toBe(baseline.blocking);
      expect(outcome.ran).toBe(baseline.ran);
      expect(readFeatureDelivery(root, dir).ci).toMatchObject({
        sha: 'sha-1',
        state: 'unknown',
        reason,
      });
    },
  );

  it('saves the PR and a passing CI read against the branch change', async () => {
    const dir = branchChange();
    const gh = ok(
      JSON.stringify({
        number: 7,
        url: 'https://example.test/pull/7',
        isDraft: false,
        statusCheckRollup: [{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }],
      }),
    );
    await runDeliveryCapability(
      root,
      'completion',
      runner({ branch: ok('feat/x'), commit: ok('sha-1'), gh }),
    );
    const record = readFeatureDelivery(root, dir);
    expect(record.pr).toMatchObject({ number: 7, draft: false });
    expect(record.ci).toMatchObject({ sha: 'sha-1', state: 'pass', done: 2, total: 2 });
  });

  it('saves nothing when no change owns the branch or the check did not run', () => {
    saveDeliveryReading(root, {
      ran: true,
      branch: 'feat/nobody',
      commit: 'c',
      ghAvailable: false,
      findings: [],
      ci: { state: 'unknown', done: null, total: null, reason: 'x' },
    });
    saveDeliveryReading(root, {
      ran: false,
      branch: null,
      commit: null,
      ghAvailable: false,
      findings: [],
    });
    const dir = branchChange();
    saveDeliveryReading(root, {
      ran: true,
      branch: 'feat/x',
      commit: 'c',
      ghAvailable: false,
      findings: [],
    });
    expect(readFeatureDelivery(root, dir).ci ?? null).toBeNull();
  });

  it('records unreadable gh output as unknown', async () => {
    const result = await evaluateDelivery({
      projectRoot: root,
      policy: policy(),
      run: runner({ branch: ok('feat/x'), commit: ok('sha-1'), gh: ok('not json') }),
    });
    expect(result.ghAvailable).toBe(false);
    expect(result.ci).toMatchObject({ state: 'unknown', reason: 'gh returned unreadable output' });
  });

  it('reads a rollup as pass, fail, pending or unknown', () => {
    expect(readRollup([{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }]).state).toBe('pass');
    expect(readRollup([{ conclusion: 'FAILURE' }, { status: 'QUEUED' }])).toMatchObject({
      state: 'fail',
      done: 1,
      total: 2,
      reason: null,
    });
    expect(readRollup([{ state: 'PENDING' }]).state).toBe('pending');
    expect(readRollup(null)).toEqual({
      state: 'unknown',
      done: 0,
      total: 0,
      reason: 'no checks reported',
      jobs: [],
    });
  });

  it('names why gh could not answer', () => {
    expect(ghFailureReason({ stdout: '', exitCode: 1, timedOut: true })).toBe(
      'gh timed out after 10 s',
    );
    expect(ghFailureReason({ stdout: '', exitCode: 1, stderr: 'API rate limit exceeded' })).toBe(
      'gh is rate-limited',
    );
    expect(ghFailureReason({ stdout: '', exitCode: 1, stderr: 'You are not logged in' })).toBe(
      'gh is signed out',
    );
    expect(
      ghFailureReason({ stdout: '', exitCode: 1, stderr: 'no pull requests found for branch' }),
    ).toBe('no pull request for this branch');
    expect(ghFailureReason({ stdout: '', exitCode: 1 })).toBe('gh could not read the pull request');
  });
});
