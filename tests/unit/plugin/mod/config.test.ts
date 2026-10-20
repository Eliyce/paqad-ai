import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isPaqadDisabled } from '../../../../runtime/hooks/lib/paqad-disabled.mjs';
import {
  MIN_ENGINE,
  ancestorDirs,
  decideStatus,
  isChimeOn,
  isEngineNewEnough,
  isPaqadOff,
  readConfigKey,
  registersCommand,
  standDownReason,
  type StandDownInput,
} from '../../../../runtime/claude-plugin/mod/config.ts';

const ON: StandDownInput = {
  onboarded: true,
  env: {},
  localConfig: null,
  teamConfigs: [],
  engine: { version: '2.1.302', base: '2.1.302' },
};

describe('mod stand-downs (decision 5)', () => {
  it('runs when every condition holds', () => {
    expect(standDownReason(ON)).toBeNull();
    expect(decideStatus(ON)).toEqual({ on: true, reason: null });
  });

  it.each([
    ['view-off', { env: { PAQAD_HUD_VIEW: 'false' } }],
    ['view-off', { localConfig: 'hud_view=false\n' }],
    ['view-off', { teamConfigs: [{ name: '.config.app', text: 'hud_view=off\n' }] }],
    ['not-onboarded', { onboarded: false }],
    ['remote', { env: { CLAUDE_CODE_REMOTE: 'true' } }],
    ['remote', { env: { CLAUDE_CODE_REMOTE: ' TRUE ' } }],
    ['disabled', { env: { PAQAD_DISABLED: '1' } }],
    ['disabled', { localConfig: 'paqad_enable=off\n' }],
    ['old-engine', { engine: { version: '2.1.300', base: '2.1.300' } }],
    ['old-engine', { engine: null }],
  ] as const)('stands down as %s', (reason, over) => {
    const input = { ...ON, ...over } as StandDownInput;
    expect(standDownReason(input)).toBe(reason);
    expect(decideStatus(input)).toEqual({ on: false, reason });
  });

  it('keeps running when CLAUDE_CODE_REMOTE is anything but true', () => {
    expect(standDownReason({ ...ON, env: { CLAUDE_CODE_REMOTE: 'false' } })).toBeNull();
  });

  it('checks hud_view first, so the HUD off registers nothing even in a broken setup', () => {
    expect(
      standDownReason({ ...ON, env: { PAQAD_HUD_VIEW: '0' }, onboarded: false, engine: null }),
    ).toBe('view-off');
  });

  it('layers hud_view like paqad_enable: env, then .paqad/.config, then the last team file', () => {
    const team = [
      { name: '.config.app', text: 'hud_view=false\n' },
      { name: '.config.zz', text: 'hud_view=true\n' },
    ];
    expect(standDownReason({ ...ON, teamConfigs: team })).toBeNull();
    expect(standDownReason({ ...ON, teamConfigs: team, localConfig: 'hud_view=no\n' })).toBe(
      'view-off',
    );
    expect(
      standDownReason({
        ...ON,
        teamConfigs: team,
        localConfig: 'hud_view=no\n',
        env: { PAQAD_HUD_VIEW: 'true' },
      }),
    ).toBeNull();
    expect(standDownReason({ ...ON, env: { PAQAD_HUD_VIEW: '  ' } })).toBeNull();
  });
});

describe('engine version gate (Q6: 2.1.301 or newer)', () => {
  it.each([
    [{ version: '2.1.301', base: '2.1.301' }, true],
    [{ version: '2.1.302-dev.20261018', base: '2.1.302-dev' }, true],
    [{ version: '2.2.0' }, true],
    [{ version: '3.0.0' }, true],
    [{ version: '2.1.300', base: '2.1.300' }, false],
    [{ version: '2.0.999' }, false],
    [{ version: '1.9.400' }, false],
    [{ version: 'nightly' }, false],
    [{ version: 'nightly', base: '2.1.305' }, true],
  ])('%o -> %s', (engine, ok) => {
    expect(isEngineNewEnough(engine)).toBe(ok);
  });

  it('names 2.1.301 as the floor', () => {
    expect(MIN_ENGINE).toBe('2.1.301');
  });
});

describe('readConfigKey', () => {
  it('takes the last uncommented line, quotes and inline comments stripped', () => {
    expect(readConfigKey('paqad_enable=true\npaqad_enable=false\n', 'paqad_enable')).toBe('false');
    expect(readConfigKey('# paqad_enable=false\n', 'paqad_enable')).toBeUndefined();
    expect(readConfigKey('export paqad_enable="off"\n', 'paqad_enable')).toBe('off');
    expect(readConfigKey("paqad_enable='no'\n", 'paqad_enable')).toBe('no');
    expect(readConfigKey('paqad_enable=off # local only\n', 'paqad_enable')).toBe('off');
    expect(readConfigKey(null, 'paqad_enable')).toBeUndefined();
  });
});

describe('the enable switch matches the hooks (paqad-disabled.mjs)', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  type Case = {
    name: string;
    env?: Record<string, string>;
    local?: string;
    team?: Record<string, string>;
  };
  const cases: Case[] = [
    { name: 'nothing set' },
    { name: 'local off', local: 'paqad_enable=false\n' },
    { name: 'local on', local: 'paqad_enable=true\n' },
    { name: 'team off', team: { '.config.app': 'paqad_enable=0\n' } },
    {
      name: 'last-sorting team file wins',
      team: { '.config.app': 'paqad_enable=off\n', '.config.zeta': 'paqad_enable=on\n' },
    },
    {
      name: 'the example file never counts',
      team: { '.config.example': 'paqad_enable=off\n' },
    },
    {
      name: 'local wins over team',
      local: 'paqad_enable=yes\n',
      team: { '.config.app': 'paqad_enable=no\n' },
    },
    {
      name: 'PAQAD_ENABLE wins over local',
      env: { PAQAD_ENABLE: 'off' },
      local: 'paqad_enable=true\n',
    },
    {
      name: 'blank PAQAD_ENABLE is ignored',
      env: { PAQAD_ENABLE: '  ' },
      local: 'paqad_enable=no',
    },
    { name: 'PAQAD_DISABLED wins over all', env: { PAQAD_DISABLED: 'yes', PAQAD_ENABLE: 'on' } },
    { name: 'PAQAD_DISABLED false is ignored', env: { PAQAD_DISABLED: 'false' } },
    { name: 'an unknown word means on', local: 'paqad_enable=maybe\n' },
  ];

  it.each(cases)('$name', (c) => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-mod-config-'));
    roots.push(root);
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    if (c.local !== undefined) writeFileSync(join(root, '.paqad', '.config'), c.local);
    for (const [name, text] of Object.entries(c.team ?? {})) {
      writeFileSync(join(root, '.paqad', 'configs', name), text);
    }
    const env = c.env ?? {};
    const expected = isPaqadDisabled(root, env);
    const actual = isPaqadOff({
      env,
      localConfig: c.local ?? null,
      teamConfigs: Object.entries(c.team ?? {}).map(([name, text]) => ({ name, text })),
    });
    expect(actual).toBe(expected);
  });
});

describe('registersCommand', () => {
  it('keeps /paqad when on, and alone in a project never onboarded (AC-38)', () => {
    expect(registersCommand({ on: true, reason: null })).toBe(true);
    expect(registersCommand({ on: false, reason: 'not-onboarded' })).toBe(true);
    for (const reason of ['view-off', 'remote', 'disabled', 'old-engine'] as const) {
      expect(registersCommand({ on: false, reason })).toBe(false);
    }
  });
});

describe('ancestorDirs', () => {
  it.each([
    ['/a/b/c', ['/a/b/c', '/a/b', '/a', '/']],
    ['/', ['/']],
    ['C:\\work\\app', ['C:\\work\\app', 'C:\\work', 'C:\\']],
    ['relative', ['relative']],
  ])('%s', (root, dirs) => {
    expect(ancestorDirs(root)).toEqual(dirs);
  });
});

describe('the hud_chime setting', () => {
  const base = { env: {}, localConfig: null, teamConfigs: [] };

  it('is off by default and for any value that is not a yes', () => {
    expect(isChimeOn(base)).toBe(false);
    for (const value of ['false', 'off', '0', 'maybe', '']) {
      expect(isChimeOn({ ...base, localConfig: `hud_chime=${value}\n` }), value).toBe(false);
    }
  });

  it('layers like hud_view: env, then .paqad/.config, then the last team file', () => {
    const team = [{ name: '.config.app', text: 'hud_chime=true\n' }];
    expect(isChimeOn({ ...base, teamConfigs: team })).toBe(true);
    expect(isChimeOn({ ...base, teamConfigs: team, localConfig: 'hud_chime=off\n' })).toBe(false);
    expect(
      isChimeOn({
        ...base,
        teamConfigs: team,
        localConfig: 'hud_chime=off\n',
        env: { PAQAD_HUD_CHIME: 'yes' },
      }),
    ).toBe(true);
    expect(isChimeOn({ ...base, env: { PAQAD_HUD_CHIME: 'ON' } })).toBe(true);
    expect(
      isChimeOn({ ...base, teamConfigs: [{ name: '.config.example', text: 'hud_chime=true\n' }] }),
    ).toBe(false);
  });
});
