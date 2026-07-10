import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@/compliance/markdown.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

// Issue #343 — the frozen spec's only home is the feature bundle `specification.json`; there
// is no `.paqad/specs` sidecar. Seed a bundle spec directly (no active-feature machinery).
const BUNDLE_DIR = 'change-01KX5P20DVKF6DN1KC8ZSQ71Q3';
function seedBundleSpec(root: string, spec: FeatureSpec): void {
  const abs = join(root, featureFilePath(BUNDLE_DIR, 'specification'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
}

// Proves the KERNEL wiring: the spec-change guard runs through the decision-pause
// capability at pre-mutation, deterministically (self-arm OFF), and mints a spec.change
// pause when a persisted frozen spec's source markdown has moved.
describe('spec-change guard — kernel wiring (deterministic, self-arm off)', () => {
  let root: string;
  const FROZEN_MD = '# S-102\n\nExport as CSV.\n';

  function frozenSpec(): FeatureSpec {
    return {
      schema_version: '1',
      spec_id: 'S-102',
      spec_file: join('docs', 'spec-sources', 'S-102.md'),
      spec_hash: sha256Hex(FROZEN_MD),
      behaviour: ['FR-1'],
      acceptance_criteria: [],
      invariants: [],
      open_questions: [],
      frozen: {
        frozen_at: '2026-06-07T00:00:00Z',
        spec_hash: sha256Hex(FROZEN_MD),
        signed_off_by: 'owner',
      },
    };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-specchange-cap-'));
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    // Silence the stages block-forward so only the decision-pause minters contribute.
    writeFileSync(join(root, '.paqad/configs/.config.policy'), 'stages_mode=off\n');
    seedBundleSpec(root, frozenSpec());
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function pending(): string[] {
    const dir = join(root, '.paqad/decisions/pending');
    return existsSync(dir) ? readdirSync(dir).filter((f) => /^D-.*\.json$/.test(f)) : [];
  }

  const payload = { toolName: 'Edit', targetPath: join('src', 'a.ts'), sessionId: 'ses_spec' };

  it('mints a spec.change pause when the frozen spec source is stale', async () => {
    // Current markdown differs from the hash captured at freeze.
    mkdirSync(join(root, 'docs/spec-sources'), { recursive: true });
    writeFileSync(join(root, 'docs/spec-sources/S-102.md'), '# S-102\n\nExport as XLSX now.\n');
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload,
    });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('▸ paqad');
    expect(pending()).toHaveLength(1);
  });

  it('mints nothing when the frozen spec source is unchanged', async () => {
    mkdirSync(join(root, 'docs/spec-sources'), { recursive: true });
    writeFileSync(join(root, 'docs/spec-sources/S-102.md'), FROZEN_MD);
    const result = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: {},
      payload,
    });
    expect(result.block).toBe(false);
    expect(pending()).toHaveLength(0);
  });
});
