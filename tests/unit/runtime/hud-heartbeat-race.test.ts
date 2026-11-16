import * as realFs from 'node:fs';
import { mkdtempSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const race = vi.hoisted(() => ({ enabled: false, code: 'EEXIST' as string }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const writeFileSync = ((path: realFs.PathOrFileDescriptor, data: unknown, options?: unknown) => {
    const flag =
      typeof options === 'object' && options !== null
        ? (options as { flag?: string }).flag
        : undefined;
    if (race.enabled && flag === 'wx') {
      if (race.code === 'EEXIST') {
        actual.writeFileSync(path, 'written by the other hook\n', 'utf8');
      } else {
        throw Object.assign(new Error('denied'), { code: race.code });
      }
    }
    return actual.writeFileSync(path, data as string, options as realFs.WriteFileOptions);
  }) as typeof actual.writeFileSync;
  return { ...actual, default: { ...actual, writeFileSync }, writeFileSync };
});

const { CLOUD_HUD_LINE, HUD_NOT_ATTACHED_NOTE, cloudHudLine, recordHudAttachment, unattachedPath } =
  await import('../../../runtime/hooks/lib/hud-heartbeat.mjs');
const { removeTempProject } = await import('./temp-project.js');

const NOW = Date.parse('2026-10-18T09:00:00.000Z');
const S = 'ses-race';
const LOCAL = { CLAUDE_CODE_REMOTE: '' } as NodeJS.ProcessEnv;
const CLOUD = { CLAUDE_CODE_REMOTE: 'true' } as NodeJS.ProcessEnv;
let root: string;

function freshSnapshot(): void {
  const path = join(root, '.paqad/session/hud', `${S}.json`);
  realFs.mkdirSync(join(path, '..'), { recursive: true });
  realFs.writeFileSync(path, JSON.stringify({ scope: { qualified: false } }));
  utimesSync(path, new Date(NOW - 1_000), new Date(NOW - 1_000));
}

function hooksLog(): string {
  const path = join(root, '.paqad/logs/hooks.log');
  return realFs.existsSync(path) ? readFileSync(path, 'utf8') : '';
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-heartbeat-race-'));
  race.enabled = false;
  race.code = 'EEXIST';
});
afterEach(() => {
  race.enabled = false;
  removeTempProject(root);
});

describe('AC-28: the HUD notes are written in one step', () => {
  it('AC-28: says the not-attached line exactly once over repeated prompts', () => {
    freshSnapshot();
    const lines = [0, 1, 2].map((i) => recordHudAttachment(root, S, { env: LOCAL, now: NOW + i }));
    expect(lines.filter((line) => line.includes(HUD_NOT_ATTACHED_NOTE))).toHaveLength(1);
    expect(hooksLog().split(HUD_NOT_ATTACHED_NOTE)).toHaveLength(2);
  });

  it('AC-28: another hook that writes the record first wins, and this one says and logs nothing', () => {
    freshSnapshot();
    race.enabled = true;
    expect(recordHudAttachment(root, S, { env: LOCAL, now: NOW })).toBe('');
    expect(readFileSync(unattachedPath(root, S), 'utf8')).toBe('written by the other hook\n');
    expect(hooksLog()).toBe('');
  });

  it('AC-8: another hook that notes the cloud line first wins, and this one says nothing', () => {
    race.enabled = true;
    expect(cloudHudLine(root, S, CLOUD, NOW)).toBe('');
    race.enabled = false;
    expect(cloudHudLine(root, S, CLOUD, NOW)).toBe('');
  });

  it('AC-8: the cloud line is said once without a race', () => {
    expect(cloudHudLine(root, S, CLOUD, NOW)).toBe(`[paqad] ${CLOUD_HUD_LINE}\n`);
    expect(cloudHudLine(root, S, CLOUD, NOW)).toBe('');
  });

  it('AC-28: any other write error goes to the hook failure log and says nothing', () => {
    freshSnapshot();
    race.enabled = true;
    race.code = 'EACCES';
    expect(recordHudAttachment(root, S, { env: LOCAL, now: NOW })).toBe('');
    expect(realFs.existsSync(unattachedPath(root, S))).toBe(false);
    expect(hooksLog()).not.toContain(HUD_NOT_ATTACHED_NOTE);
  });
});
