import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { endStage, openStageEvidence, startStage } from '@/stage-evidence/index.js';

import { createVerificationContext } from '../verification/shared.fixture.js';

const DIST = resolve(process.cwd(), 'dist/index.js');

function capture() {
  let text = '';
  return { stream: { write: (s: string) => ((text += s), true) }, read: () => text };
}

describe('E2E — an incomplete change surfaces a visible "Needs your attention" verdict', () => {
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

  it('AC-10: verdict is FAIL, enforcement rides {decision:block} (no systemMessage leak), and it never reads clean', async () => {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    recordArtifactStage('planning', ordinal);
    recordArtifactStage('specification', ordinal);
    recordMutationStage('development', ordinal);
    recordMutationStage('checks', ordinal);

    const context = createVerificationContext({
      project_root: root,
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git',
    });

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.receipt).toContain('Needs your attention');
    expect(verdict.receipt).toMatch(/review/);
    expect(verdict.receipt).toMatch(/documentation_sync/);
    expect(verdict.receipt).not.toContain('Safe to merge');

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

    expect(code).toBe(0);
    const parsed = JSON.parse(out.read());
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain(verdict.summary);
    expect(parsed.reason).toContain('documentation_sync');
    expect(parsed.systemMessage).toBeUndefined();
    expect(err.read()).toBe('');
  });
});
