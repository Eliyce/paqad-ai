import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthChecker } from '@/health/checker.js';
import * as ts from '@/health/hud-attachment.js';
import { readHudAttachment } from '@/health/hud-attachment.js';
import * as mjs from '../../../runtime/hooks/lib/hud-heartbeat.mjs';
import { CLOUD_HUD_LINE as MOD_CLOUD_LINE } from '../../../runtime/claude-plugin/mod/commands.ts';

const NOW = Date.parse('2026-11-16T12:00:00.000Z');
let root: string;

function touch(name: string, at: number, body = '{}'): void {
  const dir = join(root, '.paqad/session/hud');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
  utimesSync(join(dir, name), new Date(at), new Date(at));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-hud-doctor-'));
  vi.stubEnv('CLAUDE_CODE_REMOTE', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function hudCheck() {
  const report = await new HealthChecker({ managedSettingsPaths: [], now: () => NOW }).run(root);
  return report.checks.find((check) => check.name === 'Claude Code HUD');
}

describe('the doctor reports a missing HUD (W5)', () => {
  it('AC-29: warns with the session note and the one fix when the latest session has a fresh snapshot and no heartbeat', async () => {
    touch('ses-a.json', NOW - 60_000);
    const check = await hudCheck();
    expect(check).toMatchObject({
      status: 'warning',
      detail: mjs.HUD_NOT_ATTACHED_NOTE,
      remediation: mjs.HUD_NOT_ATTACHED_FIX,
    });
  });

  it('AC-29: warns on an unattached record the prompt gate wrote, in its words', async () => {
    touch('ses-a.json', NOW - 3 * 60 * 60_000);
    touch(
      'ses-a.unattached',
      NOW - 3 * 60 * 60_000,
      JSON.stringify({ note: mjs.HUD_NOT_ATTACHED_NOTE, fix: mjs.HUD_NOT_ATTACHED_FIX }),
    );
    expect((await hudCheck())?.status).toBe('warning');
  });

  it('AC-29: passes when the HUD beat for the latest session, and with no session in the last day', async () => {
    touch('ses-a.json', NOW - 60_000);
    touch('ses-a.live', NOW - 30_000);
    expect((await hudCheck())?.status).toBe('pass');
    rmSync(join(root, '.paqad'), { recursive: true, force: true });
    touch('ses-old.json', NOW - 2 * 24 * 60 * 60_000);
    expect(readHudAttachment(root, {}, NOW)).toEqual({ state: 'no-session' });
  });

  it('AC-8: in a cloud session the doctor prints the cloud line as information', async () => {
    vi.stubEnv('CLAUDE_CODE_REMOTE', 'true');
    expect(await hudCheck()).toMatchObject({ status: 'info', detail: mjs.CLOUD_HUD_LINE });
  });

  it('AC-8, AC-29: the prompt gate, the doctor and the mod share one wording and one set of windows', () => {
    expect(ts.CLOUD_HUD_LINE).toBe(mjs.CLOUD_HUD_LINE);
    expect(MOD_CLOUD_LINE).toBe(mjs.CLOUD_HUD_LINE);
    expect(ts.HUD_NOT_ATTACHED_NOTE).toBe(mjs.HUD_NOT_ATTACHED_NOTE);
    expect(ts.HUD_NOT_ATTACHED_FIX).toBe(mjs.HUD_NOT_ATTACHED_FIX);
    expect(ts.HEARTBEAT_WINDOW_MS).toBe(mjs.HEARTBEAT_WINDOW_MS);
    expect(ts.SNAPSHOT_FRESH_MS).toBe(mjs.SNAPSHOT_FRESH_MS);
  });
});
