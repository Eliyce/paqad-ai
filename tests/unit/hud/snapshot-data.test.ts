import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  recordShip,
  setCommitDecision,
  type DeliveryPr,
  type DeliveryRecord,
} from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { buildHudSnapshot, buildShip, computeDeliveryPlan } from '@/hud/snapshot.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';

vi.mock('@/pipeline/delivery-policy.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/pipeline/delivery-policy.js')>();
  return { ...real, loadDeliveryPolicy: vi.fn(real.loadDeliveryPolicy) };
});

const NOW = () => new Date('2026-10-18T09:00:00.000Z');
const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function onboardedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-hud-data-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
  return root;
}

function openChange(root: string, session: string, lane: 'fast' | 'graduated' | 'full'): string {
  const dir = openFeatureChange(root, session, {
    adapter: 'claude-code',
    title: 'ORD-501 csv export',
    issue: 'ORD-501',
    lane,
  });
  persistLedgerSessionId(root, session);
  writeWorkflowState(root, session, {
    active: { workflow: 'feature-development', lane, reason: `a ${lane} change` },
    paused: [],
  });
  return dir;
}

function writePolicy(root: string, yaml: string): void {
  mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
  writeFileSync(join(root, PATHS.WORKFLOWS_DIR, 'delivery-policy.yaml'), yaml);
}

function addWorkflow(root: string, name: string): void {
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', name), 'on: push\n');
}

describe('AC-27: the delivery plan', () => {
  it('commits, pushes, opens a PR and merges by default; CI only when the gate is on and CI exists', () => {
    const base = { enabled: true, commitDeclined: false, ciGate: 'wait_for_green', hasCi: true };
    expect(computeDeliveryPlan(base)).toEqual({
      commit: true,
      push: true,
      pr: true,
      ci: true,
      merge: true,
      reason: null,
    });
    expect(computeDeliveryPlan({ ...base, ciGate: 'warn_only' }).ci).toBe(true);
    expect(computeDeliveryPlan({ ...base, ciGate: 'off' })).toMatchObject({
      pr: true,
      ci: false,
      reason: 'No CI',
    });
    expect(computeDeliveryPlan({ ...base, hasCi: false })).toMatchObject({
      ci: false,
      reason: 'No CI',
    });
  });

  it('stops at the edit when the commit is declined, and at the commit when the policy is off', () => {
    const base = { enabled: true, commitDeclined: false, ciGate: 'wait_for_green', hasCi: true };
    expect(computeDeliveryPlan({ ...base, commitDeclined: true })).toEqual({
      commit: false,
      push: false,
      pr: false,
      ci: false,
      merge: false,
      reason: 'Edit only · no commit',
    });
    expect(computeDeliveryPlan({ ...base, enabled: false })).toEqual({
      commit: true,
      push: false,
      pr: false,
      ci: false,
      merge: false,
      reason: 'No push for this change',
    });
  });

  it('is in the snapshot before a change opens, read from the policy and the repo', () => {
    const root = onboardedRoot();
    persistLedgerSessionId(root, 'ses-plan-idle');
    expect(buildHudSnapshot(root, 'ses-plan-idle', { now: NOW }).delivery_plan).toEqual({
      commit: true,
      push: true,
      pr: true,
      ci: false,
      merge: true,
      reason: 'No CI',
    });
    addWorkflow(root, 'README.md');
    expect(buildHudSnapshot(root, 'ses-plan-idle', { now: NOW }).delivery_plan?.ci).toBe(false);
    addWorkflow(root, 'ci.yaml');
    expect(buildHudSnapshot(root, 'ses-plan-idle', { now: NOW }).delivery_plan).toMatchObject({
      ci: true,
      reason: null,
    });
  });

  it('follows the commit decision, the policy switch and the CI gate of an open change', () => {
    const root = onboardedRoot();
    const S = 'ses-plan-open';
    const dir = openChange(root, S, 'fast');
    addWorkflow(root, 'ci.yml');
    expect(buildHudSnapshot(root, S, { now: NOW }).delivery_plan).toMatchObject({
      commit: true,
      ci: true,
      reason: null,
    });
    writePolicy(root, 'schema_version: "1"\nprocess:\n  ci:\n    gate: "off"\n');
    expect(buildHudSnapshot(root, S, { now: NOW }).delivery_plan).toMatchObject({
      pr: true,
      ci: false,
      reason: 'No CI',
    });
    writePolicy(root, 'schema_version: "1"\nenabled: false\n');
    expect(buildHudSnapshot(root, S, { now: NOW }).delivery_plan).toMatchObject({
      commit: true,
      push: false,
      reason: 'No push for this change',
    });
    setCommitDecision(root, dir, 'decline', NOW().toISOString());
    expect(buildHudSnapshot(root, S, { now: NOW }).delivery_plan).toMatchObject({
      commit: false,
      reason: 'Edit only · no commit',
    });
  });

  it('is left out, and the failure logged, when the policy cannot be read', () => {
    const root = onboardedRoot();
    const S = 'ses-plan-broken';
    openChange(root, S, 'full');
    vi.mocked(loadDeliveryPolicy).mockImplementationOnce(() => {
      throw new Error('policy unreadable');
    });
    const snapshot = buildHudSnapshot(root, S, { now: NOW });
    expect(snapshot.delivery_plan).toBeNull();
    expect(snapshot.active).toBe(true);
    expect(readFileSync(join(root, '.paqad/logs/hook-failures.log'), 'utf8')).toContain(
      'hud-snapshot (delivery plan): policy unreadable',
    );
  });
});

describe('AC-27: the pull request title and size', () => {
  const delivery = (pr: Partial<DeliveryPr> | null): DeliveryRecord => ({
    schema_version: 2,
    doc_type: 'paqad.delivery',
    commits: [{ sha: 'a1c9e2f000', subject: 'Seed stage helpers' }],
    head_sha: 'a1c9e2f000',
    merge_commit: null,
    commit_split: {
      own: { count: 1, tickets: [] },
      inherited: null,
      own_shas: ['a1c9e2f000'],
      inherited_shas: [],
    } as unknown as DeliveryRecord['commit_split'],
    pr: pr
      ? {
          number: 12,
          url: 'https://example.test/pull/12',
          draft: false,
          at: '2026-10-18T08:00Z',
          ...pr,
        }
      : null,
  });

  it('sits at the top level of ship, beside the PR state', () => {
    const ship = buildShip(
      delivery({
        state: 'open',
        head_sha: 'a1c9e2f000',
        title: 'Seed stage helpers',
        changed_files: 14,
        additions: 412,
        deletions: 87,
      }),
    );
    expect(ship).toMatchObject({
      pr_state: 'open',
      pr_title: 'Seed stage helpers',
      pr_files: 14,
      pr_additions: 412,
      pr_deletions: 87,
    });
  });

  it('is left out when gh never read it, or the PR is not this change', () => {
    const unread = buildShip(delivery({ state: 'open', head_sha: 'a1c9e2f000' }));
    expect(unread).toMatchObject({
      pr_title: null,
      pr_files: null,
      pr_additions: null,
      pr_deletions: null,
    });
    const foreign = buildShip(
      delivery({ state: 'open', head_sha: 'someone-else', title: 'Not ours', additions: 3 }),
    );
    expect(foreign).toMatchObject({ pr: null, pr_title: null, pr_additions: null });
    expect(buildShip(delivery(null))).toMatchObject({ pr_title: null, pr_files: null });
  });

  it('reaches the snapshot from delivery.json', () => {
    const root = onboardedRoot();
    const S = 'ses-pr-size';
    const dir = openChange(root, S, 'full');
    recordShip(
      root,
      dir,
      {
        pr: {
          number: 12,
          title: 'Seed stage helpers',
          changed_files: 14,
          additions: 412,
          deletions: 87,
        },
      },
      NOW().toISOString(),
    );
    expect(buildHudSnapshot(root, S, { now: NOW }).ship).toMatchObject({
      pr_title: 'Seed stage helpers',
      pr_files: 14,
      pr_additions: 412,
      pr_deletions: 87,
    });
  });
});
