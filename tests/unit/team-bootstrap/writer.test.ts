import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TEAM_LAUNCHER_PATH,
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

const STAMPED = '#!/usr/bin/env node\nexport const LAUNCHER_REVISION = 2;\n';

function writeLauncher(text: string): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(launcherPath(), text);
}

describe('FR-36, FR-38: team setup no longer writes the launcher', () => {
  it('AC-1: a sync writes no .paqad/hook.mjs', () => {
    const report = syncTeamSetup(root, {});
    expect(report.written).not.toContain(TEAM_LAUNCHER_PATH);
    expect(existsSync(launcherPath())).toBe(false);
  });

  it('AC-21: an update removes a launcher that carries the paqad stamp, and a second run is silent', () => {
    writeLauncher(STAMPED);
    const report = syncTeamSetup(root, {}, { removeLauncher: true });
    expect(report.removed).toEqual([TEAM_LAUNCHER_PATH]);
    expect(existsSync(launcherPath())).toBe(false);
    const again = syncTeamSetup(root, {}, { removeLauncher: true });
    expect(again.removed).toEqual([]);
    expect(teamSetupNotes(root, again)).toEqual([]);
  });

  it('AC-21: any launcher revision and CRLF line ends count as paqad files', () => {
    writeLauncher(STAMPED.replace('= 2;', '= 999;').replace(/\n/gu, '\r\n'));
    expect(syncTeamSetup(root, {}, { removeLauncher: true }).removed).toEqual([TEAM_LAUNCHER_PATH]);
  });

  it('FR-38: a .paqad/hook.mjs without the stamp is kept and named', () => {
    writeLauncher('hand written\n');
    const report = syncTeamSetup(root, {}, { removeLauncher: true });
    expect(report.removed).toEqual([]);
    expect(report.kept).toContain(TEAM_LAUNCHER_PATH);
    expect(readFileSync(launcherPath(), 'utf8')).toBe('hand written\n');
    expect(teamSetupNotes(root, report)).toContain(
      'Left alone because they were edited by hand or written by a newer paqad: .paqad/hook.mjs.',
    );
  });

  it('AC-48: the launcher removal does not run under CI', () => {
    writeLauncher(STAMPED);
    expect(syncTeamSetup(root, { CI: 'true' }, { removeLauncher: true }).removed).toEqual([]);
    expect(existsSync(launcherPath())).toBe(true);
  });

  it('INV-13: the silent update and session start, which pass no removal flag, leave the launcher', () => {
    writeLauncher(STAMPED);
    expect(syncTeamSetup(root, {}).removed).toEqual([]);
    expect(existsSync(launcherPath())).toBe(true);
  });

  it('the opt-out removes the launcher on update too', () => {
    optOut();
    writeLauncher(STAMPED);
    const report = syncTeamSetup(root, {}, { removeLauncher: true });
    expect(report.enabled).toBe(false);
    expect(report.removed).toEqual([TEAM_LAUNCHER_PATH]);
  });
});

describe('what the lead is told', () => {
  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  }

  it('names the team files still to commit in a git repo', () => {
    git('init', '-q');
    const { notes } = new ClaudeCodeAdapter().syncTeamSetup(root, {});
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(
      /^Commit these team setup files together so teammates and cloud sessions get paqad: /,
    );
    expect(notes[0]).not.toContain(TEAM_LAUNCHER_PATH);
    expect(notes[0]).not.toContain('.claude/agents/paqad-development.md');
    expect(notes[0]).toContain('.claude/agents/.gitignore');
    expect(notes[1]).toBe(
      `For Claude Code cloud sessions, add these environment setup commands: npm i -g paqad-ai@${VERSION} && paqad-ai install && paqad-ai join --no-rag --non-interactive`,
    );
    git('add', '-f', '.claude/agents/.gitignore');
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
    expect(report.written).not.toContain(TEAM_LAUNCHER_PATH);
    expect(report.written).toHaveLength(13);
  });

  it('says nothing to commit when the team setup is off and names files it kept', () => {
    optOut();
    writeFileSync(launcherPath(), 'mine\n');
    const report = syncTeamSetup(root, {}, { removeLauncher: true });
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
    expect(existsSync(launcherPath())).toBe(false);
    expect(teamSetupMissing(root)).toBe(false);
    writeFileSync(join(root, '.claude', 'settings.json'), '{ broken');
    expect(teamSetupMissing(root)).toBe(true);
    writeFileSync(join(root, '.claude', 'settings.json'), '{"hooks":{}}');
    expect(teamSetupMissing(root)).toBe(true);
  });
});
