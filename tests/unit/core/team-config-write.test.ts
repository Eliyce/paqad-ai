import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FRAMEWORK_CONFIG_SPECS,
  layeredConfigMap,
  type FrameworkConfigSpec,
} from '@/core/framework-config.js';
import YAML from 'yaml';

import {
  renderTeamConfigFile,
  setTeamConfigValue,
  writeTeamYamlValue,
} from '@/core/team-config.js';
import { changedOutside } from '@/git-workflow/last-applied.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'team-config-write-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function otherValue(spec: FrameworkConfigSpec): string {
  if (spec.enumValues !== undefined) {
    return spec.enumValues.find((value) => value !== spec.default) ?? spec.enumValues[0]!;
  }
  if (spec.type === 'boolean') return spec.default === true ? 'false' : 'true';
  if (spec.type === 'number')
    return spec.default === 0 ? '0' : String(Number(spec.default ?? 0) + 3);
  if (spec.key.endsWith('_lanes') || spec.key.endsWith('_experts')) return 'full,standard';
  return 'team-value';
}

describe('setTeamConfigValue', () => {
  it('AC-7 and AC-30: renders a fresh file with the value live and no commented copy', () => {
    const path = setTeamConfigValue(root, 'stages_mode', 'strict');
    expect(path).toBe(join(root, '.paqad/configs/feature-development/workflow.yaml'));
    const text = readFileSync(path, 'utf8');
    expect(text).toBe(
      renderTeamConfigFile(
        'feature-development/workflow.yaml',
        YAML.parseDocument('stage_tracking: block\n'),
      ),
    );
    expect(text).not.toContain('yaml-language-server');
    expect(text).toContain('\nstage_tracking: block\n');
    expect(text).not.toContain('# stage_tracking:');
  });

  it('AC-26: a second write keeps the first value live and the team comments in place', () => {
    const path = join(root, '.paqad/configs/paqad.yaml');
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(
      path,
      '# team header\npaqad_version: "1.0.0"\n# why we pin\nupdates:\n  minimum_version: 1.2.0 # pinned\nenabled: true\n',
      'utf8',
    );
    setTeamConfigValue(root, 'auto_update', 'false');
    setTeamConfigValue(root, 'paqad_enable', 'false');
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('\n# why we pin\nupdates:\n');
    expect(text).toContain('\n  automatic: false\n');
    expect(text).toContain('\n  minimum_version: 1.2.0 # pinned\n');
    expect(text).toContain('\nenabled: false\n');
    expect(text).toContain('\n# Notes the team wrote, kept as written:\n# team header\n');
    const data = YAML.parse(text) as Record<string, unknown>;
    expect(data).toMatchObject({
      enabled: false,
      updates: { automatic: false, minimum_version: '1.2.0' },
    });
  });

  it('FR-13: replaces a null parent with a map and refuses a file that is not settings', () => {
    const path = join(root, '.paqad/configs/paqad.yaml');
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(path, 'paqad_version: "1.0.0"\nupdates:\n', 'utf8');
    setTeamConfigValue(root, 'auto_update', 'false');
    expect(YAML.parse(readFileSync(path, 'utf8'))).toMatchObject({ updates: { automatic: false } });
    writeFileSync(path, '- a\n', 'utf8');
    expect(() => setTeamConfigValue(root, 'auto_update', 'false')).toThrow(
      /list or a single value/u,
    );
    writeFileSync(path, 'enabled: [\n', 'utf8');
    expect(() => setTeamConfigValue(root, 'auto_update', 'false')).toThrow(/isn't valid YAML/u);
    expect(readFileSync(path, 'utf8')).toBe('enabled: [\n');
  });

  it('INV-5: sets one value in a file a newer paqad wrote without re-rendering or restamping it', () => {
    const path = join(root, '.paqad/configs/paqad.yaml');
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    const newer =
      '# written by a newer paqad\npaqad_version: "99.0.0"\n\n# A setting this paqad does not know.\n# future_setting: 1\n';
    writeFileSync(path, newer, 'utf8');
    setTeamConfigValue(root, 'paqad_enable', 'false');
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('paqad_version: "99.0.0"');
    expect(text).toContain('# future_setting: 1');
    expect(text).toContain('# written by a newer paqad');
    expect(text).not.toContain("# Every setting is listed with paqad's default.");
    expect(YAML.parse(text)).toEqual({ paqad_version: '99.0.0', enabled: false });
  });

  it('AC-25 and INV-6: restamps .last-applied.json and never renders git-workflow/commits.yaml', () => {
    setTeamConfigValue(root, 'ai_attribution', 'keep');
    const text = readFileSync(join(root, '.paqad/configs/git-workflow/commits.yaml'), 'utf8');
    expect(text).toBe('ai_attribution: keep\n');
    expect(changedOutside(root)).toEqual([]);
    writeTeamYamlValue(root, 'git-workflow/commits.yaml', ['ai_attribution'], 'strip');
    expect(readFileSync(join(root, '.paqad/configs/git-workflow/commits.yaml'), 'utf8')).toBe(
      'ai_attribution: strip\n',
    );
  });

  it('gives every setting the same flat value as the old team file did', () => {
    const legacy = mkdtempSync(join(tmpdir(), 'team-config-legacy-'));
    try {
      mkdirSync(join(legacy, '.paqad/configs'), { recursive: true });
      const lines = FRAMEWORK_CONFIG_SPECS.map((spec) => `${spec.key}=${otherValue(spec)}`);
      writeFileSync(join(legacy, '.paqad/configs/.config.app'), `${lines.join('\n')}\n`, 'utf8');
      for (const spec of FRAMEWORK_CONFIG_SPECS) {
        setTeamConfigValue(root, spec.key, otherValue(spec));
      }
      const before = layeredConfigMap(legacy, {});
      const after = layeredConfigMap(root, {});
      expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  });
});
