import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { writeRulesLoaded } from '@/feature-evidence/rules-loaded.js';
import { setActiveFeature } from '@/feature-evidence/session-control.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import { endStage, openStageEvidence, startStage } from '@/stage-evidence/index.js';

// Issue #557 — the edit-time rule-loading block. Driven through the real kernel gate with the
// stages precondition already satisfied, so only the rules-loaded capability contributes.
describe('rules-loaded capability — block-forward at pre-mutation', () => {
  let root: string;
  const SES = 'ses_rl';
  const BUNDLE_DIR = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rules-loaded-cap-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    // A compiled rule store must exist for the capability to have something to load.
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({
        schema_version: 1,
        generated_at: 'now',
        source_hash: 'sha256:x',
        rules: [
          {
            rule_id: 'RULE-2',
            title: 'Constitution',
            source_path: 'docs/instructions/rules/coding/a.md',
            trigger_patterns: ['**'],
            severity: 'must',
            summary: 'Always applies.',
            raw_text: '# body',
          },
        ],
      }),
    );
    // Satisfy the stages capability: an active bundle with real plan + spec, planning +
    // specification each recorded with an artifact-bearing end.
    setActiveFeature(root, SES, BUNDLE_DIR);
    const planRel = featureFilePath(BUNDLE_DIR, 'plan');
    const specRel = featureFilePath(BUNDLE_DIR, 'specification');
    for (const rel of [planRel, specRel]) {
      mkdirSync(join(root, rel.slice(0, rel.lastIndexOf('/'))), { recursive: true });
      writeFileSync(join(root, rel), '{"real":true}\n');
    }
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    startStage(root, 'planning', { sessionId: SES, ordinal, adapter: 'claude-code' });
    endStage(
      root,
      'planning',
      { artifactPaths: [planRel] },
      { sessionId: SES, ordinal, adapter: 'claude-code' },
    );
    startStage(root, 'specification', { sessionId: SES, ordinal, adapter: 'claude-code' });
    endStage(
      root,
      'specification',
      { artifactPaths: [specRel] },
      { sessionId: SES, ordinal, adapter: 'claude-code' },
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('BLOCKS a feature-dev source edit when no rules-loaded.json exists', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, 'src/app.ts'), sessionId: SES },
    });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('rules not loaded');
    expect(result.summary).toContain('paqad-ai rules load');
  });

  it('ALLOWS the edit once rules-loaded.json is present', async () => {
    writeRulesLoaded(root, SES, {
      applicable: [
        { rule_id: 'RULE-2', title: 'Constitution', always_load: true, matched_paths: [] },
      ],
      ruleTextHash: 'abc',
      changedPaths: ['src/app.ts'],
    });
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, 'src/app.ts'), sessionId: SES },
    });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('NEVER blocks a documentation-only edit, even with no rules-loaded.json', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, 'docs/x.md'), sessionId: SES },
    });
    expect(result.block).toBe(false);
  });

  it('NEVER blocks when the project has no compiled rules (nothing to load)', async () => {
    rmSync(join(root, PATHS.COMPILED_RULES));
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, 'src/app.ts'), sessionId: SES },
    });
    expect(result.block).toBe(false);
  });

  it('NEVER blocks when the compiled store has an empty rules array', async () => {
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({ schema_version: 1, generated_at: 'now', source_hash: 'x', rules: [] }),
    );
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { targetPath: join(root, 'src/app.ts'), sessionId: SES },
    });
    expect(result.block).toBe(false);
  });

  it('does not fire at the completion seam (that is the dedicated gate)', async () => {
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'completion',
      payload: { targetPath: join(root, 'src/app.ts'), sessionId: SES },
    });
    // The completion seam runs delivery/decision-pause, never rules-loaded.
    expect(result.summary).not.toContain('rules not loaded');
  });
});
