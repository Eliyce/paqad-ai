import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const GATE_SCRIPT = resolve(__dirname, '../../../runtime/hooks/agent-entry-gate.mjs');
const PROMPT_GATE_SCRIPT = resolve(__dirname, '../../../runtime/hooks/agent-entry-prompt-gate.mjs');
const RESET_SCRIPT = resolve(__dirname, '../../../runtime/hooks/agent-entry-session-start.mjs');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runGate(projectRoot: string, input?: string): RunResult {
  try {
    const stdout = execFileSync('node', [GATE_SCRIPT], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      ...(input === undefined ? { stdio: ['ignore', 'pipe', 'pipe'] as const } : { input }),
    });
    return { status: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer; stderr: Buffer };
    return {
      status: err.status,
      stdout: err.stdout?.toString('utf8') ?? '',
      stderr: err.stderr.toString('utf8'),
    };
  }
}

function runPromptGate(projectRoot: string, mode?: 'soft' | 'hard'): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectRoot };
  if (mode) env.PAQAD_AGENT_ENTRY_MODE = mode;
  else delete env.PAQAD_AGENT_ENTRY_MODE;
  try {
    const stdout = execFileSync('node', [PROMPT_GATE_SCRIPT], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer; stderr: Buffer };
    return {
      status: err.status,
      stdout: err.stdout?.toString('utf8') ?? '',
      stderr: err.stderr.toString('utf8'),
    };
  }
}

describe('runtime/hooks/agent-entry-gate.mjs', () => {
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
    // Issue #284 — the rules step is artifact-first (session-context.md, else full
    // rules); stack/design-system/workflows still load in full.
    expect(result.stderr).toContain('.paqad/context/session-context.md');
    expect(result.stderr).toContain('docs/instructions/{stack,design-system,workflows}');
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

  // Issue #307 — the bootstrap's final step IS a Write of the sentinel; gating it
  // deadlocked turn one (the gate's own remediation says "Write the sentinel"
  // while blocking exactly that Write).
  it('allows the Write of the sentinel itself while the sentinel is missing', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: join(projectRoot, '.paqad/.agent-entry-loaded') },
    });
    const result = runGate(projectRoot, payload);
    expect(result.status).toBe(0);
  });

  it('allows a Windows-separator sentinel write (path normalised before matching)', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'C:\\proj\\.paqad\\.agent-entry-loaded' },
    });
    expect(runGate(projectRoot, payload).status).toBe(0);
  });

  it('still blocks a non-sentinel write when a payload is present', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: join(projectRoot, 'src/index.ts') },
    });
    const result = runGate(projectRoot, payload);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('load the paqad framework');
  });

  it('still blocks on a malformed stdin payload (exemption is fail-closed)', () => {
    expect(runGate(projectRoot, '{not json').status).toBe(2);
  });

  // Issue #567 — per-agent entry sentinel. A stage subagent shares the orchestrator's
  // session_id but carries a distinct agent_id, so the sentinel is keyed on agent_id: a
  // subagent must prove its OWN cold load and cannot ride the orchestrator's fresh sentinel.
  describe('per-agent sentinel keying (issue #567)', () => {
    const AGENT = 'agent_dev1';
    const markerPath = (root: string, id: string) =>
      join(root, '.paqad', 'session', 'agent-entry', id);

    /** A fresh, future-dated MAIN-thread sentinel (what the orchestrator leaves behind). */
    function writeFreshBaseSentinel(root: string): void {
      writeFileSync(join(root, '.paqad/.agent-entry-loaded'), '{"loaded_at":"now"}');
      const future = new Date(Date.now() + 60_000);
      utimesSync(join(root, '.paqad/.agent-entry-loaded'), future, future);
    }

    it('blocks a subagent edit even when the main-thread sentinel is fresh', () => {
      writeFreshBaseSentinel(projectRoot);
      const payload = JSON.stringify({
        session_id: 'orchestrator',
        agent_id: AGENT,
        tool_name: 'Edit',
        tool_input: { file_path: join(projectRoot, 'src/index.ts') },
      });
      // The base sentinel is fresh, but this agent has no marker → keyed state is missing.
      expect(runGate(projectRoot, payload).status).toBe(2);
      expect(existsSync(markerPath(projectRoot, AGENT))).toBe(false);
    });

    it('exempts the subagent bootstrap sentinel Write and stamps its per-agent marker', () => {
      const payload = JSON.stringify({
        session_id: 'orchestrator',
        agent_id: AGENT,
        tool_name: 'Write',
        tool_input: { file_path: join(projectRoot, '.paqad/.agent-entry-loaded') },
      });
      expect(runGate(projectRoot, payload).status).toBe(0);
      // The exemption promoted the bootstrap write into this agent's keyed marker.
      expect(existsSync(markerPath(projectRoot, AGENT))).toBe(true);
    });

    it('allows the subagent edit once its marker is stamped, and keeps other agents blocked', () => {
      // Stamp AGENT's marker via the sentinel-write exemption.
      runGate(
        projectRoot,
        JSON.stringify({
          agent_id: AGENT,
          tool_name: 'Write',
          tool_input: { file_path: join(projectRoot, '.paqad/.agent-entry-loaded') },
        }),
      );
      const edit = (id: string) =>
        runGate(
          projectRoot,
          JSON.stringify({
            agent_id: id,
            tool_name: 'Edit',
            tool_input: { file_path: join(projectRoot, 'src/index.ts') },
          }),
        ).status;
      expect(edit(AGENT)).toBe(0); // this agent proved its load
      expect(edit('agent_other')).toBe(2); // a different subagent still must load
    });

    it('names the per-agent marker path in the block message for a subagent', () => {
      const result = runGate(
        projectRoot,
        JSON.stringify({
          agent_id: AGENT,
          tool_name: 'Edit',
          tool_input: { file_path: join(projectRoot, 'src/index.ts') },
        }),
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`.paqad/session/agent-entry/${AGENT}`);
      expect(result.stderr).toContain('stage subagent');
    });

    it('a directly-created marker (the Bash path) clears the subagent gate', () => {
      // Simulate the agent creating its keyed marker with a shell command (ungated by the hook).
      mkdirSync(join(projectRoot, '.paqad/session/agent-entry'), { recursive: true });
      writeFileSync(markerPath(projectRoot, AGENT), '{}');
      const result = runGate(
        projectRoot,
        JSON.stringify({
          agent_id: AGENT,
          tool_name: 'Edit',
          tool_input: { file_path: join(projectRoot, 'src/index.ts') },
        }),
      );
      expect(result.status).toBe(0);
    });

    it('exempts a Write of the per-agent marker itself (so creating it is never blocked)', () => {
      const result = runGate(
        projectRoot,
        JSON.stringify({
          agent_id: AGENT,
          tool_name: 'Write',
          tool_input: { file_path: markerPath(projectRoot, AGENT) },
        }),
      );
      expect(result.status).toBe(0);
    });
  });
});

describe('runtime/hooks/agent-entry-prompt-gate.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prompt-gate-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
    writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('soft mode (default) prints a reminder on stdout and exits 0 when the sentinel is missing', () => {
    const result = runPromptGate(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[paqad]');
    expect(result.stdout).toContain('MUST load the paqad framework');
    expect(result.stdout).toContain('CLAUDE.md');
    expect(result.stdout).toContain('.paqad/framework-path.txt');
    // Issue #284 — artifact-first rules directive.
    expect(result.stdout).toContain('.paqad/context/session-context.md');
    expect(result.stdout).toContain('docs/instructions/{stack,design-system,workflows}');
  });

  // Issue #498, Part A / AC-1 — the fired directive proves paqad is ON (the gate
  // short-circuits silently when OFF), so it states that verdict first and marks the
  // enablement step done; the agent must not spend a tool call re-checking it.
  it('opens with the enablement verdict and marks enablement a done step (#498 AC-1)', () => {
    const result = runPromptGate(projectRoot);
    const lines = result.stdout.split('\n').filter((line) => line.startsWith('[paqad]'));
    // First [paqad] content line states enablement is ON and already verified.
    expect(lines[0]).toMatch(/Enablement: ON — verified by this gate/);
    expect(lines[0]).toMatch(/do not re-check it/i);
    // The step list carries an explicit, done enablement step and the router chain.
    expect(result.stdout).toMatch(/1\. Enablement — ON, already resolved by this gate/);
    expect(result.stdout).toContain('AGENT-BOOTSTRAP.md');
    expect(result.stdout).toContain('AGENT-ROUTER.md');
    // The stale hardcoded workflow count is gone (AC-3).
    expect(result.stdout).not.toContain('9 workflows');
  });

  // Issue #498, Part A / AC-3 — the numbered step prose lives in exactly one shared
  // module, so the prompt-gate and the PreToolUse gate cannot drift. Both directives
  // must therefore carry the identical step lines.
  it('shares its step prose with the PreToolUse gate (#498 AC-3)', () => {
    const promptSteps = runPromptGate(projectRoot)
      .stdout.split('\n')
      .filter((line) => /^\[paqad] {3}\d\./.test(line));
    const gateSteps = runGate(projectRoot)
      .stderr.split('\n')
      .filter((line) => /^\[paqad] {3}\d\./.test(line));
    expect(promptSteps.length).toBeGreaterThan(0);
    expect(gateSteps).toEqual(promptSteps);
  });

  it('the PreToolUse gate block message also states enablement ON (#498)', () => {
    const result = runGate(projectRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Enablement: ON — verified by this gate/);
    expect(result.stderr).toContain('AGENT-ROUTER.md');
  });

  it('hard mode exits 2 with a blocking message on stderr when the sentinel is missing', () => {
    const result = runPromptGate(projectRoot, 'hard');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('MUST load the paqad framework');
    expect(result.stdout).toBe('');
  });

  it('stays silent and exits 0 when the sentinel is fresh', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{"loaded_at":"now"}');
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), future, future);
    const soft = runPromptGate(projectRoot);
    expect(soft.status).toBe(0);
    expect(soft.stdout).toBe('');
    const hard = runPromptGate(projectRoot, 'hard');
    expect(hard.status).toBe(0);
    expect(hard.stderr).toBe('');
  });

  it('invalidates the sentinel when the entry file is newer and re-gates the turn', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), past, past);

    const result = runPromptGate(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('changed mid-session');
    // The shared helper must have deleted the now-stale sentinel.
    expect(() => {
      execFileSync('test', ['-e', join(projectRoot, '.paqad/.agent-entry-loaded')]);
    }).toThrow();
  });

  it('invalidates the sentinel when a docs/instructions file is newer', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), past, past);
    utimesSync(join(projectRoot, 'CLAUDE.md'), past, past);
    utimesSync(join(projectRoot, '.paqad/framework-path.txt'), past, past);
    writeFileSync(join(projectRoot, 'docs/instructions/rules.md'), '# rules');

    const result = runPromptGate(projectRoot, 'hard');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('docs/instructions/ changed mid-session');
  });
});

// Issue #576 (Finding 1a) — the prompt-gate must ROUTE every prompt, including the
// not-yet-loaded (non-fresh sentinel) branch, so the per-session workflow-state exists
// after the FIRST prompt of a session. Without it the Stop backstop reads an `unknown`
// route and falsely blocks a read-only turn on pre-existing dirt.
describe('runtime/hooks/agent-entry-prompt-gate.mjs — routes the first prompt (issue #576)', () => {
  const PROMPT_GATE_SCRIPT = resolve(
    __dirname,
    '../../../runtime/hooks/agent-entry-prompt-gate.mjs',
  );

  function runPromptGateWithInput(projectRoot: string, input: string): RunResult {
    try {
      const stdout = execFileSync('node', [PROMPT_GATE_SCRIPT], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
        input,
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

  function workflowStatePath(projectRoot: string, sessionId: string): string {
    return join(
      projectRoot,
      '.paqad/ledger/paqad.stage-evidence',
      sessionId,
      '.workflow-state.json',
    );
  }

  it('writes the per-session workflow-state on the first prompt even when the sentinel is missing', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prompt-route-'));
    try {
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
      writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
      writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
      // Sentinel deliberately absent — this is the not-yet-loaded first prompt of a session.
      const sessionId = 'route-576';
      const result = runPromptGateWithInput(
        projectRoot,
        JSON.stringify({ prompt: 'How is this project set up technically?', session_id: sessionId }),
      );
      // The load directive still owns the output (routing narration is dropped in this branch).
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('MUST load the paqad framework');
      // The gap this fixes: the per-session workflow-state now exists after the first prompt.
      expect(existsSync(workflowStatePath(projectRoot, sessionId))).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('runtime/hooks/agent-entry-session-start.mjs', () => {
  // Issue #576 (Finding 1b) — SessionStart captures a baseline of the already-dirty tracked files
  // so the completion backstop can subtract inherited dirt. Drives the real hook (needs dist).
  it('captures a dirty-file baseline for the session (issue #576)', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-baseline-hook-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: projectRoot });
      execFileSync('git', ['config', 'user.email', 'b@example.test'], { cwd: projectRoot });
      execFileSync('git', ['config', 'user.name', 'Baseline'], { cwd: projectRoot });
      writeFileSync(join(projectRoot, 'src.ts'), 'export const a = 1;\n');
      execFileSync('git', ['add', '.'], { cwd: projectRoot });
      execFileSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: projectRoot });
      // The tree is already dirty when the session starts.
      writeFileSync(join(projectRoot, 'src.ts'), 'export const a = 2;\n');

      execFileSync('node', [RESET_SCRIPT], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
        input: JSON.stringify({ session_id: 'baseline-1' }),
      });

      const baselinePath = join(
        projectRoot,
        '.paqad/ledger/paqad.stage-evidence/baseline-1/.dirty-baseline.json',
      );
      expect(existsSync(baselinePath)).toBe(true);
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
        files: Record<string, string>;
      };
      expect(baseline.files['src.ts']).toBeTypeOf('string');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('deletes the sentinel and the per-agent markers so every session starts ungated', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-gate-'));
    try {
      mkdirSync(join(projectRoot, '.paqad/session/agent-entry'), { recursive: true });
      writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
      // A leftover per-agent marker from a prior session (issue #567).
      writeFileSync(join(projectRoot, '.paqad/session/agent-entry/agent_x'), '{}');
      execFileSync('node', [RESET_SCRIPT], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
        stdio: 'ignore',
      });
      expect(existsSync(join(projectRoot, '.paqad/.agent-entry-loaded'))).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/session/agent-entry'))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
