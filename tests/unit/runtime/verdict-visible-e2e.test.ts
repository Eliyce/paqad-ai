import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { endStage, openStageEvidence, startStage } from '@/stage-evidence/index.js';

import { createVerificationContext } from '../verification/shared.fixture.js';

// Issue #368 — the end-to-end proof of the #353 disaster's fix. A feature-development
// change that reaches completion missing mandatory stages (review, documentation_sync)
// must:
//   1. compute a real "Needs your attention" verdict (never a hidden clean pass), and
//   2. surface that receipt to the DEVELOPER through the real Stop-hook backstop as a
//      visible {systemMessage} + a {decision:block} that keeps the model working.
// Both halves are exercised for real: the verdict is computed by the real
// runRepositoryVerification over a real on-disk stage-evidence ledger; the surfacing is
// the real runVerificationBackstop. The dist api is stubbed ONLY to hand the already-real
// verdict to the hook (dist is not rebuilt in unit mode), so no behavior is faked.
const DIST = resolve(process.cwd(), 'dist/index.js');

function capture() {
  let text = '';
  return { stream: { write: (s: string) => ((text += s), true) }, read: () => text };
}

describe('#368 E2E — an incomplete change surfaces a visible "Needs your attention" verdict', () => {
  let root: string;
  const SES = 'e2e-368-session';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-368-e2e-'));
    mkdirSync(join(root, '.paqad/artifacts'), { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.doUnmock(DIST);
  });

  function recordArtifactStage(stageName: string, ordinal: number): void {
    startStage(root, stageName, { sessionId: SES, ordinal, adapter: 'claude-code' });
    const rel = `.paqad/artifacts/${stageName}.md`;
    writeFileSync(join(root, rel), `# ${stageName}\n`);
    endStage(
      root,
      stageName,
      { artifactPaths: [rel] },
      { sessionId: SES, ordinal, adapter: 'claude-code' },
    );
  }

  function recordMutationStage(stageName: string, ordinal: number): void {
    startStage(root, stageName, { sessionId: SES, ordinal, adapter: 'claude-code' });
    endStage(root, stageName, {}, { sessionId: SES, ordinal, adapter: 'claude-code' });
  }

  it('AC-10: verdict is FAIL, the receipt is developer-visible, and it never reads clean', async () => {
    // A real feature ledger: planning+spec+development+checks recorded, but review and
    // documentation_sync were never run — exactly the #353 shape.
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    recordArtifactStage('planning', ordinal);
    recordArtifactStage('specification', ordinal);
    recordMutationStage('development', ordinal);
    recordMutationStage('checks', ordinal);
    // review + documentation_sync intentionally omitted.

    const context = createVerificationContext({
      project_root: root,
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git-status',
    });

    // (1) Real verdict from the real verification path over the real ledger.
    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(false); // AC-D1 — never a hidden clean pass.
    expect(verdict.receipt).toContain('Needs your attention');
    expect(verdict.receipt).toMatch(/review/);
    expect(verdict.receipt).toMatch(/documentation_sync/);
    expect(verdict.receipt).not.toContain('Safe to merge');

    // (2) Real surfacing: the Stop-hook backstop makes that verdict developer-visible.
    vi.doMock(DIST, () => ({ runRepositoryVerification: async () => verdict }));
    const { runVerificationBackstop } =
      await import('../../../runtime/scripts/verify-backstop.mjs');
    const out = capture();
    const err = capture();
    const code = await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot: root,
      loopActive: false,
      stdout: out.stream,
      stderr: err.stream,
    });

    expect(code).toBe(0); // Stop hooks block via JSON, not exit code.
    const parsed = JSON.parse(out.read());
    expect(parsed.systemMessage).toContain('Needs your attention'); // developer sees it (AC-C1)
    expect(parsed.systemMessage).toMatch(/review/);
    expect(parsed.decision).toBe('block'); // model told to fix (AC-A1 teeth)
    expect(err.read()).toBe(''); // nothing hidden on stderr anymore
  });
});
