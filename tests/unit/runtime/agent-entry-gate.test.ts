import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const GATE_SCRIPT = resolve(__dirname, '../../../runtime/hooks/agent-entry-gate.sh');
const RESET_SCRIPT = resolve(__dirname, '../../../runtime/hooks/agent-entry-session-start.sh');

interface RunResult {
  status: number;
  stderr: string;
}

function runGate(projectRoot: string): RunResult {
  try {
    execFileSync('bash', [GATE_SCRIPT], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const err = error as { status: number; stderr: Buffer };
    return { status: err.status, stderr: err.stderr.toString('utf8') };
  }
}

describe('runtime/hooks/agent-entry-gate.sh', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-gate-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
    writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('blocks with exit code 2 when the sentinel is missing', () => {
    const result = runGate(projectRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CLAUDE.md');
    expect(result.stderr).toContain('.paqad/framework-path.txt');
  });

  it('allows the call when the sentinel exists and is fresh', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{"loaded_at":"now"}');
    // Bump sentinel mtime forward so it's strictly newer than the sources.
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), future, future);
    const result = runGate(projectRoot);
    expect(result.status).toBe(0);
  });

  it('blocks again when the entry file is touched after the sentinel was written', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), past, past);
    // CLAUDE.md is newer than the (back-dated) sentinel → block.
    const result = runGate(projectRoot);
    expect(result.status).toBe(2);
  });

  it('blocks when a file under docs/instructions is newer than the sentinel', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), past, past);
    utimesSync(join(projectRoot, 'CLAUDE.md'), past, past);
    utimesSync(join(projectRoot, '.paqad/framework-path.txt'), past, past);
    writeFileSync(join(projectRoot, 'docs/instructions/rules.md'), '# rules');
    const result = runGate(projectRoot);
    expect(result.status).toBe(2);
  });
});

describe('runtime/hooks/agent-entry-session-start.sh', () => {
  it('deletes the sentinel so every session starts ungated', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-gate-'));
    try {
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
      execFileSync('bash', [RESET_SCRIPT], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
        stdio: 'ignore',
      });
      expect(() => {
        execFileSync('test', ['-e', join(projectRoot, '.paqad/.agent-entry-loaded')]);
      }).toThrow();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
