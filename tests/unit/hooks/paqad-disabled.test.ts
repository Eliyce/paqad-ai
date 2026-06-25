import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SH = resolve(__dirname, '../../../runtime/hooks/lib/paqad-disabled.sh');
const MJS = resolve(__dirname, '../../../runtime/hooks/lib/paqad-disabled.mjs');

const itPosix = process.platform === 'win32' ? it.skip : it;

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-disabled-prim-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

function writeConfig(root: string, body: string): void {
  writeFileSync(join(root, '.paqad', '.config'), body);
}

/** Source the shell primitive and report whether it considers paqad disabled. */
function shDisabled(root: string, extraEnv: Record<string, string> = {}): boolean {
  const out = execFileSync(
    'bash',
    ['-c', `. "${SH}"; if paqad_is_disabled; then echo disabled; else echo enabled; fi`],
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...extraEnv }, encoding: 'utf8' },
  );
  return out.trim() === 'disabled';
}

/** Import the .mjs primitive in a child node and report its verdict. */
async function mjsDisabled(root: string, extraEnv: Record<string, string> = {}): Promise<boolean> {
  const script =
    `import { isPaqadDisabled } from ${JSON.stringify(pathToFileURL(MJS).href)};` +
    `process.stdout.write(String(isPaqadDisabled(${JSON.stringify(root)})));`;
  const { stdout } = await execa('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, ...extraEnv },
    reject: false,
  });
  return stdout.trim() === 'true';
}

describe('paqad-disabled primitives (.sh + .mjs agree)', () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('.mjs: default ON when no .config and no env', async () => {
    expect(await mjsDisabled(root)).toBe(false);
  });

  it('.mjs: OFF when PAQAD_ENABLED=false in .config', async () => {
    writeConfig(root, 'PAQAD_ENABLED=false\n');
    expect(await mjsDisabled(root)).toBe(true);
  });

  it('.mjs: does not trip on a different falsy key (ENTERPRISE_ENABLED=false)', async () => {
    writeConfig(root, 'ENTERPRISE_ENABLED=false\n');
    expect(await mjsDisabled(root)).toBe(false);
  });

  it('.mjs: env override wins over an enabled .config', async () => {
    writeConfig(root, 'PAQAD_ENABLED=true\n');
    expect(await mjsDisabled(root, { PAQAD_DISABLED: '1' })).toBe(true);
  });

  itPosix('.sh: default ON when no .config and no env', () => {
    expect(shDisabled(root)).toBe(false);
  });

  itPosix('.sh: OFF when PAQAD_ENABLED=false in .config', () => {
    writeConfig(root, 'PAQAD_ENABLED=false\n');
    expect(shDisabled(root)).toBe(true);
  });

  itPosix('.sh: does not trip on a different falsy key (ENTERPRISE_ENABLED=false)', () => {
    writeConfig(root, 'ENTERPRISE_ENABLED=false\n');
    expect(shDisabled(root)).toBe(false);
  });

  itPosix('.sh: env override wins over an enabled .config', () => {
    writeConfig(root, 'PAQAD_ENABLED=true\n');
    expect(shDisabled(root, { PAQAD_DISABLED: 'yes' })).toBe(true);
  });
});
