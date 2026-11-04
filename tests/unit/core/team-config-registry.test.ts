import { describe, expect, it } from 'vitest';

import { FRAMEWORK_CONFIG_SPECS } from '@/core/framework-config.js';
import {
  checkYamlValue,
  fromYamlValue,
  personalValue,
  TEAM_CONFIG_FILES,
  TEAM_CONFIG_HOMES,
  toYamlValue,
  yamlDefault,
} from '@/core/team-config-values.js';

function spec(key: string) {
  const found = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
}

function legacyValues(row: (typeof FRAMEWORK_CONFIG_SPECS)[number]): string[] {
  if (row.enumValues !== undefined) return [...row.enumValues];
  if (row.type === 'boolean') return ['true', 'false'];
  if (row.type === 'number') return ['0', '1', '12.5'];
  return row.default === undefined ? ['x'] : [String(row.default)];
}

describe('team config registry', () => {
  it('gives every setting a file, a path and a since version', () => {
    expect(FRAMEWORK_CONFIG_SPECS.length).toBe(Object.keys(TEAM_CONFIG_HOMES).length);
    for (const row of FRAMEWORK_CONFIG_SPECS) {
      expect(row.file, row.key).toBeTruthy();
      expect(row.path.length, row.key).toBeGreaterThan(0);
      expect(row.since, row.key).toMatch(/^\d+\.\d+\.\d+$/u);
    }
  });

  it('never puts two settings at the same file and path', () => {
    const seen = new Map<string, string>();
    for (const row of FRAMEWORK_CONFIG_SPECS) {
      const where = `${row.file}:${row.path.join('.')}`;
      expect(seen.get(where), `${row.key} and ${seen.get(where)} share ${where}`).toBeUndefined();
      seen.set(where, row.key);
    }
  });

  it('never nests one setting under another setting', () => {
    const paths = FRAMEWORK_CONFIG_SPECS.map((row) => `${row.file}:${row.path.join('.')}`);
    for (const a of paths) {
      for (const b of paths) {
        expect(b.startsWith(`${a}.`), `${b} sits under ${a}`).toBe(false);
      }
    }
  });

  it('uses 12 team files plus git-workflow/commits.yaml for ai_attribution', () => {
    expect(TEAM_CONFIG_FILES).toHaveLength(12);
    const files = new Set(FRAMEWORK_CONFIG_SPECS.map((row) => row.file));
    expect(files.size).toBe(13);
    expect(spec('ai_attribution').file).toBe('git-workflow/commits.yaml');
    expect(spec('ai_attribution').path).toEqual(['ai_attribution']);
  });

  it('follows the issue table and the owner ruling for the later settings', () => {
    expect(spec('paqad_enable')).toMatchObject({ file: 'paqad.yaml', path: ['enabled'] });
    expect(spec('team_bootstrap_enabled')).toMatchObject({
      file: 'paqad.yaml',
      path: ['team_bootstrap', 'enabled'],
    });
    expect(spec('hud_view')).toMatchObject({ file: 'paqad.yaml', path: ['hud', 'band'] });
    expect(spec('spec_pipeline_standing_experts')).toMatchObject({
      file: 'feature-development/specification.yaml',
      path: ['experts', 'standing'],
    });
    expect(spec('rule_compliance')).toMatchObject({
      file: 'feature-development/rules.yaml',
      path: ['enforcement'],
    });
    expect(spec('stage_effort_documentation_sync').path).toEqual([
      'stages',
      'documentation_sync',
      'effort',
    ]);
    const authoring = FRAMEWORK_CONFIG_SPECS.filter((row) =>
      /^(skill|authoring|agent)_/u.test(row.key),
    );
    expect(authoring).toHaveLength(29);
    for (const row of authoring) {
      expect(row.file).toBe('authoring.yaml');
      expect(['skills', 'agents', 'runs']).toContain(row.path[0]);
    }
  });

  it('round-trips every allowed value through toYaml and fromYaml', () => {
    for (const row of FRAMEWORK_CONFIG_SPECS) {
      for (const value of legacyValues(row)) {
        expect(fromYamlValue(row, toYamlValue(row, value)), `${row.key}=${value}`).toBe(value);
      }
      const def = yamlDefault(row);
      if (def !== undefined) {
        expect(checkYamlValue(row, def), `${row.key} default`).toBeNull();
      }
    }
  });

  it('translates the special values', () => {
    expect(toYamlValue(spec('stages_mode'), 'strict')).toBe('block');
    expect(toYamlValue(spec('checks_flaky_under_parallel'), 'fail')).toBe('block');
    expect(toYamlValue(spec('rule_gate_pre_edit'), 'blocking-only')).toBe('blocking_only');
    expect(toYamlValue(spec('decisions_ask_threshold'), 'permissive')).toBe('rarely');
    expect(toYamlValue(spec('lean_rules'), 'false')).toBe('full');
    expect(toYamlValue(spec('spec_only_mode'), 'true')).toBe('specification');
    expect(toYamlValue(spec('checks_max_processes'), '0')).toBe('auto');
    expect(toYamlValue(spec('checks_max_processes'), '4')).toBe(4);
    expect(fromYamlValue(spec('checks_max_processes'), 'auto')).toBe('0');
    const experts = spec('spec_pipeline_standing_experts');
    expect(toYamlValue(experts, 'a, ,b ,')).toEqual(['a', 'b']);
    expect(fromYamlValue(experts, toYamlValue(experts, 'a, ,b ,'))).toBe('a,b');
    expect(fromYamlValue(spec('paqad_enable'), 'false')).toBe('false');
    expect(checkYamlValue(spec('paqad_enable'), 'false')).toBeNull();
  });

  it('accepts both vocabularies in personal and env values', () => {
    expect(personalValue(spec('stages_mode'), 'block')).toBe('strict');
    expect(personalValue(spec('stages_mode'), 'strict')).toBe('strict');
    expect(personalValue(spec('lean_rules'), 'lean')).toBe('true');
    expect(personalValue(spec('lean_rules'), 'yes')).toBe('yes');
    expect(personalValue(spec('spec_pipeline_standing_experts'), 'a,b')).toBe('a,b');
  });

  it('reports values outside the YAML vocabulary', () => {
    expect(checkYamlValue(spec('stages_mode'), 'strict')).toMatch(/off, warn, block/u);
    expect(checkYamlValue(spec('rag_top_n'), 'many')).toMatch(/number/u);
    expect(checkYamlValue(spec('paqad_enable'), 'maybe')).toMatch(/true or false/u);
    expect(checkYamlValue(spec('stage_isolation_lanes'), [{ a: 1 }])).toMatch(/list/u);
  });
});

describe('setting notes (AC-9)', () => {
  const CODE = /\b[A-Z]{1,3}\d*-\d+\b|\bS\d\b|\bR\d\b|\bA\d\b/u;

  it('gives every setting one plain sentence as its note', () => {
    for (const row of FRAMEWORK_CONFIG_SPECS) {
      const note = row.comment;
      expect(note.trim(), row.key).not.toBe('');
      expect(note, row.key).not.toMatch(/\n/u);
      expect(note, row.key).not.toMatch(/[–—]/u);
      expect(note, row.key).not.toMatch(CODE);
      expect(note, row.key).not.toContain(' | ');
      expect(note, row.key).not.toMatch(/\.\s+[A-Z]/u);
      expect(note, row.key).toMatch(/^[A-Z].*\.$/u);
    }
  });

  it('flags a note with a code, a dash, a value list or two sentences', () => {
    for (const bad of [
      'S6 trigger test.',
      'Lint (AG-003) cap.',
      'a — b.',
      'on | off.',
      'One. Two.',
    ]) {
      const plain =
        !CODE.test(bad) && !/[–—]/u.test(bad) && !bad.includes(' | ') && !/\.\s+[A-Z]/u.test(bad);
      expect(plain, bad).toBe(false);
    }
  });
});
