import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FRAMEWORK_CONFIG_SPECS } from '@/core/framework-config.js';
import { fromYamlValue, TEAM_CONFIG_HOMES } from '@/core/team-config-values.js';

import {
  readYamlScalar as modReadYamlScalar,
  isHudViewOff,
  isPaqadOff,
  teamSwitchProblems,
} from '../../../runtime/claude-plugin/mod/config';
import {
  HOOK_TEAM_HOMES,
  isPaqadDisabled,
  readFlooredMode,
  readLayeredKey,
} from '../../../runtime/hooks/lib/paqad-disabled.mjs';
import { readYamlScalar } from '../../../runtime/hooks/lib/yaml-scalar.mjs';
import { readYamlScalar as launcherReadYamlScalar } from '../../../runtime/templates/team-bootstrap/hook.mjs';

const SH = resolve(__dirname, '../../../runtime/hooks/lib/paqad-disabled.sh');
const itPosix = process.platform === 'win32' ? it.skip : it;

const ENABLED_CASES: ReadonlyArray<[string, string, string | undefined]> = [
  ['plain', 'enabled: false\n', 'false'],
  ['a trailing comment', 'enabled: false # off for the demo\n', 'false'],
  ['double quotes', 'enabled: "false"\n', 'false'],
  ['single quotes', "enabled: 'off'\n", 'off'],
  ['blank lines and comments first', '# header\n\n# more\nenabled: no\n', 'no'],
  ['a missing key', 'paqad_version: "1.0.0"\n', undefined],
  ['CRLF line endings', 'paqad_version: "1"\r\nenabled: false\r\n', 'false'],
  ['an empty value', 'enabled:\n', undefined],
  ['an empty value with a comment', 'enabled: # unset\n', undefined],
  ['a nested key named like the top-level one', 'hud:\n  enabled: false\n', undefined],
  ['a tab-indented nested key', 'hud:\n\tenabled: false\nenabled: true\n', 'true'],
  ['mixed indentation', 'hud:\n \tenabled: false\n  band: true\nenabled: on\n', 'on'],
  ['a # without a leading space', 'enabled: off#later\n', 'off#later'],
  ['a key that only starts with the name', 'enabled_extra: false\n', undefined],
  ['the first of two lines', 'enabled: false\nenabled: true\n', 'false'],
  ['a mixed-case value', 'enabled: FALSE\n', 'FALSE'],
];

function shReadEnabled(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-yaml-sh-'));
  try {
    const file = join(dir, 'paqad.yaml');
    writeFileSync(file, text);
    return execFileSync('bash', ['-c', `. "${SH}"; __paqad_read_yaml_enabled "${file}"`], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readYamlScalar', () => {
  for (const [name, text, expected] of ENABLED_CASES) {
    it(`reads enabled with ${name} (AC-54)`, () => {
      expect(readYamlScalar(text, ['enabled'])).toBe(expected);
      expect(modReadYamlScalar(text, ['enabled'])).toBe(expected);
      expect(launcherReadYamlScalar(text, ['enabled'])).toBe(expected);
    });

    itPosix(`the shell reader agrees on ${name} (AC-54)`, () => {
      expect(shReadEnabled(text).replace(/\n$/u, '')).toBe((expected ?? '').toLowerCase());
    });
  }

  const NESTED: ReadonlyArray<[string, string, string | undefined]> = [
    ['two levels', 'hud:\n  band: false\n  chime: true\n', 'true'],
    ['tab indentation', 'hud:\n\tband: false\n\tchime: on\n', 'on'],
    ['comments and blank lines inside', 'hud:\n  # note\n\n  chime: "yes" # x\n', 'yes'],
    ['a deeper key with the same name', 'hud:\n  band:\n    chime: true\n  other: 1\n', undefined],
    ['a missing child', 'hud:\n  band: true\nchime: true\n', undefined],
    ['a missing parent', 'updates:\n  chime: true\n', undefined],
    ['CRLF', 'hud:\r\n  chime: true\r\n', 'true'],
  ];
  for (const [name, text, expected] of NESTED) {
    it(`reads hud.chime with ${name}`, () => {
      expect(readYamlScalar(text, ['hud', 'chime'])).toBe(expected);
      expect(modReadYamlScalar(text, ['hud', 'chime'])).toBe(expected);
      expect(launcherReadYamlScalar(text, ['hud', 'chime'])).toBe(expected);
    });
  }

  it('returns undefined for a path it does not handle', () => {
    expect(readYamlScalar('a:\n  b:\n    c: 1\n', ['a', 'b', 'c'])).toBeUndefined();
    expect(readYamlScalar(undefined, ['a'])).toBeUndefined();
  });
});

describe('HOOK_TEAM_HOMES matches the registry', () => {
  for (const [key, home] of Object.entries(HOOK_TEAM_HOMES)) {
    it(`${key} has the registry home and translation`, () => {
      const registry = TEAM_CONFIG_HOMES[key]!;
      expect(home.file).toBe(registry.file);
      expect(home.path).toEqual([...registry.path]);
      const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === key)!;
      for (const [yaml, flat] of Object.entries(home.from ?? {})) {
        expect(fromYamlValue(spec, yaml)).toBe(flat);
      }
    });
  }
});

describe('hooks and the mod read the team switch from paqad.yaml', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-yaml-hooks-'));
    mkdirSync(join(root, '.paqad', 'configs', 'feature-development'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function team(file: string, text: string): void {
    writeFileSync(join(root, '.paqad', 'configs', file), text);
  }

  function shDisabled(env: Record<string, string> = {}): boolean {
    const out = execFileSync(
      'bash',
      ['-c', `. "${SH}"; if paqad_is_disabled; then echo disabled; else echo enabled; fi`],
      {
        env: {
          ...process.env,
          PAQAD_DISABLED: '',
          PAQAD_ENABLE: '',
          CLAUDE_PROJECT_DIR: root,
          ...env,
        },
        encoding: 'utf8',
      },
    );
    return out.trim() === 'disabled';
  }

  const CASES: ReadonlyArray<{
    name: string;
    yaml?: string;
    legacy?: string;
    local?: string;
    env?: Record<string, string>;
    off: boolean;
  }> = [
    { name: 'nothing set', off: false },
    { name: 'enabled: false', yaml: 'enabled: false\n', off: true },
    {
      name: 'enabled: false with CRLF',
      yaml: 'paqad_version: "1"\r\nenabled: false\r\n',
      off: true,
    },
    {
      name: 'YAML wins over the old file',
      yaml: 'enabled: true\n',
      legacy: 'paqad_enable=false\n',
      off: false,
    },
    { name: 'the old file when YAML is silent', legacy: 'paqad_enable=false\n', off: true },
    {
      name: 'personal over team',
      yaml: 'enabled: false\n',
      local: 'paqad_enable=true\n',
      off: false,
    },
    {
      name: 'PAQAD_ENABLE over personal',
      yaml: 'enabled: true\n',
      local: 'paqad_enable=true\n',
      env: { PAQAD_ENABLE: 'off' },
      off: true,
    },
    {
      name: 'PAQAD_DISABLED over all',
      yaml: 'enabled: true\n',
      env: { PAQAD_DISABLED: '1' },
      off: true,
    },
    { name: 'an unreadable value means on', yaml: 'enabled: maybe\n', off: false },
    { name: 'a broken file means on', yaml: 'enabled: [false\n', off: false },
  ];

  function arrange(c: (typeof CASES)[number]): void {
    if (c.yaml !== undefined) team('paqad.yaml', c.yaml);
    if (c.legacy !== undefined) team('.config.app', c.legacy);
    if (c.local !== undefined) writeFileSync(join(root, '.paqad', '.config'), c.local);
  }

  for (const c of CASES) {
    it(`.mjs and the mod agree: ${c.name} (AC-53)`, () => {
      arrange(c);
      const env = { ...(c.env ?? {}) };
      expect(isPaqadDisabled(root, env)).toBe(c.off);
      const teamConfigs = c.legacy === undefined ? [] : [{ name: '.config.app', text: c.legacy }];
      expect(
        isPaqadOff({ env, localConfig: c.local ?? null, teamConfigs, paqadYaml: c.yaml ?? null }),
      ).toBe(c.off);
    });

    itPosix(`the shell hook agrees: ${c.name}`, () => {
      arrange(c);
      expect(shDisabled(c.env ?? {})).toBe(c.off);
    });
  }

  it('reports an unreadable switch in the hooks log and in the mod (AC-53)', () => {
    const text = 'enabled: maybe\nhud:\n  band: sometimes\n';
    team('paqad.yaml', text);
    expect(isPaqadDisabled(root, {})).toBe(false);
    const log = readFileSync(join(root, '.paqad', 'logs', 'hooks.log'), 'utf8');
    expect(log).toContain(
      '.paqad/configs/paqad.yaml: enabled has a value paqad cannot read (maybe), so paqad uses its default.',
    );
    expect(teamSwitchProblems({ localConfig: null, teamConfigs: [], paqadYaml: text })).toEqual([
      '.paqad/configs/paqad.yaml: enabled has a value paqad cannot read (maybe), so paqad uses its default.',
      '.paqad/configs/paqad.yaml: hud.band has a value paqad cannot read (sometimes), so paqad uses its default.',
    ]);
  });

  itPosix('the shell hook logs an unreadable switch', () => {
    team('paqad.yaml', 'enabled: maybe\n');
    expect(shDisabled()).toBe(false);
    const log = readFileSync(join(root, '.paqad', 'logs', 'hooks.log'), 'utf8');
    expect(log).toContain('enabled has a value paqad cannot read (maybe), so paqad stays on.');
  });

  it('the mod reads hud.band from paqad.yaml, below personal and env (AC-53)', () => {
    const off = { env: {}, localConfig: null, teamConfigs: [], paqadYaml: 'hud:\n  band: false\n' };
    expect(isHudViewOff(off)).toBe(true);
    expect(isHudViewOff({ ...off, localConfig: 'hud_view=true\n' })).toBe(false);
    expect(
      isHudViewOff({
        env: { PAQAD_HUD_VIEW: 'false' },
        localConfig: null,
        teamConfigs: [],
        paqadYaml: 'hud:\n  band: true\n',
      }),
    ).toBe(true);
  });

  it('other hook settings read their YAML home and translate back to the flat value', () => {
    team('feature-development/rules.yaml', 'enforcement: block\nloading: full\n');
    team('feature-development/workflow.yaml', 'stage_tracking: block\n');
    team('paqad.yaml', 'updates:\n  automatic: false\n  minimum_version: "2.0.0"\n');
    expect(readLayeredKey(root, 'lean_rules', 'PAQAD_LEAN_RULES', {})).toBe('false');
    expect(readLayeredKey(root, 'auto_update', 'PAQAD_AUTO_UPDATE', {})).toBe('false');
    expect(readLayeredKey(root, 'minimum_version', 'PAQAD_MINIMUM_VERSION', {})).toBe('2.0.0');
    const order = ['off', 'warn', 'strict'];
    expect(
      readFlooredMode(root, 'rule_compliance', 'PAQAD_RULE_COMPLIANCE', order, 'warn', {}),
    ).toBe('strict');
    expect(readFlooredMode(root, 'stages_mode', 'PAQAD_STAGES_MODE', order, 'warn', {})).toBe(
      'strict',
    );
    team('feature-development/workflow.yaml', 'stage_tracking: warn\n');
    expect(
      readFlooredMode(root, 'stages_mode', 'PAQAD_STAGES_MODE', order, 'warn', {
        PAQAD_STAGES_MODE: 'block',
      }),
    ).toBe('strict');
  });
});
