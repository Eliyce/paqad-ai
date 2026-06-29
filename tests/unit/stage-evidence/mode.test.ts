import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths';
import { DEFAULT_STAGES_MODE, resolveStagesMode } from '@/stage-evidence/mode';

describe('resolveStagesMode (buildout F4)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-stages-mode-'));
    mkdirSync(join(projectRoot, PATHS.AGENCY_DIR), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const writeLocalConfig = (body: string) =>
    writeFileSync(join(projectRoot, PATHS.PROJECT_CONFIG), body, 'utf8');

  it('defaults to strict (decision D3)', () => {
    expect(DEFAULT_STAGES_MODE).toBe('strict');
    expect(resolveStagesMode(projectRoot, {})).toBe('strict');
  });

  it('reads off / warn from the local config', () => {
    writeLocalConfig('stages_mode=off\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('off');
    writeLocalConfig('stages_mode=warn\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('warn');
  });

  it('PAQAD_STAGES_MODE env wins over config', () => {
    writeLocalConfig('stages_mode=off\n');
    expect(resolveStagesMode(projectRoot, { PAQAD_STAGES_MODE: 'warn' })).toBe('warn');
  });

  it('an unrecognised value resolves to strict (never silently disables)', () => {
    writeLocalConfig('stages_mode=banana\n');
    expect(resolveStagesMode(projectRoot, {})).toBe('strict');
    expect(resolveStagesMode(projectRoot, { PAQAD_STAGES_MODE: 'nonsense' })).toBe('strict');
  });

  it('is case-insensitive', () => {
    expect(resolveStagesMode(projectRoot, { PAQAD_STAGES_MODE: 'OFF' })).toBe('off');
  });
});
