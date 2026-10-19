import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isPaqadDisabled } from '../../../../runtime/hooks/lib/paqad-disabled.mjs';
import {
  MIN_ENGINE,
  ancestorDirs,
  decideStatus,
  isEngineNewEnough,
  isPaqadOff,
  readConfigKey,
  registersCommand,
  standDownReason,
  type StandDownInput,
} from '../../../../runtime/claude-plugin/mod/config.ts';

// Issue #639, Part 8 (decision 5, AC-36): the mod registers nothing when the view is off, the
// project was never onboarded, the session runs in the cloud, paqad is off, or Claude Code is
// older than 2.1.301. The enable switch must resolve exactly as the hooks resolve it.

const ON: StandDownInput = {
  view: true,
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
    ['view-off', { view: false }],
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

  it('checks the view first, so view off registers nothing even in a broken setup', () => {
    expect(standDownReason({ ...ON, view: false, onboarded: false, engine: null })).toBe(
      'view-off',
    );
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
