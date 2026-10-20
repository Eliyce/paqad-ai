import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isSafeSessionId,
  readStageSetting,
  stageSettingsPath,
  writeStageSettings,
} from '@/stage-isolation/stage-settings.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stage-settings-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function writeRaw(root: string, session: string, body: string): void {
  const path = stageSettingsPath(root, session);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

describe('stage settings file', () => {
  it('writes the resolved settings per session and reads one stage back', () => {
    const root = tempRoot();
    const settings = writeStageSettings(root, 'ses_a', { PAQAD_STAGE_EFFORT_CHECKS: 'medium' });
    expect(settings.checks).toEqual({ effort: 'medium', model: 'inherit' });
    expect(JSON.parse(readFileSync(stageSettingsPath(root, 'ses_a'), 'utf8'))).toEqual(settings);
    expect(readStageSetting(root, 'ses_a', 'checks')).toEqual({
      effort: 'medium',
      model: 'inherit',
    });
    expect(readStageSetting(root, 'ses_b', 'checks')).toBeNull();
  });

  it('throws on an unsafe session id and reads nothing for one', () => {
    const root = tempRoot();
    expect(() => writeStageSettings(root, '../escape', {})).toThrow(/unsafe session id/);
    expect(readStageSetting(root, '../escape', 'checks')).toBeNull();
    expect(isSafeSessionId('ses_a')).toBe(true);
  });

  it('ignores a damaged file or a stage entry with unknown values', () => {
    const root = tempRoot();
    writeRaw(root, 'ses_bad', 'not json');
    expect(readStageSetting(root, 'ses_bad', 'checks')).toBeNull();
    writeRaw(root, 'ses_null', 'null');
    expect(readStageSetting(root, 'ses_null', 'checks')).toBeNull();
    writeRaw(
      root,
      'ses_odd',
      JSON.stringify({ checks: { effort: 'turbo', model: 'inherit' }, review: 'high' }),
    );
    expect(readStageSetting(root, 'ses_odd', 'checks')).toBeNull();
    expect(readStageSetting(root, 'ses_odd', 'review')).toBeNull();
    expect(readStageSetting(root, 'ses_odd', 'planning')).toBeNull();
  });
});
