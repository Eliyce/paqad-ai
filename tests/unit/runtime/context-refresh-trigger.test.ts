import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TRIGGER = resolve(__dirname, '../../../runtime/hooks/context-refresh-trigger.mjs');
const MARKER_REL = '.paqad/locks/rule-context.marker';

function run(projectRoot: string, env: NodeJS.ProcessEnv = {}): number {
  try {
    execFileSync('node', [TRIGGER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    return (error as { status: number }).status ?? 1;
  }
}

describe('runtime/hooks/context-refresh-trigger.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-trigger-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('exits 0 and stamps the debounce marker when rag is on', () => {
    expect(run(projectRoot, { PAQAD_RAG_ENABLED: 'true' })).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(true);
  });

  // Issue #284 — lean rule loading is on by default, so the trigger now fires (to
  // refresh the rule slice) even with rag off, unless BOTH are turned off.
  it('fires by default (lean on) even when rag is off', () => {
    expect(run(projectRoot)).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(true);
  });

  it('is a no-op (no marker) only when both lean_rules and rag are off', () => {
    expect(run(projectRoot, { PAQAD_LEAN_RULES: 'false', PAQAD_RAG_ENABLED: 'false' })).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(false);
  });

  it('is a no-op (no marker) when paqad is disabled', () => {
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    expect(run(projectRoot, { PAQAD_RAG_ENABLED: 'true' })).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(false);
  });

  it('never errors and stays silent (stdout empty)', () => {
    const out = execFileSync('node', [TRIGGER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, PAQAD_RAG_ENABLED: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');
    expect(out).toBe('');
  });

  // Issue #582 — the prompt gate passes the session id; the trigger forwards it as --session so
  // the worker reads that session's route. A stub `paqad-ai` on PATH records the argv it got.
  it.skipIf(process.platform === 'win32')(
    'forwards the session id to refresh-context as --session',
    async () => {
      const bin = join(projectRoot, 'bin');
      const argsFile = join(projectRoot, 'args.txt');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'paqad-ai'), `#!/bin/sh\nprintf '%s ' "$@" > '${argsFile}'\n`);
      chmodSync(join(bin, 'paqad-ai'), 0o755);
      execFileSync('node', [TRIGGER, 'ses-582'], {
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectRoot,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await vi.waitFor(() => expect(existsSync(argsFile)).toBe(true), { timeout: 5000 });
      await vi.waitFor(
        () => expect(readFileSync(argsFile, 'utf8')).toContain('--session ses-582'),
        {
          timeout: 5000,
        },
      );
    },
  );
});
