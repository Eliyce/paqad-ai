import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths';
import {
  DEFAULT_STAGE_ISOLATION_MODE,
  isStageIsolationOn,
  resolveStageIsolation,
} from '@/stage-isolation/mode';

describe('resolveStageIsolation (issue #567, F2 floor clamp)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-stage-isolation-'));
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

  it('defaults to off (byte-identical to before the feature)', () => {
    expect(DEFAULT_STAGE_ISOLATION_MODE).toBe('off');
    expect(resolveStageIsolation(projectRoot, {})).toBe('off');
    expect(isStageIsolationOn(projectRoot, {})).toBe(false);
  });

  it('the TEAM config can turn it on (a committed decision)', () => {
    writeTeamConfig('stage_isolation=on\n');
    expect(resolveStageIsolation(projectRoot, {})).toBe('on');
    expect(isStageIsolationOn(projectRoot, {})).toBe(true);
  });

  it('local / env may RAISE off → on', () => {
    writeLocalConfig('stage_isolation=on\n');
    expect(resolveStageIsolation(projectRoot, {})).toBe('on');

    writeLocalConfig('');
    expect(resolveStageIsolation(projectRoot, { PAQAD_STAGE_ISOLATION: 'on' })).toBe('on');
  });

  it('local / env CANNOT lower a team on back to off (the floor clamp)', () => {
    writeTeamConfig('stage_isolation=on\n');
    writeLocalConfig('stage_isolation=off\n');
    expect(resolveStageIsolation(projectRoot, {})).toBe('on');
    expect(resolveStageIsolation(projectRoot, { PAQAD_STAGE_ISOLATION: 'off' })).toBe('on');
  });

  it('an unrecognised value is ignored and falls to the off default (never silently enables)', () => {
    writeTeamConfig('stage_isolation=banana\n');
    expect(resolveStageIsolation(projectRoot, {})).toBe('off');
  });
});
