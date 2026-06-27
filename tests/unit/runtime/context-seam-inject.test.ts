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

// F3: the injection accelerator is OFF by default, so emission tests must turn
// rag on explicitly. Tests that exercise the OFF path leave it unset.
const RAG_ON: NodeJS.ProcessEnv = { PAQAD_RAG_ENABLED: 'true' };

const runHook = (projectRoot: string, env: NodeJS.ProcessEnv = {}) =>
  run('node', [INJECT_HOOK], projectRoot, env);
const runGate = (projectRoot: string, env: NodeJS.ProcessEnv = {}) =>
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

  it('emits the [paqad-context] block when the artifact exists (rag on)', () => {
    writeArtifact('## context\n- a fact');
    const result = runHook(projectRoot, RAG_ON);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[paqad-context]');
    expect(result.stdout).toContain('- a fact');
    expect(result.stdout).toContain('[/paqad-context]');
  });

  it('emits nothing when the artifact is absent (rag on)', () => {
    const result = runHook(projectRoot, RAG_ON);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('emits nothing (no-op) when paqad is disabled', () => {
    writeArtifact('## context\n- a fact');
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    const result = runHook(projectRoot, RAG_ON);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('honours the PAQAD_CONTEXT_ARTIFACT override (rag on)', () => {
    const custom = join(projectRoot, 'custom-ctx.md');
    writeFileSync(custom, 'override body');
    const result = runHook(projectRoot, { ...RAG_ON, PAQAD_CONTEXT_ARTIFACT: custom });
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

  it('emits the context block ahead of the load reminder (sentinel missing, rag on)', () => {
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    writeFileSync(join(projectRoot, ARTIFACT_REL), '- injected slice');
    const result = runGate(projectRoot, RAG_ON);
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
    const result = runGate(projectRoot, RAG_ON);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('F3 — disabled / cold-start == today (on/off equivalence)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-seam-f3-'));
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    // A real artifact sits on disk for EVERY case below, so each test proves the
    // gate — not mere absence — is what suppresses injection.
    writeFileSync(join(projectRoot, ARTIFACT_REL), '- would-be slice');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('emits nothing when rag is unset (default off == baseline)', () => {
    const result = runHook(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('emits nothing when rag_enabled=false in team config (converges with missing)', () => {
    writeFileSync(join(projectRoot, '.paqad/.config'), 'rag_enabled=false\n');
    const result = runHook(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('PAQAD_RAG_ENABLED=false env overrides an on-disk artifact', () => {
    const result = runHook(projectRoot, { PAQAD_RAG_ENABLED: 'false' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('byte-identical OFF arm: rag-off output equals the no-artifact baseline', () => {
    const offWithArtifact = runHook(projectRoot).stdout;
    rmSync(join(projectRoot, ARTIFACT_REL), { force: true });
    const baselineNoArtifact = runHook(projectRoot, RAG_ON).stdout;
    expect(offWithArtifact).toBe(baselineNoArtifact);
    expect(offWithArtifact).toBe('');
  });

  it('flips to emitting only once rag is explicitly turned on', () => {
    expect(runHook(projectRoot).stdout).toBe('');
    const on = runHook(projectRoot, RAG_ON);
    expect(on.stdout).toContain('[paqad-context]');
    expect(on.stdout).toContain('- would-be slice');
  });

  it('never errors when the index/artifact is absent and rag is on (cold start)', () => {
    rmSync(join(projectRoot, ARTIFACT_REL), { force: true });
    const result = runHook(projectRoot, RAG_ON);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
  });
});
