import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildConfigShow, renderConfigShow } from '@/cli/commands/config-show.js';
import { FRAMEWORK_CONFIG_SPECS } from '@/core/framework-config.js';

let root: string;

function write(rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-show-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('config show', () => {
  it('prints one row per setting with its value, source and default note (AC-69)', () => {
    write(
      '.paqad/configs/feature-development/specification.yaml',
      'experts:\n  standing: [a, b]\n',
    );
    write('.paqad/.config', 'rag_top_n=7\n');
    const result = buildConfigShow(root, { PAQAD_HUD_CHIME: 'true' });
    expect(result.settings).toHaveLength(FRAMEWORK_CONFIG_SPECS.length);
    const byKey = new Map(result.settings.map((row) => [row.key, row]));
    expect(byKey.get('spec_pipeline_standing_experts')).toMatchObject({
      file: 'feature-development/specification.yaml',
      path: 'experts.standing',
      value: ['a', 'b'],
      source: 'team: feature-development/specification.yaml',
      same_as_default: false,
    });
    expect(byKey.get('rag_top_n')).toMatchObject({
      value: 7,
      source: 'personal: .paqad/.config (rag_top_n)',
    });
    expect(byKey.get('hud_chime')).toMatchObject({ value: true, source: 'env: PAQAD_HUD_CHIME' });
    expect(byKey.get('stages_mode')).toMatchObject({
      value: 'block',
      source: 'default',
      same_as_default: true,
    });
    const text = renderConfigShow(result);
    expect(text).toMatch(
      /feature-development\/workflow\.yaml: stage_tracking\s+block\s+\(default, same as default\)/u,
    );
    expect(text).toMatch(
      /feature-development\/specification\.yaml: experts\.standing\s+\[a, b\]\s+\(team: /u,
    );
  });

  it('hides rows equal to the default with --changed (AC-69)', () => {
    write('.paqad/configs/paqad.yaml', 'hud:\n  chime: true\nupdates:\n  automatic: true\n');
    const text = renderConfigShow(buildConfigShow(root, {}), true);
    expect(text.split('\n')).toHaveLength(1);
    expect(text).toMatch(/^paqad\.yaml: hud\.chime\s+true\s+\(team: paqad\.yaml\)$/u);
  });

  it('lists invalid team and personal values at the end', () => {
    write('.paqad/configs/paqad.yaml', 'enabled: maybe\n');
    write('.paqad/.config', 'stages_mode=blocky\n');
    const result = buildConfigShow(root, {});
    expect(result.invalid).toEqual([
      'paqad.yaml: enabled has an invalid value maybe, so paqad uses the default true. It must be true or false.',
      '.paqad/.config: stages_mode has an invalid value blocky, so paqad uses the default strict. It must be one of: off, warn, block.',
    ]);
    expect(result.settings.find((row) => row.key === 'paqad_enable')?.value).toBe(true);
    expect(renderConfigShow(result)).toContain('\nInvalid values:\n- paqad.yaml: enabled');
  });
});
