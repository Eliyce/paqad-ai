import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const wrapperDir = resolve(__dirname, '../../../runtime/claude-plugin/bin');

let root: string;
let launcher: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-cli-wrapper-'));
  const bin = join(root, 'runtime', 'claude-plugin', 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, 'dist', 'cli'), { recursive: true });
  writeFileSync(
    join(root, 'dist', 'cli', 'index.js'),
    'process.stdout.write(String(process.env.CLAUDE_PLUGIN_DATA));\n',
    'utf8',
  );
  launcher = join(bin, 'paqad-ai');
  copyFileSync(join(wrapperDir, 'paqad-ai'), launcher);
  chmodSync(launcher, 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(env: Record<string, string>): string {
  const base: Record<string, string> = { PATH: process.env.PATH ?? '' };
  return execFileSync('/bin/sh', [launcher], { env: { ...base, ...env }, encoding: 'utf8' });
}

describe.skipIf(process.platform === 'win32')('plugin CLI wrapper', () => {
  it('sets the plugin data folder under the home .claude folder when unset', () => {
    expect(run({ HOME: '/home/someone' })).toBe('/home/someone/.claude/plugins/data/paqad-eliyce');
  });

  it('uses CLAUDE_CONFIG_DIR when it is set', () => {
    expect(run({ HOME: '/home/someone', CLAUDE_CONFIG_DIR: '/cfg' })).toBe(
      '/cfg/plugins/data/paqad-eliyce',
    );
  });

  it('keeps a preset value', () => {
    expect(run({ HOME: '/home/someone', CLAUDE_PLUGIN_DATA: '/preset/data' })).toBe('/preset/data');
  });
});

describe('Windows plugin CLI wrapper', () => {
  it('sets the same default from CLAUDE_CONFIG_DIR or USERPROFILE before running node', () => {
    const text = readFileSync(join(wrapperDir, 'paqad-ai.cmd'), 'utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    expect(lines[0]).toContain('if not defined CLAUDE_PLUGIN_DATA if defined CLAUDE_CONFIG_DIR');
    expect(lines[0]).toContain('%CLAUDE_CONFIG_DIR%\\plugins\\data\\paqad-eliyce');
    expect(lines[1]).toContain('%USERPROFILE%\\.claude\\plugins\\data\\paqad-eliyce');
    expect(lines[2]).toMatch(/^@node /);
  });
});
