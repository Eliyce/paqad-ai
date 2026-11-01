import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-team-gitignore-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function managedLines(type: 'claude-code' | 'codex-cli' | 'gemini-cli', dir: string) {
  const files = await AdapterFactory.create(type).generateConfig({
    frameworkPath: '.paqad/framework-path.txt',
    rulesPath: 'docs/instructions/rules',
    projectRoot: root,
  });
  const content = files.find((file) => file.path === `${dir}/.gitignore`)!.content;
  return content.split('\n').filter((line) => line !== '' && !line.startsWith('#'));
}

function optOut(): void {
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'configs', '.config.app'), 'team_bootstrap_enabled=false\n');
}

describe('AC-19: the managed block in .claude/.gitignore', () => {
  it('lists settings.hooks.json and settings.local.json and leaves settings.json shared', async () => {
    expect(await managedLines('claude-code', '.claude')).toEqual([
      'settings.hooks.json',
      'settings.local.json',
    ]);
  });

  it('with the team setup off, keeps an untracked settings.json ignored', async () => {
    optOut();
    expect(await managedLines('claude-code', '.claude')).toEqual([
      'settings.hooks.json',
      'settings.json',
      'settings.local.json',
    ]);
  });

  it('with the team setup off, never ignores a settings.json the team already tracks', async () => {
    optOut();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), '{}\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-f', '.claude/settings.json'], { cwd: root });
    expect(await managedLines('claude-code', '.claude')).not.toContain('settings.json');
  });

  it("leaves the other adapters' host gitignore files as they were", async () => {
    expect(await managedLines('codex-cli', '.codex')).toEqual([
      'hooks.json',
      'settings.hooks.json',
    ]);
    expect(await managedLines('gemini-cli', '.gemini')).toEqual([
      'settings.hooks.json',
      'settings.json',
    ]);
  });
});
