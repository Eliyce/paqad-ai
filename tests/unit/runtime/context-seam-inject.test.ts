import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const INJECT_HOOK = resolve(__dirname, '../../../runtime/hooks/context-seam-inject.mjs');
const PROMPT_GATE = resolve(__dirname, '../../../runtime/hooks/agent-entry-prompt-gate.mjs');
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

// F3 + issue #284: the RAG accelerator is OFF by default, but lean rule loading is
// ON by default, so the seam now injects the artifact whenever EITHER is on. Tests
// that exercise the true OFF baseline (byte-identical to today) must set BOTH off.
const RAG_ON: NodeJS.ProcessEnv = { PAQAD_RAG_ENABLED: 'true' };
// The only way to reach today's "emit nothing even with an artifact on disk" path.
const ALL_OFF: NodeJS.ProcessEnv = { PAQAD_RAG_ENABLED: 'false', PAQAD_LEAN_RULES: 'false' };

const runHook = (projectRoot: string, env: NodeJS.ProcessEnv = {}) =>
  run('node', [INJECT_HOOK], projectRoot, env);
const runGate = (projectRoot: string, env: NodeJS.ProcessEnv = {}) =>
  run('node', [PROMPT_GATE], projectRoot, env);

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

describe('agent-entry-prompt-gate.mjs orders the load directive before context (wiring)', () => {
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

  // Always-load fix (Part 0): when the framework is NOT loaded yet, the gate emits
  // ONLY the load directive — the [paqad-context] dump is withheld so the one
  // instruction that must be obeyed first can never be buried under it.
  it('suppresses the context block and emits only the load directive when not loaded (sentinel missing, rag on)', () => {
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    writeFileSync(join(projectRoot, ARTIFACT_REL), '- injected slice');
    const result = runGate(projectRoot, RAG_ON);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[paqad] You MUST load the paqad framework');
    expect(result.stdout).not.toContain('[paqad-context]');
    expect(result.stdout).not.toContain('- injected slice');
  });

  // Once the framework IS loaded (sentinel fresh), the context block is injected
  // exactly as before, and the load directive is gone.
  it('injects the context block once loaded, with no load directive (sentinel fresh, rag on)', () => {
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    writeFileSync(join(projectRoot, ARTIFACT_REL), '- injected slice');
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), future, future);
    const result = runGate(projectRoot, RAG_ON);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[paqad-context]');
    expect(result.stdout).toContain('- injected slice');
    expect(result.stdout).not.toContain('You MUST load');
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

describe('F3 + #284 — the true OFF arm needs BOTH lean and rag off', () => {
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

  it('emits nothing when both lean_rules and rag are off (baseline)', () => {
    const result = runHook(projectRoot, ALL_OFF);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('emits nothing when both are off in team config (converges with missing)', () => {
    writeFileSync(join(projectRoot, '.paqad/.config'), 'rag_enabled=false\nlean_rules=false\n');
    const result = runHook(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('byte-identical OFF arm: all-off output equals the no-artifact baseline', () => {
    const offWithArtifact = runHook(projectRoot, ALL_OFF).stdout;
    rmSync(join(projectRoot, ARTIFACT_REL), { force: true });
    const baselineNoArtifact = runHook(projectRoot, RAG_ON).stdout;
    expect(offWithArtifact).toBe(baselineNoArtifact);
    expect(offWithArtifact).toBe('');
  });

  it('never errors when the artifact is absent and rag is on (cold start)', () => {
    rmSync(join(projectRoot, ARTIFACT_REL), { force: true });
    const result = runHook(projectRoot, RAG_ON);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
  });
});

describe('issue #284 — lean rule loading injects the artifact by default', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-seam-lean-'));
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    writeFileSync(join(projectRoot, ARTIFACT_REL), '- lean rule slice');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('injects the artifact with all flags unset (lean default on, rag off)', () => {
    const result = runHook(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[paqad-context]');
    expect(result.stdout).toContain('- lean rule slice');
  });

  it('injects when lean is on but rag is explicitly off', () => {
    const result = runHook(projectRoot, { PAQAD_LEAN_RULES: 'true', PAQAD_RAG_ENABLED: 'false' });
    expect(result.stdout).toContain('[paqad-context]');
  });

  it('lean_rules=false + rag off suppresses injection (opt back into full-load)', () => {
    const result = runHook(projectRoot, ALL_OFF);
    expect(result.stdout).toBe('');
  });

  it('lean_rules=false but rag on still injects (the rag path is unaffected)', () => {
    const result = runHook(projectRoot, { PAQAD_LEAN_RULES: 'false', ...RAG_ON });
    expect(result.stdout).toContain('[paqad-context]');
    expect(result.stdout).toContain('- lean rule slice');
  });

  it('stays a pure no-op when paqad is disabled, even with lean on', () => {
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    const result = runHook(projectRoot);
    expect(result.stdout).toBe('');
  });
});
