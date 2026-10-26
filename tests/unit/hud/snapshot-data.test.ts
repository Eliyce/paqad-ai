import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHECKS_REPORT_SCHEMA_VERSION, writeFeatureChecks } from '@/checks/report-store.js';
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
import type { HudHighTable } from '@/hud/high-table-view.js';
import {
  buildHudSnapshot,
  buildRecordEvents,
  buildShip,
  computeDeliveryPlan,
  TIMELINE_COMMITS,
  type RecordEventSources,
} from '@/hud/snapshot.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { buildChangeTraceabilityMap } from '@/traceability/change-map.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';

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

    expect(buildHudSnapshot(root, S).plan).toBeNull();
    startStage(root, 'development', { sessionId: S, adapter: 'claude-code' });
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
          criterion('AC-4', '', 'automated'),
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
    expect(buildHudSnapshot(root, S).claims[0]).toMatchObject({ id: 'AC-1', verdict: 'mapped' });
    startStage(root, 'development', { sessionId: S, adapter: 'claude-code' });
    writeFeatureChecks(root, dir, {
      schema_version: CHECKS_REPORT_SCHEMA_VERSION,
      generated_at: new Date(Date.now() + 60_000).toISOString(),
      passed: true,
      ran: true,
      results: [],
    });
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
      { kind: 'acceptance', id: 'AC-4', label: 'AC-4', test_id: null, verdict: 'missing' },
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

  it('reads a change with no lane as graduated, and a spec with no criteria list as no claims', () => {
    const root = repoRoot();
    checkout(root, 'feat/no-lane', true);
    const S = 'ses-claims-no-lane';
    const dir = openFeatureChange(root, S, {
      adapter: 'claude-code',
      title: 'ORD-9 x',
      issue: 'ORD-9',
    });
    persistLedgerSessionId(root, S);
    writeWorkflowState(root, S, { active: { workflow: 'feature-development' }, paused: [] });
    runStage(root, S, 'planning');
    writeFileSync(
      join(root, featureFilePath(dir, 'specification')),
      JSON.stringify({
        frozen: { frozen_at: '2026-10-18T08:30:00.000Z' },
        acceptance_criteria: 'none',
      }),
    );
    vi.mocked(buildChangeTraceabilityMap).mockClear();
    expect(buildHudSnapshot(root, S).claims).toEqual([]);
    expect(vi.mocked(buildChangeTraceabilityMap).mock.calls[0]?.[0]).toMatchObject({
      lane: 'graduated',
    });
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

describe('AC-27: the Record events', () => {
  const at = (time: string) => `2026-10-18T${time}.000Z`;
  const clock = (time: string) => () => new Date(at(time));

  function openAt(root: string, session: string): string {
    const dir = openFeatureChange(root, session, {
      adapter: 'claude-code',
      title: 'ORD-501 csv export',
      issue: 'ORD-501',
      lane: 'full',
      now: clock('08:00:00'),
    });
    persistLedgerSessionId(root, session);
    writeWorkflowState(root, session, {
      active: { workflow: 'feature-development', lane: 'full', reason: 'a full change' },
      paused: [],
    });
    return dir;
  }

  it('names the change, each stage start by its agent and each stage end by its duration', () => {
    const root = onboardedRoot();
    const S = 'ses-record-stages';
    openAt(root, S);
    const ctx = { sessionId: S, adapter: 'claude-code' };
    startStage(root, 'planning', { ...ctx, agent: 'paqad:paqad-planning', now: clock('08:01:00') });
    endStage(root, 'planning', {}, { ...ctx, now: clock('08:02:41') });
    startStage(root, 'specification', { ...ctx, now: clock('08:03:00') });
    startStage(root, 'development', { ...ctx, agent: 'orchestrator', now: clock('08:05:00') });
    endStage(root, 'review', {}, { ...ctx, now: clock('08:06:00') });

    const timeline = buildHudSnapshot(root, S, { now: NOW }).timeline;
    const find = (kind: string, stage: string | null = null) =>
      timeline.find((entry) => entry.kind === kind && entry.stage === stage);
    expect(find('open')).toMatchObject({
      at: at('08:00:00'),
      title: 'csv-export',
      issue: 'ORD-501',
      lane: 'full',
    });
    expect(find('stage_start', 'planning')).toMatchObject({
      agent: 'paqad:paqad-planning',
      own_agent: true,
    });
    expect(find('stage_end', 'planning')).toMatchObject({ duration_ms: 101_000 });
    expect(find('stage_start', 'specification')).toMatchObject({ own_agent: false });
    expect(find('stage_start', 'development')).toMatchObject({
      agent: 'orchestrator',
      own_agent: false,
    });
    expect(find('stage_end', 'review')).toMatchObject({ duration_ms: null });
    const times = timeline.map((entry) => Date.parse(entry.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  const seat = (fields: Record<string, unknown>) => ({
    role: 'qa-engineer',
    origin: 'standing',
    state: 'done',
    seated_at: null,
    started_at: null,
    done_at: null,
    findings: null,
    ...fields,
  });

  function sources(over: Partial<RecordEventSources> = {}): RecordEventSources {
    const delivery = {
      schema_version: 2,
      doc_type: 'paqad.delivery',
      commits: [
        { sha: 'a1c9e2f0001', subject: 'one' },
        { sha: 'b2d8f3a0002', subject: 'two' },
        { sha: 'c3e7a4b0003', subject: 'theirs' },
      ],
      head_sha: null,
      merge_commit: null,
      commit_split: { own_shas: ['a1c9e2f0001', 'b2d8f3a0002'], inherited_shas: ['c3e7a4b0003'] },
    } as unknown as DeliveryRecord;
    return {
      rulesLoaded: { recorded_at: at('08:03:00'), applicable_rules: ['r1', 'r2', 'r3'] },
      table: {
        skipped: false,
        seats: [
          seat({ seated_at: at('08:06:00'), done_at: at('08:09:00'), findings: 3 }),
          seat({
            role: 'security-auditor',
            origin: 'picked',
            seated_at: at('08:05:00'),
            done_at: at('08:10:00'),
          }),
        ],
        chief: {
          ...seat({ started_at: at('08:10:00'), done_at: at('08:11:35') }),
          verdict: 'needs answers',
        },
      } as unknown as HudHighTable,
      decisions: [
        {
          packet: {
            id: 'D-1',
            title: 'Which export format?',
            created_at: at('08:12:01'),
            resolved_at: at('08:20:00'),
          },
          status: 'resolved',
        },
        { packet: { id: 'D-2', title: 'Email?', created_at: at('08:12:30') }, status: 'pending' },
        { packet: { id: 'D-3', created_at: at('08:15:00') }, status: 'pending' },
      ] as unknown as RecordEventSources['decisions'],
      specJson: {
        frozen: { frozen_at: at('08:13:00') },
        behaviour: ['FR-1: a', 'FR-2: b'],
        acceptance_criteria: [{}, {}, {}],
      },
      delivery,
      ship: {
        ...buildShip(delivery),
        push: { state: 'pushed', branch: 'feat/x', sha: 'b2d8f3a0002', at: at('08:40:00') },
        pr: { number: 702, url: null, draft: false, first_at: at('08:45:00'), at: at('09:00:00') },
        ci: {
          sha: null,
          state: 'pass',
          done: 6,
          total: 6,
          reason: null,
          source: 'stop-check',
          jobs: [
            {
              name: 'lint',
              status: null,
              conclusion: 'SUCCESS',
              started_at: null,
              completed_at: at('08:50:00'),
            },
            {
              name: 'unit',
              status: null,
              conclusion: 'SUCCESS',
              started_at: null,
              completed_at: at('08:55:00'),
            },
          ],
          at: at('09:00:00'),
        },
      },
      commitTimes: new Map([
        ['a1c9e2f0001', at('08:30:00')],
        ['c3e7a4b0003', at('08:31:00')],
      ]),
      ...over,
    };
  }

  it('lists rules, the High Table, decisions, the freeze and each delivery step from their records', () => {
    expect(buildRecordEvents(sources())).toEqual([
      { at: at('08:03:00'), kind: 'rules_loaded', stage: null, note: null, count: 3 },
      { at: at('08:05:00'), kind: 'table_seated', stage: null, note: null, picked: 1, standing: 1 },
      { at: at('08:10:00'), kind: 'notes_landed', stage: null, note: null, count: 2, findings: 3 },
      {
        at: at('08:11:35'),
        kind: 'chief_ruled',
        stage: null,
        note: null,
        duration_ms: 95_000,
        verdict: 'needs answers',
      },
      {
        at: at('08:12:01'),
        kind: 'decision_opened',
        stage: null,
        note: null,
        decision: 'D-1',
        subject: 'Which export format?',
      },
      { at: at('08:20:00'), kind: 'decision_answered', stage: null, note: null, decision: 'D-1' },
      {
        at: at('08:12:30'),
        kind: 'decision_opened',
        stage: null,
        note: null,
        decision: 'D-2',
        subject: 'Email?',
      },
      { at: at('08:15:00'), kind: 'decision_opened', stage: null, note: null, decision: 'D-3' },
      {
        at: at('08:13:00'),
        kind: 'spec_frozen',
        stage: null,
        note: null,
        requirements: 2,
        criteria: 3,
      },
      {
        at: at('08:30:00'),
        kind: 'commit',
        stage: null,
        note: null,
        sha: 'a1c9e2f',
        subject: 'one',
      },
      { at: at('08:40:00'), kind: 'push', stage: null, note: null, state: 'pushed', count: 2 },
      { at: at('08:45:00'), kind: 'pr_opened', stage: null, note: null, number: 702 },
      { at: at('08:55:00'), kind: 'ci', stage: null, note: null, state: 'pass', count: 6 },
    ]);
  });

  it('leaves out what has not happened yet, and anything without a readable time', () => {
    const base = sources();
    const writing = {
      ...base.table!,
      seats: [seat({ seated_at: at('08:05:00'), state: 'writing' })],
      chief: null,
    } as unknown as HudHighTable;
    const quiet = buildRecordEvents({
      ...base,
      rulesLoaded: null,
      table: writing,
      decisions: [],
      specJson: { frozen: null },
      ship: {
        ...base.ship,
        push: { state: 'pushed', branch: null, sha: null, at: 'not a time' },
        pr: { number: null, url: null, draft: null, at: at('08:45:00') },
        ci: { ...base.ship.ci!, state: 'pending' },
      },
      commitTimes: new Map(),
    });
    expect(quiet.map((entry) => entry.kind)).toEqual(['table_seated']);
    expect(
      buildRecordEvents({ ...base, table: { ...writing, skipped: true } }).some(
        (entry) => entry.kind === 'table_seated',
      ),
    ).toBe(false);
    const noJobs = buildRecordEvents({
      ...base,
      ship: {
        ...base.ship,
        pr: null,
        ci: { ...base.ship.ci!, jobs: undefined, total: null, state: 'fail' },
      },
    });
    expect(noJobs.find((entry) => entry.kind === 'ci')).toMatchObject({
      at: at('09:00:00'),
      state: 'fail',
      count: 0,
    });
    expect(noJobs.some((entry) => entry.kind === 'pr_opened')).toBe(false);
  });

  it('says only what it knows when a start time, a first sighting or a rule count is missing', () => {
    const base = sources();
    const chiefOf = (fields: Record<string, unknown>) =>
      ({
        ...base.table!,
        chief: { ...seat(fields), verdict: 'approved' },
      }) as unknown as HudHighTable;
    const events = buildRecordEvents({
      ...base,
      rulesLoaded: { recorded_at: at('08:03:00') },
      table: chiefOf({ started_at: null, done_at: at('08:11:00') }),
      ship: { ...base.ship, pr: { number: 9, url: null, draft: null, at: at('08:44:00') } },
    });
    expect(events.find((entry) => entry.kind === 'rules_loaded')).toMatchObject({ count: 0 });
    expect(events.find((entry) => entry.kind === 'chief_ruled')).toMatchObject({
      duration_ms: null,
      verdict: 'approved',
    });
    expect(events.find((entry) => entry.kind === 'pr_opened')).toMatchObject({
      at: at('08:44:00'),
      number: 9,
    });
    const backwards = buildRecordEvents({
      ...base,
      table: chiefOf({ started_at: at('08:12:00'), done_at: at('08:11:00') }),
    });
    expect(backwards.find((entry) => entry.kind === 'chief_ruled')?.duration_ms).toBeNull();
  });

  it('keeps the last ten commits of this change, and every commit when the split is unknown', () => {
    const commits = Array.from({ length: 12 }, (_, i) => ({ sha: `sha${i}`, subject: `c${i}` }));
    const delivery = { ...sources().delivery, commits, commit_split: null };
    const events = buildRecordEvents(
      sources({
        delivery,
        commitTimes: new Map(commits.map((c, i) => [c.sha, at(`08:${String(30 + i)}:00`)])),
      }),
    ).filter((entry) => entry.kind === 'commit');
    expect(events).toHaveLength(TIMELINE_COMMITS);
    expect(events[0]).toMatchObject({ subject: 'c2' });
  });

  it('merges the events into the snapshot timeline in time order, and drops them with a logged reason on bad data', () => {
    const root = onboardedRoot();
    const S = 'ses-record-merge';
    const dir = openAt(root, S);
    writeFileSync(
      join(root, featureFilePath(dir, 'specification')),
      JSON.stringify({
        frozen: { frozen_at: at('08:13:00') },
        behaviour: ['FR-1'],
        acceptance_criteria: [],
      }),
    );
    startStage(root, 'planning', { sessionId: S, adapter: 'claude-code', now: clock('08:20:00') });
    const kinds = buildHudSnapshot(root, S, { now: NOW }).timeline.map((entry) => entry.kind);
    expect(kinds).toEqual(['open', 'spec_frozen', 'stage_start']);

    writeFileSync(
      join(root, featureFilePath(dir, 'delivery')),
      JSON.stringify({
        schema_version: 2,
        doc_type: 'paqad.delivery',
        commits: [],
        head_sha: null,
        merge_commit: null,
        ci: { state: 'pass', jobs: {}, at: at('08:30:00') },
      }),
    );
    const broken = buildHudSnapshot(root, S, { now: NOW });
    expect(broken.timeline.map((entry) => entry.kind)).toEqual(['open', 'stage_start']);
    expect(readFileSync(join(root, '.paqad/logs/hook-failures.log'), 'utf8')).toContain(
      'hud-snapshot (record events):',
    );
  });
});

describe('AC-8: the snapshot carries Trust proof by the lane stages', () => {
  it('holds one entry per fast-lane stage, with no gate from outside the lane', () => {
    const root = onboardedRoot();
    const S = 'ses-proof-fast';
    const dir = openChange(root, S, 'fast');
    writeFileSync(
      join(root, featureFilePath(dir, 'plan')),
      JSON.stringify({ steps: [{ id: 'S1', description: 'a', files: ['src/a.ts'] }] }),
    );
    const snapshot = buildHudSnapshot(root, S, { now: NOW });
    expect(snapshot.proof?.map((entry) => entry.words)).toEqual(['Plan', 'Build', 'Checks']);
    expect(snapshot.proof?.[0]?.steps[0]).toEqual({
      id: 'plan',
      words: 'Plan compiled',
      detail: '1 step',
      state: 'done',
    });
    const codes = snapshot.proof?.flatMap((entry) => entry.gates.map((gate) => gate.code)) ?? [];
    for (const code of ['spec-review', 'implementation-review', 'documentation-freshness']) {
      expect(codes).not.toContain(code);
    }
  });

  it('holds the six full-lane stages, and is left out before a change opens', () => {
    const root = onboardedRoot();
    openChange(root, 'ses-proof-full', 'full');
    expect(buildHudSnapshot(root, 'ses-proof-full', { now: NOW }).proof?.length).toBe(6);
    const idle = onboardedRoot();
    persistLedgerSessionId(idle, 'ses-proof-idle');
    expect(buildHudSnapshot(idle, 'ses-proof-idle', { now: NOW }).proof).toBeUndefined();
  });
});

describe('AC-8 / AC-26: a branch with earlier work and local files shows none of it as this change', () => {
  afterEach(() => cleanupScopeFixtures());

  it('no Edits made, no Docs updated, 0 plan steps built and no claim pass right after open', () => {
    const root = repoRoot();
    checkout(root, 'release', true);
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    commit(root, 'docs/earlier.md', 'docs: earlier work (#1234)');
    writeFileSync(join(root, 'tests', 'earlier.test.ts'), "it('AC-1: binds first', () => {});\n");
    commit(root, 'src-earlier.ts', 'feat: earlier work');
    checkout(root, 'feat/next', true);
    writeFileSync(join(root, 'local.txt'), 'untracked before open\n');
    writeFileSync(join(root, 'README.md'), 'modified before open\n');
    const S = 'ses-earlier-work';
    const dir = openChangeHere(root, S);
    runStage(root, S, 'planning');
    writeFileSync(
      join(root, featureFilePath(dir, 'plan')),
      JSON.stringify({
        steps: [
          { id: 'S1', description: 'docs', files: ['docs/earlier.md'] },
          { id: 'S2', description: 'code', files: ['src-earlier.ts'] },
        ],
      }),
    );
    startStage(root, 'development', { sessionId: S, adapter: 'claude-code' });

    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.ship?.files_changed).toBe(0);
    expect(snapshot.plan).toEqual({ steps: 2, done: 0 });
    expect(snapshot.claims.some((claim) => claim.verdict === 'pass')).toBe(false);
    expect(snapshot.flags.map((flag) => flag.id)).not.toContain('branch:shared');
    expect(snapshot.start_point).toMatchObject({ source: 'start_commit', files_known: true });
    const steps = (snapshot.proof ?? []).flatMap((entry) => entry.steps);
    expect(steps.find((entry) => entry.id === 'edits')?.state).toBe('not-yet');
    expect(steps.find((entry) => entry.id === 'docs')?.state ?? 'not-yet').toBe('not-yet');
  });
});
