import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildConfigShow, renderConfigShow } from '@/cli/commands/config-show.js';
import { setTeamConfigValue, syncTeamConfigFiles } from '@/core/team-config.js';
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

describe('config show on rendered team files', () => {
  function files(): void {
    syncTeamConfigFiles(root);
  }

  function edit(file: string, from: string, to: string): void {
    const path = join(root, '.paqad/configs', file);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain(from);
    writeFileSync(path, text.replace(from, to), 'utf8');
  }

  it('AC-19: reads a setting under a still-commented group and names the line to fix', () => {
    files();
    edit('paqad.yaml', '#   minimum_version: latest', '  minimum_version: 1.117.0');
    const result = buildConfigShow(root, {});
    const row = result.settings.find((entry) => entry.key === 'minimum_version')!;
    expect(row).toMatchObject({ value: '1.117.0', source: 'team: paqad.yaml' });
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]).toMatch(/^paqad\.yaml line \d+: minimum_version is set/u);
    expect(result.invalid[0]).toContain('remove the # in front of updates:');
    const before = readFileSync(join(root, '.paqad/configs/paqad.yaml'), 'utf8');
    syncTeamConfigFiles(root);
    expect(readFileSync(join(root, '.paqad/configs/paqad.yaml'), 'utf8')).toBe(before);
    edit('paqad.yaml', '# updates:', 'updates:');
    expect(buildConfigShow(root, {}).invalid).toEqual([]);
  });

  it('AC-20: reads a setting where only the # was removed, and update leaves the line', () => {
    files();
    edit('paqad.yaml', '# enabled: true', ' enabled: false');
    const row = buildConfigShow(root, {}).settings.find((entry) => entry.key === 'paqad_enable')!;
    expect(row.value).toBe(false);
    syncTeamConfigFiles(root);
    expect(readFileSync(join(root, '.paqad/configs/paqad.yaml'), 'utf8')).toContain(
      '\n enabled: false\n',
    );
  });

  it('AC-26: a setting uncommented beside the onboarding choice is reported and both stay live', () => {
    files();
    setTeamConfigValue(root, 'rag_enabled', 'true');
    edit('retrieval.yaml', '# match:', 'match:');
    edit('retrieval.yaml', '#   max_results: 20', '  max_results: 5');
    const byKey = new Map(buildConfigShow(root, {}).settings.map((row) => [row.key, row]));
    expect(byKey.get('rag_top_n')).toMatchObject({ value: 5, source: 'team: retrieval.yaml' });
    expect(byKey.get('rag_enabled')).toMatchObject({ value: true, source: 'team: retrieval.yaml' });
    syncTeamConfigFiles(root);
    const after = new Map(buildConfigShow(root, {}).settings.map((row) => [row.key, row]));
    expect(after.get('rag_top_n')!.value).toBe(5);
    expect(after.get('rag_enabled')!.value).toBe(true);
  });

  it('AC-27 and INV-3: the output is the same before and after the re-render', () => {
    write(
      '.paqad/configs/paqad.yaml',
      'paqad_version: "1.117.0"\nenabled: false\nhud:\n  chime: true\n',
    );
    write(
      '.paqad/configs/feature-development/workflow.yaml',
      'paqad_version: "1.117.0"\nstages:\n  review:\n    effort: medium\nstage_helpers:\n  on_lanes: [graduated, full]\n',
    );
    const before = renderConfigShow(buildConfigShow(root, {}));
    syncTeamConfigFiles(root);
    expect(renderConfigShow(buildConfigShow(root, {}))).toBe(before);
  });

  it('AC-21 and AC-29: names a team file that is not valid YAML or holds a list', () => {
    write('.paqad/configs/models.yaml', 'models: [gpt\n');
    write('.paqad/configs/decisions.yaml', '- ask\n');
    const invalid = buildConfigShow(root, {}).invalid;
    expect(invalid.some((line) => line.startsWith("models.yaml isn't valid YAML"))).toBe(true);
    expect(invalid).toContain(
      'decisions.yaml holds a list or a single value instead of settings, so none of its settings are used.',
    );
  });
});
