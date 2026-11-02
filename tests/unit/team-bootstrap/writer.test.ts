import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TEAM_LAUNCHER_PATH,
  renderTeamLauncher,
  syncTeamSetup,
  teamFilesToCommit,
  teamSetupMissing,
  teamSetupNotes,
} from '@/adapters/claude/team-setup.js';
import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { VERSION } from '@/index.js';

import { writeTeamSetup } from './helpers';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-team-writer-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const launcherPath = () => join(root, TEAM_LAUNCHER_PATH);

function optOut(): void {
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'configs', '.config.app'), 'team_bootstrap_enabled=false\n');
}

describe('the launcher file', () => {
  it('renders the shipped template with this version stamped in', () => {
    const rendered = renderTeamLauncher();
    expect(rendered.length).toBeGreaterThan(1000);
    expect(rendered).toContain(`export const PAQAD_LAUNCHER_VERSION = '${VERSION}';`);
    expect(rendered).not.toContain('__PAQAD_VERSION__');
    expect(rendered.startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('is written on the first sync and byte-identical on the next', () => {
    const first = syncTeamSetup(root, {});
    expect(first.written).toContain(TEAM_LAUNCHER_PATH);
    const bytes = readFileSync(launcherPath(), 'utf8');
    expect(bytes).toBe(renderTeamLauncher());
    const second = syncTeamSetup(root, {});
    expect(second.written).toEqual([]);
    expect(readFileSync(launcherPath(), 'utf8')).toBe(bytes);
  });

  it('refreshes a stale or edited launcher from the same or an older version', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(launcherPath(), renderTeamLauncher('0.0.1'));
    expect(syncTeamSetup(root, {}).written).toContain(TEAM_LAUNCHER_PATH);
    writeFileSync(launcherPath(), `${renderTeamLauncher()}// edited\n`);
    expect(syncTeamSetup(root, {}).written).toContain(TEAM_LAUNCHER_PATH);
    expect(readFileSync(launcherPath(), 'utf8')).toBe(renderTeamLauncher());
  });

  it('AC-23: an older paqad leaves a launcher written by a newer one alone', () => {
    const newer = renderTeamLauncher('999.0.0');
    writeFileSync(launcherPath(), newer);
    const report = syncTeamSetup(root, {}, '1.0.0');
    expect(report.kept).toEqual([TEAM_LAUNCHER_PATH]);
    expect(readFileSync(launcherPath(), 'utf8')).toBe(newer);
  });

  it('the opt-out removes an unchanged launcher and keeps an edited one', () => {
    syncTeamSetup(root, {});
    optOut();
    expect(syncTeamSetup(root, {}).removed).toContain(TEAM_LAUNCHER_PATH);
    expect(existsSync(launcherPath())).toBe(false);
    expect(syncTeamSetup(root, {}).removed).toEqual([]);

    writeFileSync(launcherPath(), 'hand written\n');
    const report = syncTeamSetup(root, {});
    expect(report.kept).toEqual([TEAM_LAUNCHER_PATH]);
    expect(report.removed).toEqual([]);
    expect(readFileSync(launcherPath(), 'utf8')).toBe('hand written\n');
  });

  it('the env switch turns the writer off', () => {
    const report = syncTeamSetup(root, { PAQAD_TEAM_BOOTSTRAP_ENABLED: 'false' });
    expect(report.enabled).toBe(false);
    expect(existsSync(launcherPath())).toBe(false);
  });
});

describe('what the lead is told', () => {
  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  }

  it('names the team files still to commit in a git repo', () => {
    git('init', '-q');
    const { notes } = new ClaudeCodeAdapter().syncTeamSetup(root, {});
    expect(notes).toEqual([
      'Commit these team setup files together so teammates and cloud sessions get paqad: .paqad/hook.mjs.',
    ]);
    git('add', '-f', TEAM_LAUNCHER_PATH);
    git(
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'team',
    );
    expect(new ClaudeCodeAdapter().syncTeamSetup(root, {}).notes).toEqual([]);
  });

  it('outside git it lists what it wrote', () => {
    const report = syncTeamSetup(root, {});
    expect(teamFilesToCommit(root, report)).toEqual([...report.written].sort());
    expect(report.written).toContain(TEAM_LAUNCHER_PATH);
    expect(report.written).toHaveLength(1);
  });

  it('says nothing to commit when the team setup is off and names files it kept', () => {
    optOut();
    writeFileSync(launcherPath(), 'mine\n');
    const report = syncTeamSetup(root, {});
    expect(teamFilesToCommit(root, report)).toEqual([]);
    expect(teamSetupNotes(root, report)).toEqual([
      'Left alone because they were edited by hand or written by a newer paqad: .paqad/hook.mjs.',
    ]);
  });

  it('knows when the team setup is missing', async () => {
    expect(teamSetupMissing(root)).toBe(true);
    syncTeamSetup(root, {});
    expect(teamSetupMissing(root)).toBe(true);
    await writeTeamSetup(root);
    expect(teamSetupMissing(root)).toBe(false);
    writeFileSync(join(root, '.claude', 'settings.json'), '{ broken');
    expect(teamSetupMissing(root)).toBe(true);
    writeFileSync(join(root, '.claude', 'settings.json'), '{"hooks":{}}');
    expect(teamSetupMissing(root)).toBe(true);
  });
});
