import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { VerificationOrigin } from '@/core/types/verification.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { NON_FEATURE_SKIP_DOC_TYPE } from '@/session-ledger/non-feature-skip-audit.js';
import { startStage } from '@/stage-evidence/recorder.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext } from '../shared.fixture.js';

// Issue #499 — the completion backstop must run NO checks when the session never routed
// to feature-development. A dirty working tree swept up by the git-status fallback must
// not be forced through the stages a question / docs / RCA turn never owed.

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-nonfeature-verify-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const SES = 'ses_499';

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

function skipAuditRows(root: string) {
  return readSessionDoc(root, NON_FEATURE_SKIP_DOC_TYPE, SES);
}

describe('runRepositoryVerification — non-feature route skip (issue #499)', () => {
  it('AC-1: skips all checks on a dirty tree for a non-feature session', async () => {
    const root = tempRoot();
    writeWorkflowState(root, SES, { active: { workflow: 'project-question' }, paused: [] });

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: dirtyContext(root, 'hook-completion'),
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.gates).toEqual([]);
    expect(verdict.evidence_path).toBeNull();
    // No inferred-git change record was minted (no feature bundle created at all).
    expect(existsSync(join(root, '.paqad/ledger/feature-evidence'))).toBe(false);
    // No verification-evidence.json written.
    expect(existsSync(join(root, '.paqad/session/verification-evidence.json'))).toBe(false);
  });

  it('AC-2: does NOT skip when no route state exists (unknown → fail-closed)', async () => {
    const root = tempRoot();
    // No writeWorkflowState → unknown route.
    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: dirtyContext(root, 'hook-completion'),
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    // The skip is the ONLY writer of the non-feature-skip audit; its absence proves the
    // full verification ran instead.
    expect(skipAuditRows(root)).toHaveLength(0);
    expect(verdict.summary).not.toContain('verification not applicable');
  });

  it('AC-3: does NOT skip when a feature-development change is paused (detour to a question)', async () => {
    const root = tempRoot();
    writeWorkflowState(root, SES, {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development' }],
    });

    await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: dirtyContext(root, 'hook-completion'),
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(skipAuditRows(root)).toHaveLength(0);
  });

  it('AC-4: records exactly one audit row and names the routed workflow', async () => {
    const root = tempRoot();
    writeWorkflowState(root, SES, { active: { workflow: 'documentation-update' }, paused: [] });

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: dirtyContext(root, 'hook-completion'),
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const rows = skipAuditRows(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'non-feature-route',
      workflow: 'documentation-update',
      origin: 'hook-completion',
    });
    expect(verdict.summary).toContain('documentation-update');
  });

  it('AC-4: falls back to a generic label when only a paused non-feature entry exists', async () => {
    const root = tempRoot();
    // No active entry, a single paused non-feature route → still affirmatively non-feature,
    // but no active workflow name to render.
    writeWorkflowState(root, SES, { active: null, paused: [{ workflow: 'pentest' }] });

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: dirtyContext(root, 'hook-completion'),
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(true);
    expect(skipAuditRows(root)).toHaveLength(1);
    expect(verdict.summary).toContain('non-feature');
  });

  it.each<VerificationOrigin>(['git-backstop', 'ci-backstop'])(
    'AC-5: does NOT consult route state at the %s origin',
    async (origin) => {
      const root = tempRoot();
      writeWorkflowState(root, SES, { active: { workflow: 'project-question' }, paused: [] });

      await runRepositoryVerification({
        projectRoot: root,
        origin,
        prebuiltContext: dirtyContext(root, origin),
        hostSessionId: SES,
        now: () => '2026-01-01T00:00:00.000Z',
      });

      expect(skipAuditRows(root)).toHaveLength(0);
    },
  );

  it('AC-6: does NOT skip when the session recorded an agent-authored live-mark stage', async () => {
    const root = tempRoot();
    writeWorkflowState(root, SES, { active: { workflow: 'project-question' }, paused: [] });
    // A real edit would pass the pre-mutation gate and live-mark a stage; simulate that.
    const dirName = openFeatureChange(root, SES, { adapter: 'claude-code', title: 'x', issue: null });
    startStage(root, 'development', { sessionId: SES, dirName, adapter: 'claude-code' });

    await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: dirtyContext(root, 'hook-completion'),
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(skipAuditRows(root)).toHaveLength(0);
  });
});
