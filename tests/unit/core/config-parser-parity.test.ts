// The golden-fixture spine test.
//
// The disabled signal is resolved by THREE independent parsers that must always
// agree — the spine's weakest joint (battle-test finding). This test pins them to
// ONE shared case list:
//   1. TS predicate   — src/core/framework-enabled.ts (isFrameworkDisabledForRoot)
//   2. .mjs primitive — runtime/hooks/lib/paqad-disabled.mjs (isPaqadDisabled)
//   3. .sh kill switch — runtime/hooks/lib/paqad-disabled.sh (paqad_is_disabled)
//
// Cases cover the locked precedence (PAQAD_DISABLED > PAQAD_ENABLE env > .config >
// configs/.config.* merged > default-on, LOCAL WINS) plus the coercion edge cases
// the battle test called out: CRLF, quoted, inline-comment, commented-out, case,
// multi-file collision, and unrelated-falsy-key.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { isFrameworkDisabledForRoot } from '@/core/framework-enabled.js';

const SH = resolve(__dirname, '../../../runtime/hooks/lib/paqad-disabled.sh');
const MJS = resolve(__dirname, '../../../runtime/hooks/lib/paqad-disabled.mjs');
const itPosix = process.platform === 'win32' ? it.skip : it;

interface ParityCase {
  name: string;
  /** `.paqad/.config` (the dev-local layer) body. */
  dotConfig?: string;
  /** `.paqad/configs/<name>` (the team layer) bodies. */
  configs?: Record<string, string>;
  /** Extra env (PAQAD_* escape hatches / hard switch). */
  env?: Record<string, string>;
  expectedDisabled: boolean;
}

const CASES: ParityCase[] = [
  { name: 'default ON when nothing is set', expectedDisabled: false },
  {
    name: '.config paqad_enable=false ⇒ off',
    dotConfig: 'paqad_enable=false\n',
    expectedDisabled: true,
  },
  {
    name: '.config paqad_enable=true ⇒ on',
    dotConfig: 'paqad_enable=true\n',
    expectedDisabled: false,
  },
  {
    name: 'team configs/ paqad_enable=false ⇒ off',
    configs: { '.config.app': 'paqad_enable=false\n' },
    expectedDisabled: true,
  },
  {
    name: 'LOCAL WINS: local true over team false ⇒ on',
    configs: { '.config.app': 'paqad_enable=false\n' },
    dotConfig: 'paqad_enable=true\n',
    expectedDisabled: false,
  },
  {
    name: 'LOCAL WINS: local false over team true ⇒ off',
    configs: { '.config.app': 'paqad_enable=true\n' },
    dotConfig: 'paqad_enable=false\n',
    expectedDisabled: true,
  },
  {
    name: 'PAQAD_DISABLED hard switch overrides an enabled .config ⇒ off',
    dotConfig: 'paqad_enable=true\n',
    env: { PAQAD_DISABLED: '1' },
    expectedDisabled: true,
  },
  {
    name: 'PAQAD_DISABLED=TRUE (case-insensitive) ⇒ off',
    env: { PAQAD_DISABLED: 'TRUE' },
    expectedDisabled: true,
  },
  {
    name: 'PAQAD_ENABLE=false env over a local-true ⇒ off',
    dotConfig: 'paqad_enable=true\n',
    env: { PAQAD_ENABLE: 'false' },
    expectedDisabled: true,
  },
  {
    name: 'PAQAD_ENABLE=true env over a local-false ⇒ on',
    dotConfig: 'paqad_enable=false\n',
    env: { PAQAD_ENABLE: 'true' },
    expectedDisabled: false,
  },
  {
    name: 'CRLF (Windows-authored) paqad_enable=false ⇒ off',
    dotConfig: 'paqad_enable=false\r\n',
    expectedDisabled: true,
  },
  {
    name: 'quoted value "false" ⇒ off',
    dotConfig: 'paqad_enable="false"\n',
    expectedDisabled: true,
  },
  {
    name: 'inline comment stripped ⇒ off',
    dotConfig: 'paqad_enable=false # turned off for the A/B arm\n',
    expectedDisabled: true,
  },
  {
    name: 'commented-out assignment ignored ⇒ on',
    dotConfig: '# paqad_enable=false\n',
    expectedDisabled: false,
  },
  {
    name: 'multi-file collision: last filename (.config.zzz) wins ⇒ off',
    configs: { '.config.app': 'paqad_enable=true\n', '.config.zzz': 'paqad_enable=false\n' },
    expectedDisabled: true,
  },
  {
    name: 'case-insensitive token OFF ⇒ off',
    dotConfig: 'paqad_enable=OFF\n',
    expectedDisabled: true,
  },
  {
    name: 'unrecognised value ⇒ on (not disabled)',
    dotConfig: 'paqad_enable=banana\n',
    expectedDisabled: false,
  },
  {
    name: 'an unrelated falsy key never trips the switch ⇒ on',
    dotConfig: 'enterprise=false\n',
    expectedDisabled: false,
  },
];

function setupRoot(testCase: ParityCase): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-parity-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  if (testCase.dotConfig !== undefined) {
    writeFileSync(join(root, '.paqad', '.config'), testCase.dotConfig);
  }
  if (testCase.configs) {
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    for (const [name, body] of Object.entries(testCase.configs)) {
      writeFileSync(join(root, '.paqad', 'configs', name), body);
    }
  }
  return root;
}

/** A clean env with ambient PAQAD_* stripped, plus the case's overrides — so all
 *  three parsers see exactly the same inputs the TS path is given explicitly. */
function caseEnv(testCase: ParityCase): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('PAQAD_') && v !== undefined) {
      base[k] = v;
    }
  }
  return { ...base, ...(testCase.env ?? {}) };
}

function shDisabled(root: string, env: Record<string, string>): boolean {
  const out = execFileSync(
    'bash',
    ['-c', `. "${SH}"; if paqad_is_disabled; then echo disabled; else echo enabled; fi`],
    { env: { ...env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' },
  );
  return out.trim() === 'disabled';
}

async function mjsDisabled(root: string, env: Record<string, string>): Promise<boolean> {
  const script =
    `import { isPaqadDisabled } from ${JSON.stringify(pathToFileURL(MJS).href)};` +
    `process.stdout.write(String(isPaqadDisabled(${JSON.stringify(root)})));`;
  const { stdout } = await execa('node', ['--input-type=module', '-e', script], {
    env,
    extendEnv: false,
    reject: false,
  });
  return stdout.trim() === 'true';
}

describe('config disabled-signal parity (TS / .mjs / .sh agree on every case)', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  describe.each(CASES)('$name', (testCase) => {
    it(`TS predicate ⇒ disabled=${testCase.expectedDisabled}`, () => {
      root = setupRoot(testCase);
      expect(isFrameworkDisabledForRoot(root, caseEnv(testCase))).toBe(testCase.expectedDisabled);
    });

    it(`.mjs primitive ⇒ disabled=${testCase.expectedDisabled}`, async () => {
      root = setupRoot(testCase);
      expect(await mjsDisabled(root, caseEnv(testCase))).toBe(testCase.expectedDisabled);
    });

    itPosix(`.sh kill switch ⇒ disabled=${testCase.expectedDisabled}`, () => {
      root = setupRoot(testCase);
      expect(shDisabled(root, caseEnv(testCase))).toBe(testCase.expectedDisabled);
    });
  });
});
