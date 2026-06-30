import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths';
import { DEFAULT_STAGES_MODE, resolveStagesMode } from '@/stage-evidence/mode';

describe('resolveStagesMode (buildout F4 + F2 clamp)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-stages-mode-'));
    mkdirSync(join(projectRoot, PATHS.AGENCY_DIR), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const writeTeamConfig = (body: string) => {
    mkdirSync(join(projectRoot, PATHS.AGENCY_DIR, 'configs'), { recursive: true });
    writeFileSync(join(projectRoot, PATHS.AGENCY_DIR, 'configs', '.config.policy'), body, 'utf8');
  };
  const writeLocalConfig = (body: string) =>
    writeFileSync(join(projectRoot, PATHS.PROJECT_CONFIG), body, 'utf8');

  it('defaults to strict (decision D3)', () => {
    expect(DEFAULT_STAGES_MODE).toBe('strict');
    expect(resolveStagesMode(projectRoot, {})).toBe('strict');
  });

  it('the TEAM config can lower the floor to off / warn (a committed decision)', () => {
    writeTeamConfig('stages_mode=off\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('off');
    writeTeamConfig('stages_mode=warn\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('warn');
  });

  it('local .config CANNOT lower below the team/default floor (the C2 fix)', () => {
    // No team value → floor is the strict default; a local downgrade is ignored.
    writeLocalConfig('stages_mode=off\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('strict');

    // Team floor warn → a local off cannot drop below it.
    writeTeamConfig('stages_mode=warn\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('warn');
  });

  it('local / env may RAISE strictness above the team floor', () => {
    writeTeamConfig('stages_mode=off\n');
    writeLocalConfig('stages_mode=strict\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('strict');

    writeLocalConfig('');
    expect(resolveStagesMode(projectRoot, { PAQAD_STAGES_MODE: 'warn' })).toBe('warn');
  });

  it('PAQAD_STAGES_MODE env cannot lower below the floor either', () => {
    writeTeamConfig('stages_mode=strict\n');
    expect(resolveStagesMode(projectRoot, { PAQAD_STAGES_MODE: 'off' })).toBe('strict');
  });

  it('an unrecognised value resolves to the floor (never silently disables)', () => {
    writeTeamConfig('stages_mode=banana\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('strict');
  });
});
