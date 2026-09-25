import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { runCapabilityGate } from '@/kernel/gate.js';

// Issue #581 (FR-14, AC-23) — every file in a feature bundle is created by a paqad verb, so the
// pre-mutation seam refuses an agent Edit/Write/NotebookEdit/apply_patch aimed inside a bundle
// and names the verb that owns the file. Driven through the real kernel gate, no mocks.
describe('bundle write guard at pre-mutation (issue #581, AC-23)', () => {
  let root: string;
  const DIR = '581-x-01JABCDEFGHJKMNPQRSTVWXYZ0';
  const bundle = (file: string): string => `${PATHS.FEATURE_EVIDENCE_DIR}/${DIR}/${file}`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-bundle-guard-'));
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    // stages_mode=off: the guard is not tunable, so it must still refuse.
    writeFileSync(join(root, '.paqad/configs/.config.policy'), 'stages_mode=off\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function gate(payload: { targetPath?: string; targetPaths?: string[] }) {
    return runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { toolName: 'Write', ...payload },
    });
  }

  it('refuses a write to a bundle document and names its writer verb', async () => {
    const result = await gate({ targetPath: join(root, bundle('plan.json')) });
    expect(result.block).toBe(true);
    expect(result.summary).toContain(bundle('plan.json'));
    expect(result.summary).toContain('`paqad-ai plan compile`');
  });

  it('names the verb for a bundle ledger given as a relative path', async () => {
    const result = await gate({ targetPath: bundle('rules-loaded.json') });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('`paqad-ai rules load`');
  });

  it('names the visual-evidence verbs for the screenshots subtree', async () => {
    const result = await gate({ targetPath: bundle('screenshots/01-home/image.png') });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('visual-evidence run');
  });

  it('says no verb writes a stray file', async () => {
    const result = await gate({ targetPath: bundle('notes.md') });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('No verb writes this file');
  });

  it('refuses an apply_patch when any of its paths is in a bundle, skipping out-of-tree paths', async () => {
    const result = await gate({
      targetPaths: [join(tmpdir(), 'elsewhere', 'x.ts'), bundle('review.json')],
    });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('`paqad-ai review record`');
  });

  it('lets an edit outside any bundle through, including the _session controls', async () => {
    for (const target of [
      'src/app.ts',
      `${PATHS.FEATURE_EVIDENCE_DIR}/_session/active.json`,
      `${PATHS.FEATURE_EVIDENCE_DIR}/loose.json`,
    ]) {
      expect((await gate({ targetPath: target })).block).toBe(false);
    }
    expect((await gate({ targetPaths: [] })).block).toBe(false);
  });
});
