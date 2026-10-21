import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  readFeatureDelivery,
  recordShip,
  setCommitDecision,
  type DeliveryPr,
  type DeliveryRecord,
} from '@/feature-evidence/delivery.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import { buildHudSnapshot, buildShip, computeDeliveryPlan } from '@/hud/snapshot.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { buildChangeTraceabilityMap } from '@/traceability/change-map.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';

import {
  checkout,
  cleanupScopeFixtures,
  commit,
  openChangeHere,
  repoRoot,
  runStage,
} from './scope-fixtures.js';

vi.mock('@/pipeline/delivery-policy.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/pipeline/delivery-policy.js')>();
  return { ...real, loadDeliveryPolicy: vi.fn(real.loadDeliveryPolicy) };
});

vi.mock('@/traceability/change-map.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/traceability/change-map.js')>();
  return { ...real, buildChangeTraceabilityMap: vi.fn(real.buildChangeTraceabilityMap) };
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
      'hud-snapshot (delivery policy): policy unreadable',
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

describe('AC-27: files changed and plan steps built', () => {
  afterEach(() => cleanupScopeFixtures());

  function writePlan(root: string, dir: string, steps: unknown): void {
    writeFileSync(join(root, featureFilePath(dir, 'plan')), JSON.stringify({ steps }));
  }

  it('counts the files this change touched and the plan steps whose files it touched', () => {
    const root = repoRoot();
    checkout(root, 'feat/plan', true);
    const S = 'ses-plan-steps';
    const dir = openChangeHere(root, S);
    runStage(root, S, 'planning');
    writePlan(root, dir, [
      { id: 'S1', description: 'a', files: ['src/a.ts'] },
      { id: 'S2', description: 'docs', files: ['./docs/b.md', 7] },
      { id: 'S3', description: 'nothing listed' },
    ]);
    mkdirSync(join(root, 'src'), { recursive: true });
    commit(root, 'src/a.ts', 'feat: a');
    writeFileSync(join(root, 'notes.txt'), 'untracked\n');

    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.ship?.files_changed).toBe(2);
    expect(snapshot.plan).toEqual({ steps: 3, done: 1 });

    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'b.md'), 'docs\n');
    expect(buildHudSnapshot(root, S).plan).toEqual({ steps: 3, done: 2 });
  });

  it('leaves both out when git cannot say, and the plan out when it has no steps', () => {
    const root = onboardedRoot();
    const S = 'ses-plan-no-git';
    const dir = openChange(root, S, 'full');
    writePlan(root, dir, [{ id: 'S1', description: 'a', files: ['src/a.ts'] }]);
    const snapshot = buildHudSnapshot(root, S, { now: NOW });
    expect(snapshot.ship?.files_changed).toBeNull();
    expect(snapshot.plan).toBeNull();
    expect(buildShip(readFeatureDelivery(root, dir)).files_changed).toBeNull();

    const repo = repoRoot();
    checkout(repo, 'feat/empty-plan', true);
    const R = 'ses-plan-empty';
    const empty = openChangeHere(repo, R);
    runStage(repo, R, 'planning');
    expect(buildHudSnapshot(repo, R).plan).toBeNull();
    writePlan(repo, empty, []);
    expect(buildHudSnapshot(repo, R).plan).toBeNull();
    writePlan(repo, empty, 'not a list');
    expect(buildHudSnapshot(repo, R)).toMatchObject({ plan: null, ship: { files_changed: 0 } });
  });

  it('is left out before a change opens', () => {
    const root = onboardedRoot();
    persistLedgerSessionId(root, 'ses-plan-idle');
    expect(buildHudSnapshot(root, 'ses-plan-idle', { now: NOW })).toMatchObject({
      plan: null,
      ship: null,
    });
  });
});

describe('AC-27: acceptance claims and the tests that prove them', () => {
  afterEach(() => cleanupScopeFixtures());

  const criterion = (id: string, then: string, proof: string) => ({
    criterion_id: id,
    given: 'a change',
    when: 'it is checked',
    then,
    proof_type: proof,
    status: 'pending',
    source: 'spec',
    linked_requirement_ids: [],
  });

  function writeSpec(root: string, dir: string, frozen: boolean): void {
    writeFileSync(
      join(root, featureFilePath(dir, 'specification')),
      JSON.stringify({
        schema_version: 2,
        spec_id: 'spec',
        spec_file: 'spec.md',
        spec_hash: 'hash',
        behaviour: ['FR-1: binds', 'FR-2: names'],
        acceptance_criteria: [
          criterion('AC-1', 'the band binds', 'automated'),
          criterion('AC-2', 'every hint names the command', 'automated'),
          criterion('AC-3', 'it looks right', 'visual'),
        ],
        invariants: [],
        open_questions: [],
        frozen: frozen
          ? { frozen_at: '2026-10-18T08:30:00.000Z', spec_hash: 'hash', signed_off_by: 'owner' }
          : null,
      }),
    );
  }

  function changeWithTests(session: string): { root: string; dir: string } {
    const root = repoRoot();
    checkout(root, `feat/${session}`, true);
    const dir = openChangeHere(root, session);
    runStage(root, session, 'planning');
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'tests', 'b.test.ts'), "it('AC-1: binds again', () => {});\n");
    writeFileSync(join(root, 'tests', 'a.test.ts'), "it('AC-1: binds first', () => {});\n");
    return { root, dir };
  }

  it('lists each automated criterion with its first proving test once the spec is frozen', () => {
    const S = 'ses-claims-frozen';
    const { root, dir } = changeWithTests(S);
    writeSpec(root, dir, true);
    expect(buildHudSnapshot(root, S).claims).toEqual([
      {
        kind: 'acceptance',
        id: 'AC-1',
        label: 'the band binds',
        test_id: 'tests/a.test.ts',
        verdict: 'pass',
      },
      {
        kind: 'acceptance',
        id: 'AC-2',
        label: 'every hint names the command',
        test_id: null,
        verdict: 'missing',
      },
    ]);
  });

  it('lists none before the freeze, and none when git cannot say which tests changed', () => {
    const S = 'ses-claims-open';
    const { root, dir } = changeWithTests(S);
    writeSpec(root, dir, false);
    expect(buildHudSnapshot(root, S).claims).toEqual([]);

    const plain = onboardedRoot();
    const P = 'ses-claims-no-git';
    const plainDir = openChange(plain, P, 'full');
    writeSpec(plain, plainDir, true);
    expect(buildHudSnapshot(plain, P, { now: NOW }).claims).toEqual([]);
  });

  it('keeps a fix-proof claim first, and leaves the claims out with a logged reason on a failure', () => {
    const S = 'ses-claims-broken';
    const { root, dir } = changeWithTests(S);
    writeSpec(root, dir, true);
    recordChangeConstants(root, dir, { kind: 'fix' });
    expect(buildHudSnapshot(root, S).claims.map((claim) => claim.kind)).toEqual([
      'fix-proof',
      'acceptance',
      'acceptance',
    ]);
    vi.mocked(buildChangeTraceabilityMap).mockImplementationOnce(() => {
      throw new Error('map unreadable');
    });
    expect(buildHudSnapshot(root, S).claims.map((claim) => claim.kind)).toEqual(['fix-proof']);
    expect(readFileSync(join(root, '.paqad/logs/hook-failures.log'), 'utf8')).toContain(
      'hud-snapshot (claims): map unreadable',
    );
  });
});
