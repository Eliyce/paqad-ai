import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configSaysPaqadDisabled, resolveTeamBootstrapEnabled } from '@/core/framework-config.js';

import { isPaqadDisabled, readLayeredKey } from '../../../runtime/hooks/lib/paqad-disabled.mjs';
import {
  type Sandbox,
  cloneSucceeds,
  fakeDeps,
  loadLauncher,
  makeSandbox,
  payload,
  writeCopy,
} from './helpers';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => {
  sandbox.cleanup();
});

function writeFile(rel: string, body: string): void {
  const path = join(sandbox.project, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

async function run(env: NodeJS.ProcessEnv, event = 'PreToolUse', script = 'agent-entry-gate.mjs') {
  const launcher = await loadLauncher();
  const { deps, captured } = fakeDeps(sandbox, {
    readStdin: () => payload(event),
    runGit: (args) => {
      captured.gitCalls.push(args);
      return cloneSucceeds(sandbox)(args);
    },
  });
  const code = launcher.runLauncher([script], env, deps);
  return { code, captured };
}

describe('launcher off switches', () => {
  it.each(['1', 'true', 'YES', 'On', ' on '])(
    'PAQAD_DISABLED=%s exits 0 with no output and no child',
    async (value) => {
      writeCopy(join(sandbox.home, '.paqad-ai', 'team-plugin'));
      const { code, captured } = await run({ PAQAD_DISABLED: value });
      expect(code).toBe(0);
      expect(captured.stdout).toEqual([]);
      expect(captured.spawns).toEqual([]);
      expect(captured.gitCalls).toEqual([]);
    },
  );

  it.each(['2', ''])('PAQAD_DISABLED=%s does not disable', async (value) => {
    writeCopy(join(sandbox.home, '.paqad-ai', 'team-plugin'));
    const { captured } = await run({ PAQAD_DISABLED: value });
    expect(captured.spawns).toHaveLength(1);
  });

  it('paqad_enable=false exits 0 with no output and no child', async () => {
    writeCopy(join(sandbox.home, '.paqad-ai', 'team-plugin'));
    writeFile('.paqad/configs/.config.app', 'paqad_enable=false\n');
    const { code, captured } = await run({}, 'SessionStart', 'agent-entry-session-start.mjs');
    expect(code).toBe(0);
    expect(captured.stdout).toEqual([]);
    expect(captured.spawns).toEqual([]);
    expect(captured.gitCalls).toEqual([]);
  });

  it('team_bootstrap_enabled=false with no plugin and no npm exits 0 silently and never clones', async () => {
    writeFile('.paqad/configs/.config.app', 'team_bootstrap_enabled=false\n');
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) {
      const { code, captured } = await run({}, event, 'agent-entry-session-start.mjs');
      expect(code).toBe(0);
      expect(captured.stdout).toEqual([]);
      expect(captured.spawns).toEqual([]);
      expect(captured.gitCalls).toEqual([]);
    }
  });

  it('team_bootstrap_enabled=false leaves an existing copy unused, with no setup line or notice', async () => {
    writeCopy(join(sandbox.home, '.paqad-ai', 'team-plugin'));
    writeFile('.paqad/configs/.config.app', 'team_bootstrap_enabled=false\n');
    const start = await run({}, 'SessionStart', 'agent-entry-session-start.mjs');
    const prompt = await run({}, 'UserPromptSubmit', 'agent-entry-prompt-gate.mjs');
    for (const { code, captured } of [start, prompt]) {
      expect(code).toBe(0);
      expect(captured.stdout).toEqual([]);
      expect(captured.spawns).toEqual([]);
    }
  });

  it('env PAQAD_TEAM_BOOTSTRAP_ENABLED=true beats a file false', async () => {
    writeCopy(join(sandbox.home, '.paqad-ai', 'team-plugin'));
    writeFile('.paqad/configs/.config.app', 'team_bootstrap_enabled=false\n');
    const { captured } = await run({ PAQAD_TEAM_BOOTSTRAP_ENABLED: 'true' });
    expect(captured.spawns).toHaveLength(1);
  });

  it('of two team config files the one sorting last wins', async () => {
    writeCopy(join(sandbox.home, '.paqad-ai', 'team-plugin'));
    writeFile('.paqad/configs/.config.app', 'team_bootstrap_enabled=true\n');
    writeFile('.paqad/configs/.config.zz', 'team_bootstrap_enabled=false\n');
    const off = await run({});
    expect(off.captured.spawns).toEqual([]);
    writeFile('.paqad/configs/.config.app', 'team_bootstrap_enabled=false\n');
    writeFile('.paqad/configs/.config.zz', 'team_bootstrap_enabled=true\n');
    const on = await run({});
    expect(on.captured.spawns).toHaveLength(1);
  });
});

interface Row {
  name: string;
  files: Record<string, string>;
  env: NodeJS.ProcessEnv;
  paqadOff: boolean;
  teamOff: boolean;
}

const ROWS: Row[] = [
  { name: 'nothing set', files: {}, env: {}, paqadOff: false, teamOff: false },
  {
    name: 'team file false',
    files: { '.paqad/configs/.config.app': 'paqad_enable=false\nteam_bootstrap_enabled=no\n' },
    env: {},
    paqadOff: true,
    teamOff: true,
  },
  {
    name: 'local beats team',
    files: {
      '.paqad/configs/.config.app': 'paqad_enable=false\nteam_bootstrap_enabled=false\n',
      '.paqad/.config': 'paqad_enable=true\nteam_bootstrap_enabled=true\n',
    },
    env: {},
    paqadOff: false,
    teamOff: false,
  },
  {
    name: 'env beats local',
    files: { '.paqad/.config': 'paqad_enable=false\nteam_bootstrap_enabled=false\n' },
    env: { PAQAD_ENABLE: 'on', PAQAD_TEAM_BOOTSTRAP_ENABLED: 'TRUE' },
    paqadOff: false,
    teamOff: false,
  },
  {
    name: 'env off',
    files: {},
    env: { PAQAD_ENABLE: ' OFF ', PAQAD_TEAM_BOOTSTRAP_ENABLED: '0' },
    paqadOff: true,
    teamOff: true,
  },
  {
    name: 'blank env is ignored',
    files: { '.paqad/configs/.config.app': 'paqad_enable=0\nteam_bootstrap_enabled=0\n' },
    env: { PAQAD_ENABLE: '  ', PAQAD_TEAM_BOOTSTRAP_ENABLED: '' },
    paqadOff: true,
    teamOff: true,
  },
  {
    name: 'last sorting team file wins',
    files: {
      '.paqad/configs/.config.app': 'paqad_enable=false\nteam_bootstrap_enabled=false\n',
      '.paqad/configs/.config.policy': 'paqad_enable=true\nteam_bootstrap_enabled=true\n',
    },
    env: {},
    paqadOff: false,
    teamOff: false,
  },
  {
    name: 'example file is never read',
    files: {
      '.paqad/configs/.config.example': 'paqad_enable=false\nteam_bootstrap_enabled=false\n',
    },
    env: {},
    paqadOff: false,
    teamOff: false,
  },
  {
    name: 'quoted and commented values',
    files: { '.paqad/.config': 'paqad_enable="false"\nteam_bootstrap_enabled=off # team\n' },
    env: {},
    paqadOff: true,
    teamOff: true,
  },
  {
    name: 'unknown values keep it on',
    files: { '.paqad/.config': 'paqad_enable=banana\nteam_bootstrap_enabled=maybe\n' },
    env: {},
    paqadOff: false,
    teamOff: false,
  },
];

describe('one key resolution for the launcher, src and the hook libs', () => {
  it.each(ROWS)('$name', async (row) => {
    for (const [rel, body] of Object.entries(row.files)) writeFile(rel, body);
    const launcher = (await loadLauncher()) as unknown as {
      keyIsOff: (root: string, key: string, envName: string, env: NodeJS.ProcessEnv) => boolean;
      readLayeredKey: (
        root: string,
        key: string,
        envName: string,
        env: NodeJS.ProcessEnv,
      ) => unknown;
    };
    const root = sandbox.project;

    expect(launcher.keyIsOff(root, 'paqad_enable', 'PAQAD_ENABLE', row.env)).toBe(row.paqadOff);
    expect(configSaysPaqadDisabled(root, row.env)).toBe(row.paqadOff);
    expect(isPaqadDisabled(root, row.env)).toBe(row.paqadOff);

    const teamKey = ['team_bootstrap_enabled', 'PAQAD_TEAM_BOOTSTRAP_ENABLED'] as const;
    expect(launcher.keyIsOff(root, ...teamKey, row.env)).toBe(row.teamOff);
    expect(resolveTeamBootstrapEnabled(root, row.env)).toBe(!row.teamOff);
    expect(launcher.readLayeredKey(root, ...teamKey, row.env)).toBe(
      readLayeredKey(root, ...teamKey, row.env),
    );
  });
});
