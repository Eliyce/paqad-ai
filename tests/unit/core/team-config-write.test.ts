import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FRAMEWORK_CONFIG_SPECS,
  layeredConfigMap,
  type FrameworkConfigSpec,
} from '@/core/framework-config.js';
import { setTeamConfigValue, teamConfigHeader } from '@/core/team-config.js';
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
  if (spec.type === 'number') return spec.default === 0 ? '0' : String(Number(spec.default ?? 0) + 3);
  if (spec.key.endsWith('_lanes') || spec.key.endsWith('_experts')) return 'full,standard';
  return 'team-value';
}

describe('setTeamConfigValue', () => {
  it('creates the file from its header and writes the YAML value', () => {
    const path = setTeamConfigValue(root, 'stages_mode', 'strict');
    expect(path).toBe(join(root, '.paqad/configs/feature-development/workflow.yaml'));
    const text = readFileSync(path, 'utf8');
    expect(text.startsWith(teamConfigHeader('feature-development/workflow.yaml'))).toBe(true);
    expect(text).toContain(
      '# yaml-language-server: $schema=../schemas/feature-development/workflow.schema.json',
    );
    expect(text).toContain('stage_tracking: block\n');
  });

  it('keeps comments and key order on a later write', () => {
    const path = join(root, '.paqad/configs/paqad.yaml');
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(
      path,
      '# team header\npaqad_version: "1.0.0"\n# why we pin\nupdates:\n  minimum_version: 1.2.0 # pinned\nenabled: true\n',
      'utf8',
    );
    setTeamConfigValue(root, 'auto_update', 'false');
    setTeamConfigValue(root, 'paqad_enable', 'false');
    expect(readFileSync(path, 'utf8')).toBe(
      '# team header\npaqad_version: "1.0.0"\n# why we pin\nupdates:\n  minimum_version: 1.2.0 # pinned\n  automatic: false\nenabled: false\n',
    );
  });

  it('restamps .last-applied.json when it writes git-workflow/commits.yaml', () => {
    setTeamConfigValue(root, 'ai_attribution', 'keep');
    expect(readFileSync(join(root, '.paqad/configs/git-workflow/commits.yaml'), 'utf8')).toContain(
      'ai_attribution: keep',
    );
    expect(changedOutside(root)).toEqual([]);
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
