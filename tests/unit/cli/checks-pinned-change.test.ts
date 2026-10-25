import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readChecksReport, readFeatureChecks } from '@/checks/report-store.js';
import { checksRunningMarkerPath, readChecksRunningMarker } from '@/checks/running-marker.js';
import { createChecksCommand } from '@/cli/commands/checks.js';
import { featureDir } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  closeActiveFeature,
  openFeatureChange,
} from '@/feature-evidence/stage-ledger.js';
import { writeSessionControl, readSessionControl } from '@/feature-evidence/session-control.js';
import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';

const events = vi.hoisted(() => ({
  during: null as null | (() => void),
}));

vi.mock('@/checks/run-checks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/checks/run-checks.js')>();
  return {
    ...actual,
    runChecks: async (options: Parameters<typeof actual.runChecks>[0]) => {
      events.during?.();
      return actual.runChecks(options);
    },
  };
});

const SES = 'ses-pinned';

describe('paqad-ai checks run pins its change at start', () => {
  let root: string;
  let priorSeSession: string | undefined;

  beforeEach(() => {
    priorSeSession = process.env.SE_SESSION;
    process.env.SE_SESSION = SES;
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-checks-pin-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    seedGitChangedFiles(root, ['src/app.ts']);
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      'commands:\n  format: node -e process.exitCode=0\n',
    );
  });

  afterEach(() => {
    events.during = null;
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (priorSeSession === undefined) delete process.env.SE_SESSION;
    else process.env.SE_SESSION = priorSeSession;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(): Promise<void> {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await createChecksCommand().parseAsync(['run', '--project-root', root], { from: 'user' });
  }

  function openChange(title: string): string {
    return openFeatureChange(root, SES, { adapter: 'claude-code', title, lane: 'full' });
  }

  it('AC-23: lands the report on the change it started on after that change closed and another opened', async () => {
    const changeA = openChange('change a');
    let changeB: string | null = null;
    events.during = () => {
      closeActiveFeature(root, SES);
      changeB = openChange('change b');
    };

    await run();

    expect(changeB).not.toBeNull();
    expect(readFeatureChecks(root, changeA)?.passed).toBe(true);
    expect(readFeatureChecks(root, changeB!)).toBeNull();
    expect(readChecksReport(root)).toBeNull();
  });

  it('INV-11: holds a running marker bound to its pid, session and change while it runs', async () => {
    const changeA = openChange('change a');
    let seen: ReturnType<typeof readChecksRunningMarker> = null;
    events.during = () => {
      seen = readChecksRunningMarker(root, SES);
    };

    await run();

    expect(seen).toMatchObject({ pid: process.pid, session_id: SES, change: changeA });
    expect(existsSync(checksRunningMarkerPath(root, SES))).toBe(false);
  });

  it('INV-11: clears the running marker even when the run throws', async () => {
    openChange('change a');
    events.during = () => {
      throw new Error('runner crashed');
    };

    await expect(run()).rejects.toThrow('runner crashed');

    expect(existsSync(checksRunningMarkerPath(root, SES))).toBe(false);
  });

  it('FR-10: a pinned change that is no longer this session’s falls back to the last-run report', async () => {
    const foreign = openFeatureChange(root, 'ses-someone-else', {
      adapter: 'claude-code',
      title: 'foreign',
    });
    appendFeatureStageRow(root, 'ses-someone-else', foreign, {
      kind: 'stage_start',
      stage: 'checks',
      event_status: 'started',
      evidence_source: 'live-mark',
    });
    writeSessionControl(root, { ...readSessionControl(root, SES), active: foreign });

    await run();

    expect(readFeatureChecks(root, foreign)).toBeNull();
    expect(readChecksReport(root)?.passed).toBe(true);
  });

  it('FR-10: a pinned change removed while the checks ran falls back to the last-run report', async () => {
    const changeA = openChange('change a');
    events.during = () => {
      closeActiveFeature(root, SES);
      rmSync(join(root, featureDir(changeA)), { recursive: true, force: true });
    };

    await run();

    expect(existsSync(join(root, featureDir(changeA)))).toBe(false);
    expect(readChecksReport(root)?.passed).toBe(true);
  });
});
