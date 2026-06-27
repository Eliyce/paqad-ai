import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const INJECT_HOOK = resolve(__dirname, '../../../runtime/hooks/context-seam-inject.mjs');
const PROMPT_GATE = resolve(__dirname, '../../../runtime/hooks/agent-entry-prompt-gate.sh');
const ARTIFACT_REL = '.paqad/context/session-context.md';

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  projectRoot: string,
  env: NodeJS.ProcessEnv = {},
): RunResult {
  try {
    const stdout = execFileSync(cmd, args, {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer; stderr: Buffer };
    return {
      status: err.status,
      stdout: err.stdout?.toString('utf8') ?? '',
      stderr: err.stderr?.toString('utf8') ?? '',
    };
  }
}

const runHook = (projectRoot: string, env?: NodeJS.ProcessEnv) =>
  run('node', [INJECT_HOOK], projectRoot, env);
const runGate = (projectRoot: string, env?: NodeJS.ProcessEnv) =>
  run('bash', [PROMPT_GATE], projectRoot, env);

describe('runtime/hooks/context-seam-inject.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-seam-hook-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeArtifact(body: string): void {
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    writeFileSync(join(projectRoot, ARTIFACT_REL), body);
  }

  it('emits the [paqad-context] block when the artifact exists', () => {
    writeArtifact('## context\n- a fact');
    const result = runHook(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[paqad-context]');
    expect(result.stdout).toContain('- a fact');
    expect(result.stdout).toContain('[/paqad-context]');
  });

  it('emits nothing when the artifact is absent', () => {
    const result = runHook(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('emits nothing (no-op) when paqad is disabled', () => {
    writeArtifact('## context\n- a fact');
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    const result = runHook(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('honours the PAQAD_CONTEXT_ARTIFACT override', () => {
    const custom = join(projectRoot, 'custom-ctx.md');
    writeFileSync(custom, 'override body');
    const result = runHook(projectRoot, { PAQAD_CONTEXT_ARTIFACT: custom });
    expect(result.stdout).toContain('override body');
  });
});

describe('agent-entry-prompt-gate.sh injects context (wiring)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-seam-gate-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
    writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('emits the context block ahead of the load reminder (sentinel missing)', () => {
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    writeFileSync(join(projectRoot, ARTIFACT_REL), '- injected slice');
    const result = runGate(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[paqad-context]');
    expect(result.stdout).toContain('- injected slice');
    // The seam block precedes the framework-load reminder.
    expect(result.stdout.indexOf('[paqad-context]')).toBeLessThan(result.stdout.indexOf('[paqad]'));
  });

  it('stays a pure no-op when paqad is disabled (no context, no reminder)', () => {
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    writeFileSync(join(projectRoot, ARTIFACT_REL), '- injected slice');
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    const result = runGate(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
