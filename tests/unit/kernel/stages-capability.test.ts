import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { setActiveFeature } from '@/feature-evidence/session-control.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import {
  endStage,
  isArtifactBearingStage,
  openStageEvidence,
  startStage,
  type EndStageInput,
} from '@/stage-evidence/index.js';

describe('stages capability — block-forward at pre-mutation', () => {
  let root: string;
  const SES = 'ses_bf';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stages-cap-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function provenEndArgs(stage: string): EndStageInput {
    if (!isArtifactBearingStage(stage)) return {};
    const rel = `.paqad/artifacts/${stage}.md`;
    mkdirSync(join(root, '.paqad', 'artifacts'), { recursive: true });
    writeFileSync(join(root, rel), `# ${stage} artifact\n`);
    return { artifactPaths: [rel] };
  }

  function record(stages: string[]): void {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    for (const stage of stages) {
      startStage(root, stage, { sessionId: SES, ordinal, adapter: 'claude-code' });
      endStage(root, stage, provenEndArgs(stage), {
        sessionId: SES,
        ordinal,
        adapter: 'claude-code',
      });
    }
  }

  function policy(body: string): void {
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.policy'), body);
  }

  const BUNDLE_DIR = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';
  function openBundle(): { planRel: string; specRel: string } {
    setActiveFeature(root, SES, BUNDLE_DIR);
    const planRel = featureFilePath(BUNDLE_DIR, 'plan');
    const specRel = featureFilePath(BUNDLE_DIR, 'specification');
    for (const rel of [planRel, specRel]) {
      mkdirSync(join(root, rel.slice(0, rel.lastIndexOf('/'))), { recursive: true });
      writeFileSync(join(root, rel), '{"real":true}\n');
    }
    return { planRel, specRel };
  }

  it('BLOCKS the first edit (no change opened) asking for planning, strict by default', async () => {
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('planning');
    expect(result.summary).toContain('Needs your attention');
  });

  it('BLOCKS on specification when planning is recorded but specification is not', async () => {
    record(['planning']);
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

  it('BLOCKS when planning+specification have pairs but NO artifact digest', async () => {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    for (const stage of ['planning', 'specification']) {
      startStage(root, stage, { sessionId: SES, ordinal, adapter: 'claude-code' });
      endStage(root, stage, {}, { sessionId: SES, ordinal, adapter: 'claude-code' });
    }
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('planning');
  });

  it('the planning block message teaches the `-- <artifact-path>` grammar', async () => {
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.summary).toContain('paqad:stage planning end -- <artifact-path>');
    expect(result.summary).toContain('--artifact <artifact-path>');
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
    const result = await runCapabilityGate({ projectRoot: root, seam: 'completion' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('is immune to the committed-clean-tree nullifier (reads the ledger, not a git delta)', async () => {
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
  });

  describe('same-turn markers', () => {
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
      const { planRel, specRel } = openBundle();
      const transcriptPath = transcript(
        `paqad:stage planning start\nplanning…\npaqad:stage planning end -- ${planRel}`,
        `paqad:stage specification start\nspec…\npaqad:stage specification end -- ${specRel}`,
      );
      const result = await runCapabilityGate({
        projectRoot: root,
        seam: 'pre-mutation',
        payload: { transcriptPath, sessionId: SES },
      });
      expect(result.block).toBe(false);
      expect(result.narration).toContain('▸ paqad');
      expect(result.narration).toContain('planning');
      expect(result.narration).toContain('writing the spec');
    });

    it('still BLOCKS on specification when the transcript only carries planning, narrating what it recorded', async () => {
      const { planRel } = openBundle();
      const transcriptPath = transcript(
        `paqad:stage planning start\nplanning…\npaqad:stage planning end -- ${planRel}`,
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
      expect(result.summary).toContain('paqad-ai stage start planning');
      expect(result.summary).not.toContain('se-mark');
    });
  });

  it('exempts the agent-entry sentinel write from the block-forward gate', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, '.paqad/.agent-entry-loaded') },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it.each([
    '.paqad/checks/run-history.jsonl',
    '.paqad/checks/runs/01M65SFN9BMVXRVPPYN44SJEVQ.json',
    '.paqad/checks/last-run.json',
  ])('refuses a hand edit of the checks record %s, even with every stage recorded', async (rel) => {
    record(['planning', 'specification']);
    policy('stages_mode=off\n');
    for (const payload of [
      { targetPath: join(root, rel) },
      { targetPaths: [join(root, 'docs/x.md'), join(root, rel)] },
    ]) {
      const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation', payload });
      expect(result.block).toBe(true);
      expect(result.summary).toContain('checks records are written by paqad, not by hand');
      expect(result.summary).toContain(`\`${rel}\``);
      expect(result.summary).toContain('Only `paqad-ai checks run` writes it');
    }
  });

  it('does not treat a look-alike folder as the checks record', async () => {
    policy('stages_mode=off\n');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, '.paqad/checks-notes.md') },
    });
    expect(result.block).toBe(false);
  });

  describe('feature-development scope + deadlock-free', () => {
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
      const { planRel, specRel } = openBundle();
      startStage(root, 'documentation_sync', { sessionId: SES, adapter: 'claude-code' });
      const transcriptPath = join(root, 'turn.jsonl');
      writeFileSync(
        transcriptPath,
        [
          `paqad:stage planning start\nplanning…\npaqad:stage planning end -- ${planRel}`,
          `paqad:stage specification start\nspec…\npaqad:stage specification end -- ${specRel}`,
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
      expect(result.narration).toContain('writing the spec');
    });
  });

  it('does NOT block a multi-path patch that touches only docs', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: {
        targetPath: join(root, 'docs/a.md'),
        targetPaths: [join(root, 'docs/a.md'), join(root, 'docs/b.md')],
        sessionId: SES,
      },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('BLOCKS a multi-path patch when ANY path is source, before planning', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: {
        targetPath: join(root, 'docs/a.md'),
        targetPaths: [join(root, 'docs/a.md'), join(root, 'src/x.ts')],
        sessionId: SES,
      },
    });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('planning');
  });
});
