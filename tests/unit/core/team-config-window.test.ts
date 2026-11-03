import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { warnLegacyTeamConfig } from '@/cli/program.js';
import { PATHS } from '@/core/constants/paths.js';
import { LEGACY_TEAM_CONFIG_READ_UNTIL, layeredConfigMap } from '@/core/framework-config.js';
import { readTeamConfig } from '@/core/team-config.js';
import {
  legacyTeamConfigReadable,
  releasedAfterLegacyWindow,
  setTeamConfigClock,
} from '@/core/team-config-legacy.js';
import { migrateTeamConfig } from '@/core/team-config-migrate.js';
import {
  legacyAfterWindowLines,
  missingTeamConfigFiles,
  teamConfigSessionStartText,
} from '@/core/team-config-report.js';

import {
  isPaqadOff,
  LEGACY_TEAM_CONFIG_READ_UNTIL as MOD_UNTIL,
} from '../../../runtime/claude-plugin/mod/config';
import {
  LEGACY_TEAM_CONFIG_READ_UNTIL as HOOK_UNTIL,
  legacyTeamConfigReadable as hookLegacyReadable,
} from '../../../runtime/hooks/lib/paqad-disabled.mjs';
import { mergeSessionStartOutput } from '../../../runtime/hooks/lib/session-start-output.mjs';
import { LEGACY_TEAM_CONFIG_READ_UNTIL as LAUNCHER_UNTIL } from '../../../runtime/templates/team-bootstrap/hook.mjs';

const SH = resolve(__dirname, '../../../runtime/hooks/lib/paqad-disabled.sh');
const itPosix = process.platform === 'win32' ? it.skip : it;
const INSIDE = '2026-12-01';
const AFTER = '2027-03-01';

let root: string;

function write(rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'team-config-window-'));
  mkdirSync(join(root, PATHS.PROJECT_CONFIGS_DIR), { recursive: true });
});

afterEach(() => {
  setTeamConfigClock(null);
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('inside the window', () => {
  beforeEach(() => setTeamConfigClock({ today: () => INSIDE }));

  it('uses an old-file value with its warning, and YAML wins on conflict (AC-66)', () => {
    write('.paqad/configs/.config.policy', 'stages_mode=warn\nrag_top_n=3\n');
    write('.paqad/configs/feature-development/workflow.yaml', 'stage_tracking: off\n');
    const map = layeredConfigMap(root, {});
    expect(map.get('stages_mode')).toBe('off');
    expect(map.get('rag_top_n')).toBe('3');
    expect(readTeamConfig(root).issues.map((issue) => issue.message)).toEqual([
      'stages_mode is set in both .paqad/configs/.config.policy and feature-development/workflow.yaml; paqad uses the YAML value. Run paqad-ai config migrate to clean up.',
      'rag_top_n is still in .paqad/configs/.config.policy. Run paqad-ai config migrate to move it.',
    ]);
    expect(legacyAfterWindowLines(root)).toEqual([]);
  });

  it('a stub is never read as old settings', () => {
    write('.paqad/configs/.config.policy', 'stages_mode=warn\n');
    migrateTeamConfig(root, { version: '1.117.0', activeChange: null });
    expect(readTeamConfig(root).issues).toEqual([]);
  });
});

describe('after the window', () => {
  beforeEach(() => setTeamConfigClock({ today: () => AFTER }));

  it('stops reading old files and names each one on every command and session start (AC-66)', () => {
    write('.paqad/configs/.config.policy', 'stages_mode=warn\n');
    expect(legacyTeamConfigReadable()).toBe(false);
    expect(layeredConfigMap(root, {}).get('stages_mode')).toBeUndefined();
    const line =
      'Old settings in .paqad/configs/.config.policy are no longer read. Run paqad-ai config migrate to move them.';
    expect(legacyAfterWindowLines(root)).toEqual([line]);
    const errors: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
    warnLegacyTeamConfig(root);
    expect(errors).toEqual([`${line}\n`]);
    expect(teamConfigSessionStartText(root)).toBe(`paqad team settings:\n- ${line}`);
  });

  it('knows whether this release was published after the window (AC-66)', () => {
    setTeamConfigClock({ today: () => AFTER, releaseDate: () => '2027-01-15' });
    expect(releasedAfterLegacyWindow()).toBe(false);
    setTeamConfigClock({ today: () => AFTER, releaseDate: () => '2027-02-02' });
    expect(releasedAfterLegacyWindow()).toBe(true);
  });
});

describe('the readers outside TypeScript use the same date', () => {
  it('every copy of the date matches', () => {
    expect(HOOK_UNTIL).toBe(LEGACY_TEAM_CONFIG_READ_UNTIL);
    expect(MOD_UNTIL).toBe(LEGACY_TEAM_CONFIG_READ_UNTIL);
    expect(LAUNCHER_UNTIL).toBe(LEGACY_TEAM_CONFIG_READ_UNTIL);
    expect(readFileSync(SH, 'utf8')).toContain(
      `-le ${LEGACY_TEAM_CONFIG_READ_UNTIL.replaceAll('-', '')} ]`,
    );
  });

  it('the hook and the mod stop reading old files after the date', () => {
    expect(hookLegacyReadable(INSIDE)).toBe(true);
    expect(hookLegacyReadable(AFTER)).toBe(false);
    const input = {
      env: {},
      localConfig: null,
      teamConfigs: [{ name: '.config.app', text: 'paqad_enable=false\n' }],
    };
    expect(isPaqadOff({ ...input, today: INSIDE })).toBe(true);
    expect(isPaqadOff({ ...input, today: AFTER })).toBe(false);
  });

  itPosix('the shell hook stops reading old files after the date', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    write('.paqad/configs/.config.app', 'paqad_enable=false\n');
    const run = (today: string): string =>
      execFileSync(
        'bash',
        [
          '-c',
          `. "${SH}"; __paqad_today() { printf '%s' '${today}'; }; if paqad_is_disabled; then echo off; else echo on; fi`,
        ],
        {
          env: { ...process.env, PAQAD_DISABLED: '', PAQAD_ENABLE: '', CLAUDE_PROJECT_DIR: root },
          encoding: 'utf8',
        },
      ).trim();
    expect(run(INSIDE)).toBe('off');
    expect(run(AFTER)).toBe('on');
  });
});

describe('session start reporting', () => {
  it('reports team files missing once the old files are gone', () => {
    write('.paqad/configs/.config.policy', 'stages_mode=warn\n');
    migrateTeamConfig(root, { version: '1.117.0', activeChange: null });
    expect(missingTeamConfigFiles(root)).toEqual([]);
    rmSync(join(root, '.paqad/configs/models.yaml'));
    expect(missingTeamConfigFiles(root)).toEqual(['models.yaml']);
    expect(teamConfigSessionStartText(root)).toBe(
      'paqad team settings:\n- .paqad/configs/models.yaml is missing. Run paqad-ai update to create it.',
    );
  });

  it('reports invalid values and files', () => {
    write('.paqad/configs/paqad.yaml', 'enabled: [\n');
    write('.paqad/configs/retrieval.yaml', 'match:\n  max_results: lots\n');
    const text = teamConfigSessionStartText(root)!;
    expect(text).toContain("paqad.yaml isn't valid YAML, so none of its settings are used:");
    expect(text).toContain(
      'retrieval.yaml: match.max_results has an invalid value lots, so paqad uses the default',
    );
  });

  it('merges the notice into the stage-agent output as one JSON object', () => {
    const stage = `${JSON.stringify({
      systemMessage: 'stage agents missing',
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'ctx' },
    })}\n`;
    expect(mergeSessionStartOutput(stage, null)).toBe(stage);
    expect(JSON.parse(mergeSessionStartOutput(stage, 'team'))).toEqual({
      systemMessage: 'stage agents missing\n\nteam',
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'ctx\n\nteam' },
    });
    expect(JSON.parse(mergeSessionStartOutput(null, 'team'))).toEqual({
      systemMessage: 'team',
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'team' },
    });
  });
});
