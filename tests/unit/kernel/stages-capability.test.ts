import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCapabilityGate } from '@/kernel/gate.js';
import { endStage, openStageEvidence, startStage } from '@/stage-evidence/index.js';

// Block-forward (RCA fix B): the stages capability refuses a code edit at the
// pre-mutation seam until planning + specification carry a start+end pair in the
// ledger. Driven through the real kernel gate (runCapabilityGate), no mocks. The
// project has no rule-script map, so only the stages capability contributes.
describe('stages capability — block-forward at pre-mutation', () => {
  let root: string;
  const SES = 'ses_bf';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stages-cap-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Record a full start+end pair for each stage, in order, under the shared session. */
  function record(stages: string[]): void {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    for (const stage of stages) {
      startStage(root, stage, { sessionId: SES, ordinal, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId: SES, ordinal, adapter: 'claude-code' });
    }
  }

  function policy(body: string): void {
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.policy'), body);
  }

  it('BLOCKS the first edit (no change opened) asking for planning, strict by default', async () => {
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('planning');
    expect(result.summary).toContain('Needs your attention');
  });

  it('BLOCKS on specification when planning is recorded but specification is not', async () => {
    record(['planning']); // planning start+end, nothing else
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('specification');
  });

  it('ALLOWS the edit once planning + specification both have a start+end pair', async () => {
    record(['planning', 'specification']);
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('does NOT block a planning stage that started but never ended (no pair yet)', async () => {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    startStage(root, 'planning', { sessionId: SES, ordinal, adapter: 'claude-code' });
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('planning');
  });

  it('WARN mode surfaces the missing stage but does not block', async () => {
    policy('stages_mode=warn\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('Heads up');
    expect(result.summary).toContain('planning');
  });

  it('OFF mode is a clean no-op', async () => {
    policy('stages_mode=off\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('no-ops at the COMPLETION seam (finalize path owns completion — no double-fire)', async () => {
    // No change opened: at pre-mutation this blocks, but at completion the stages
    // capability must stay silent so it never double-fires with finalize/verify.
    const result = await runCapabilityGate({ projectRoot: root, seam: 'completion' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('is immune to the committed-clean-tree nullifier (reads the ledger, not a git delta)', async () => {
    // There is no working tree here at all — the gate still blocks purely from the
    // ledger state, which is the structural fix vs the Stop-path changedFileCount<=0.
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
  });

  // Issue #307 — the same-turn unblock path. Markers the agent emitted EARLIER in
  // the current turn are parsed at this seam, so the remediation the block message
  // names works within the turn that follows it (not only after Stop).
  describe('same-turn markers (issue #307)', () => {
    /** A Claude-shaped JSONL transcript with one assistant message per text. */
    function transcript(...texts: string[]): string {
      const path = join(root, 'transcript.jsonl');
      writeFileSync(
        path,
        texts
          .map((text) =>
            JSON.stringify({
              type: 'assistant',
              message: { role: 'assistant', content: [{ type: 'text', text }] },
            }),
          )
          .join('\n'),
      );
      return path;
    }

    it('ALLOWS the edit when the turn transcript already carries planning+specification pairs', async () => {
      const transcriptPath = transcript(
        'paqad:stage planning start\nplanning…\npaqad:stage planning end',
        'paqad:stage specification start\nspec…\npaqad:stage specification end',
      );
      const result = await runCapabilityGate({
        projectRoot: root,
        seam: 'pre-mutation',
        payload: { transcriptPath, sessionId: SES },
      });
      expect(result.block).toBe(false);
      // Narration and ledger are both non-negotiable: the rows minted from the
      // markers are narrated back to the user.
      expect(result.narration).toContain('▸ paqad');
      expect(result.narration).toContain('planning');
      expect(result.narration).toContain('specification');
    });

    it('still BLOCKS on specification when the transcript only carries planning, narrating what it recorded', async () => {
      const transcriptPath = transcript(
        'paqad:stage planning start\nplanning…\npaqad:stage planning end',
      );
      const result = await runCapabilityGate({
        projectRoot: root,
        seam: 'pre-mutation',
        payload: { transcriptPath, sessionId: SES },
      });
      expect(result.block).toBe(true);
      expect(result.summary).toContain('specification');
      expect(result.narration).toContain('planning');
    });

    it('blocks unchanged when the transcript path is unreadable (best-effort sweep)', async () => {
      const result = await runCapabilityGate({
        projectRoot: root,
        seam: 'pre-mutation',
        payload: { transcriptPath: join(root, 'missing.jsonl'), sessionId: SES },
      });
      expect(result.block).toBe(true);
      expect(result.narration).toBe('');
    });

    it('the block message names only remediations that exist on an onboarded project', async () => {
      const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
      expect(result.summary).toContain('paqad:stage planning start');
      expect(result.summary).toContain('npx paqad-ai stage start planning');
      expect(result.summary).not.toContain('se-mark');
    });
  });

  // Issue #307 — the sentinel write is bootstrap bookkeeping, never a code change:
  // gating it deadlocks turn one (the stages gate blocked the very Write the
  // bootstrap needs to finish).
  it('exempts the agent-entry sentinel write from the block-forward gate', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, '.paqad/.agent-entry-loaded') },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  // Issue #310 — the gate governs FEATURE DEVELOPMENT only. A documentation-only or
  // framework-internal edit is skipped (no planning/spec demanded); a code edit still
  // blocks; and the gate must always be clearable (no deadlock).
  describe('feature-development scope + deadlock-free (issue #310)', () => {
    const gate = (targetPath: string, extra: Record<string, unknown> = {}) =>
      runCapabilityGate({
        projectRoot: root,
        seam: 'pre-mutation',
        payload: { targetPath: join(root, targetPath), sessionId: SES, ...extra },
      });

    it('does NOT block a documentation-only edit (no planning/spec demanded)', async () => {
      const result = await gate('docs/inbound/README.md');
      expect(result.block).toBe(false);
      expect(result.summary).toBe('');
    });

    it('does NOT block a top-level markdown edit', async () => {
      expect((await gate('README.md')).block).toBe(false);
    });

    it('does NOT block editing the .config.policy escape hatch (reachable remedy)', async () => {
      expect((await gate('.paqad/configs/.config.policy')).block).toBe(false);
    });

    it('STILL blocks a source-code edit until planning + specification are recorded', async () => {
      const result = await gate('src/feature.ts');
      expect(result.block).toBe(true);
      expect(result.summary).toContain('planning');
    });

    it('blocks a non-JS source edit too (Laravel app/*.php) — language-agnostic scope', async () => {
      expect((await gate('app/Http/Controller.php')).block).toBe(true);
    });

    it('clears the block via same-turn markers even after a later-stage row was recorded first', async () => {
      // Reproduce the old poison: a documentation_sync start lands before planning.
      // The pre-mutation sweep must still record the planning + specification markers
      // (F3 makes the recorder tolerant), so the code edit is no longer deadlocked.
      startStage(root, 'documentation_sync', { sessionId: SES, adapter: 'claude-code' });
      const transcriptPath = join(root, 'turn.jsonl');
      writeFileSync(
        transcriptPath,
        [
          'paqad:stage planning start\nplanning…\npaqad:stage planning end',
          'paqad:stage specification start\nspec…\npaqad:stage specification end',
        ]
          .map((text) =>
            JSON.stringify({
              type: 'assistant',
              message: { role: 'assistant', content: [{ type: 'text', text }] },
            }),
          )
          .join('\n'),
      );
      const result = await gate('src/feature.ts', { transcriptPath });
      expect(result.block).toBe(false);
      expect(result.narration).toContain('planning');
      expect(result.narration).toContain('specification');
    });
  });
});
