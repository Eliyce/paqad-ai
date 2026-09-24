import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { VerificationOrigin } from '@/core/types/verification.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import { openFeatureChange, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { writeWorkflowState, type WorkflowState } from '@/pipeline/workflow-state.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { NON_FEATURE_SKIP_DOC_TYPE } from '@/session-ledger/non-feature-skip-audit.js';
import { startStage } from '@/stage-evidence/recorder.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext } from '../shared.fixture.js';

// Issue #582 (replacing the #499 route guess) — the in-session completion backstop runs
// checks only for a session that OWNS a change: agent-authored stage rows stamped with its
// own id in an unclosed bundle. A session that owns nothing, or an owner on a non-feature
// detour that edited nothing this turn, is skipped, whatever the working tree holds.

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-nonfeature-verify-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** A temp git repo on `feat/login` with one commit, so bundles stamp a real branch. */
function tempRepo(): string {
  const root = tempRoot();
  const g = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  g('init', '-q', '-b', 'feat/login');
  g('config', 'user.email', 't@t.dev');
  g('config', 'user.name', 'Test');
  writeFileSync(join(root, 'a.txt'), 'a');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: base');
  return root;
}

const SES = 'ses_499';
const A = 'ses_582_owner';
const B = 'ses_582_question';
const TURN = '2026-03-01T10:00:00.000Z';
const BEFORE_TURN = () => new Date('2026-03-01T09:00:00.000Z');
const DURING_TURN = () => new Date('2026-03-01T10:05:00.000Z');
const FEATURE_DIR = join('.paqad', 'ledger', 'feature-evidence');

/** A prebuilt context standing in for a dirty working tree (a hand-edited source file). */
function dirtyContext(root: string, origin: VerificationOrigin) {
  return {
    context: createVerificationContext({
      project_root: root,
      verification_origin: origin,
      changed_files: ['src/anything.ts'],
      code_changed: true,
    }),
    escalations: [] as string[],
  };
}

function skipAuditRows(root: string, session = SES) {
  return readSessionDoc(root, NON_FEATURE_SKIP_DOC_TYPE, session);
}

function stop(root: string, session: string, origin: VerificationOrigin = 'hook-completion') {
  return runRepositoryVerification({
    projectRoot: root,
    origin,
    prebuiltContext: dirtyContext(root, origin),
    hostSessionId: session,
    now: () => '2026-03-01T10:10:00.000Z',
  });
}

/** Session `session` opens a change and live-marks a development start at `now`. */
function ownChange(root: string, session: string, now: () => Date = BEFORE_TURN): string {
  const dirName = openFeatureChange(root, session, {
    adapter: 'claude-code',
    title: 'login',
    issue: null,
    now,
  });
  startStage(root, 'development', { sessionId: session, dirName, adapter: 'claude-code', now });
  return dirName;
}

function route(root: string, session: string, state: WorkflowState): void {
  writeWorkflowState(root, session, state);
}

function featureDirs(root: string): string[] {
  const dir = join(root, FEATURE_DIR);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe('runRepositoryVerification — session-owned enforcement (issue #582)', () => {
  it('AC-1: skips a question session while another session owns an in-flight change', async () => {
    const root = tempRepo();
    route(root, A, {
      active: { workflow: 'feature-development', lane: 'graduated' },
      paused: [],
      turn_started_at: TURN,
    });
    const dirA = ownChange(root, A);
    route(root, B, { active: { workflow: 'project-question' }, paused: [], turn_started_at: TURN });
    const rowsBefore = readFeatureStageUnit(root, dirA).length;

    const verdict = await stop(root, B);

    expect(verdict.ok).toBe(true);
    expect(verdict.gates).toEqual([]);
    expect(verdict.summary).toContain('verification not applicable');
    expect(verdict.summary).toContain('made no code change of its own');
    // B was never repointed at A's bundle, and A's bundle gained nothing.
    expect(readSessionControl(root, B).active).toBeNull();
    expect(readFeatureStageUnit(root, dirA)).toHaveLength(rowsBefore);
    const rows = skipAuditRows(root, B);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'not-owner',
      workflow: 'project-question',
      origin: 'hook-completion',
    });
  });

  it('AC-2: the owning session still fails stage-evidence in the same setup', async () => {
    const root = tempRepo();
    route(root, A, {
      active: { workflow: 'feature-development', lane: 'graduated' },
      paused: [],
      turn_started_at: TURN,
    });
    ownChange(root, A);
    route(root, B, { active: { workflow: 'project-question' }, paused: [], turn_started_at: TURN });

    const verdict = await stop(root, A);

    expect(verdict.ok).toBe(false);
    expect(verdict.gates.find((g) => g.gate === 'stage-evidence')?.status).toBe('fail');
    expect(skipAuditRows(root, A)).toHaveLength(0);
  });

  it('AC-3: skips a session with no route state and no owned rows on a dirty tree', async () => {
    const root = tempRoot();
    // No writeWorkflowState and no bundle: this session never routed and never edited.
    const verdict = await stop(root, SES);

    expect(verdict.ok).toBe(true);
    expect(verdict.gates).toEqual([]);
    expect(verdict.evidence_path).toBeNull();
    expect(skipAuditRows(root)).toHaveLength(1);
    // No inferred-git change record was minted (no feature bundle created at all).
    expect(existsSync(join(root, FEATURE_DIR))).toBe(false);
    // No verification-evidence.json written.
    expect(existsSync(join(root, '.paqad/session/verification-evidence.json'))).toBe(false);
  });

  it('AC-4: an owner on a detour skips, then enforces when the next turn resumes feature work', async () => {
    const root = tempRepo();
    ownChange(root, SES);
    route(root, SES, {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development', lane: 'full' }],
      turn_started_at: TURN,
    });

    const detour = await stop(root, SES);

    expect(detour.ok).toBe(true);
    expect(detour.summary).toContain('project-question');
    expect(detour.summary).toContain('checked when it resumes');
    expect(skipAuditRows(root)).toHaveLength(1);
    expect(skipAuditRows(root)[0]).toMatchObject({
      reason: 'detour',
      workflow: 'project-question',
    });

    route(root, SES, {
      active: { workflow: 'feature-development', lane: 'full' },
      paused: [{ workflow: 'project-question' }],
      turn_started_at: '2026-03-01T11:00:00.000Z',
    });

    const resumed = await stop(root, SES);

    expect(resumed.summary).not.toContain('verification not applicable');
    expect(resumed.ok).toBe(false);
  });

  it('AC-5: a live-mark row written this turn enforces even under a non-feature route', async () => {
    const root = tempRoot();
    route(root, SES, {
      active: { workflow: 'project-question' },
      paused: [],
      turn_started_at: TURN,
    });
    // A real edit passes the pre-mutation gate and live-marks a stage during the turn.
    ownChange(root, SES, DURING_TURN);

    const verdict = await stop(root, SES);

    expect(skipAuditRows(root)).toHaveLength(0);
    expect(verdict.summary).not.toContain('verification not applicable');
  });

  it('AC-6: a session that owns nothing creates no bundle and no verify row', async () => {
    const root = tempRepo();
    const dirA = ownChange(root, A);
    const before = featureDirs(root);
    route(root, B, { active: { workflow: 'feature-development', lane: 'fast' }, paused: [] });

    await stop(root, B);

    expect(featureDirs(root)).toEqual(before);
    expect(readFeatureStageUnit(root, dirA).some((row) => row.kind === 'verify')).toBe(false);
  });

  it('records exactly one audit row per session across repeated skips', async () => {
    const root = tempRoot();
    route(root, SES, { active: { workflow: 'documentation-update' }, paused: [] });

    await stop(root, SES);
    await stop(root, SES);

    const rows = skipAuditRows(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'not-owner', workflow: 'documentation-update' });
  });

  it.each<VerificationOrigin>(['git-backstop', 'ci-backstop'])(
    'AC-8: does NOT consult ownership or route state at the %s origin',
    async (origin) => {
      const root = tempRoot();
      route(root, SES, { active: { workflow: 'project-question' }, paused: [] });

      const verdict = await stop(root, SES, origin);

      expect(skipAuditRows(root)).toHaveLength(0);
      expect(verdict.summary).not.toContain('verification not applicable');
    },
  );
});
