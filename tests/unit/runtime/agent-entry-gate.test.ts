import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NO_CONTEXT_REFRESH_ENV, removeTempProject } from './temp-project.js';

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
      env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...NO_CONTEXT_REFRESH_ENV,
    CLAUDE_PROJECT_DIR: projectRoot,
  };
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
    removeTempProject(projectRoot);
  });

  it('blocks with exit code 2 when the sentinel is missing', () => {
    const result = runGate(projectRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CLAUDE.md');
    expect(result.stderr).toContain('.paqad/framework-path.txt');
    expect(result.stderr).toContain('.paqad/context/session-context.md');
    expect(result.stderr).toContain('docs/instructions/{stack,design-system,workflows}');
  });

  it('allows the call when the sentinel exists and is fresh', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{"loaded_at":"now"}');
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), future, future);
    const result = runGate(projectRoot);
    expect(result.status).toBe(0);
  });

  it('blocks again when the entry file is touched after the sentinel was written', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), past, past);
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

  describe('per-agent sentinel keying', () => {
    const AGENT = 'agent_dev1';
    const markerPath = (root: string, id: string) =>
      join(root, '.paqad', 'session', 'agent-entry', id);

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
      expect(existsSync(markerPath(projectRoot, AGENT))).toBe(true);
    });

    it('allows the subagent edit once its marker is stamped, and keeps other agents blocked', () => {
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
      expect(edit(AGENT)).toBe(0);
      expect(edit('agent_other')).toBe(2);
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
    removeTempProject(projectRoot);
  });

  it('soft mode (default) prints a reminder on stdout and exits 0 when the sentinel is missing', () => {
    const result = runPromptGate(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[paqad]');
    expect(result.stdout).toContain('MUST load the paqad framework');
    expect(result.stdout).toContain('CLAUDE.md');
    expect(result.stdout).toContain('.paqad/framework-path.txt');
    expect(result.stdout).toContain('.paqad/context/session-context.md');
    expect(result.stdout).toContain('docs/instructions/{stack,design-system,workflows}');
  });

  it('opens with the enablement verdict and marks enablement a done step', () => {
    const result = runPromptGate(projectRoot);
    const lines = result.stdout.split('\n').filter((line) => line.startsWith('[paqad]'));
    expect(lines[0]).toMatch(/Enablement: ON — verified by this gate/);
    expect(lines[0]).toMatch(/do not re-check it/i);
    expect(result.stdout).toMatch(/1\. Enablement — ON, already resolved by this gate/);
    expect(result.stdout).toContain('AGENT-BOOTSTRAP.md');
    expect(result.stdout).toContain('AGENT-ROUTER.md');
    expect(result.stdout).not.toContain('9 workflows');
  });

  it('shares its step prose with the PreToolUse gate', () => {
    const promptSteps = runPromptGate(projectRoot)
      .stdout.split('\n')
      .filter((line) => /^\[paqad] {3}\d\./.test(line));
    const gateSteps = runGate(projectRoot)
      .stderr.split('\n')
      .filter((line) => /^\[paqad] {3}\d\./.test(line));
    expect(promptSteps.length).toBeGreaterThan(0);
    expect(gateSteps).toEqual(promptSteps);
  });

  it('the PreToolUse gate block message also states enablement ON', () => {
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
    writeFileSync(join(projectRoot, '.paqad/.config'), 'spec_pipeline_enabled=false\n');
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

describe('runtime/hooks/agent-entry-prompt-gate.mjs — routes the first prompt', () => {
  const PROMPT_GATE_SCRIPT = resolve(
    __dirname,
    '../../../runtime/hooks/agent-entry-prompt-gate.mjs',
  );

  function runPromptGateWithInput(projectRoot: string, input: string): RunResult {
    try {
      const stdout = execFileSync('node', [PROMPT_GATE_SCRIPT], {
        env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
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
      const sessionId = 'route-576';
      const result = runPromptGateWithInput(
        projectRoot,
        JSON.stringify({
          prompt: 'How is this project set up technically?',
          session_id: sessionId,
        }),
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('MUST load the paqad framework');
      expect(existsSync(workflowStatePath(projectRoot, sessionId))).toBe(true);
    } finally {
      removeTempProject(projectRoot);
    }
  });

  it.each([
    ['implement a schema migration adding a pii payment column', true],
    ['why does the login page throw an error when I submit?', false],
  ])(
    'names the session id for SE_SESSION only on a feature-development prompt (%s)',
    (prompt, named) => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prompt-session-'));
      try {
        mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
        mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
        writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
        writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
        const sentinel = join(projectRoot, '.paqad/.agent-entry-loaded.d/route-582');
        mkdirSync(join(projectRoot, '.paqad/.agent-entry-loaded.d'), { recursive: true });
        writeFileSync(sentinel, '{"loaded_at":"now"}');
        const future = new Date(Date.now() + 60_000);
        utimesSync(sentinel, future, future);

        const result = runPromptGateWithInput(
          projectRoot,
          JSON.stringify({ prompt, session_id: 'route-582' }),
        );

        expect(result.status).toBe(0);
        const line =
          '[paqad] session route-582: prefix paqad-ai commands with SE_SESSION=route-582';
        expect(result.stdout.includes(line)).toBe(named);
      } finally {
        removeTempProject(projectRoot);
      }
    },
  );

  it.each([
    ['fix a one-line typo in a code comment', false],
    ['implement a schema migration adding a pii payment column and a breaking api change', true],
    ['what does this project do', false],
  ])('prints the spec-pipeline nudge by lane (%s)', (prompt, nudged) => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prompt-nudge-'));
    try {
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
      writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
      writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
      const sentinel = join(projectRoot, '.paqad/.agent-entry-loaded.d/nudge-640');
      mkdirSync(join(projectRoot, '.paqad/.agent-entry-loaded.d'), { recursive: true });
      writeFileSync(sentinel, '{"loaded_at":"now"}');
      const future = new Date(Date.now() + 60_000);
      utimesSync(sentinel, future, future);

      const result = runPromptGateWithInput(
        projectRoot,
        JSON.stringify({ prompt, session_id: 'nudge-640' }),
      );

      expect(result.status).toBe(0);
      expect(result.stdout.includes('Spec pipeline: ON (experts: ON, adoption: strict)')).toBe(
        nudged,
      );
    } finally {
      removeTempProject(projectRoot);
    }
  });
});

describe('runtime/hooks/agent-entry-session-start.mjs', () => {
  it('captures a dirty-file baseline for the session', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-baseline-hook-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: projectRoot });
      execFileSync('git', ['config', 'user.email', 'b@example.test'], { cwd: projectRoot });
      execFileSync('git', ['config', 'user.name', 'Baseline'], { cwd: projectRoot });
      writeFileSync(join(projectRoot, 'src.ts'), 'export const a = 1;\n');
      execFileSync('git', ['add', '.'], { cwd: projectRoot });
      execFileSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: projectRoot });
      writeFileSync(join(projectRoot, 'src.ts'), 'export const a = 2;\n');

      execFileSync('node', [RESET_SCRIPT], {
        env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
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
      removeTempProject(projectRoot);
    }
  });

  it('deletes the sentinel and the per-agent markers so every session starts ungated', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-gate-'));
    try {
      mkdirSync(join(projectRoot, '.paqad/session/agent-entry'), { recursive: true });
      writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
      writeFileSync(join(projectRoot, '.paqad/session/agent-entry/agent_x'), '{}');
      execFileSync('node', [RESET_SCRIPT], {
        env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
        stdio: 'ignore',
      });
      expect(existsSync(join(projectRoot, '.paqad/.agent-entry-loaded'))).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/session/agent-entry'))).toBe(false);
    } finally {
      removeTempProject(projectRoot);
    }
  });
});

describe('per-session entry sentinel', () => {
  let projectRoot: string;
  const sessionFile = (id: string) => join(projectRoot, '.paqad/.agent-entry-loaded.d', id);
  const editPayload = (sessionId?: string) =>
    JSON.stringify({
      ...(sessionId ? { session_id: sessionId } : {}),
      tool_name: 'Edit',
      tool_input: { file_path: join(projectRoot, 'src/index.ts') },
    });

  function writeFresh(path: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{"loaded_at":"now"}');
    const future = new Date(Date.now() + 60_000);
    utimesSync(path, future, future);
  }

  function runSessionStart(input: string): void {
    execFileSync('node', [RESET_SCRIPT], {
      env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
      input,
    });
  }

  function runPromptGateFor(input: string): RunResult {
    const stdout = execFileSync('node', [PROMPT_GATE_SCRIPT], {
      env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
      input,
    });
    return { status: 0, stdout: stdout.toString('utf8'), stderr: '' };
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-session-sentinel-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
    writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
  });

  afterEach(() => {
    removeTempProject(projectRoot);
  });

  it('SessionStart for session B leaves session A sentinel, and A can still edit (AC-10)', () => {
    writeFresh(sessionFile('session-A'));
    writeFresh(sessionFile('session-B'));

    runSessionStart(JSON.stringify({ session_id: 'session-B' }));

    expect(existsSync(sessionFile('session-A'))).toBe(true);
    expect(existsSync(sessionFile('session-B'))).toBe(false);
    expect(runGate(projectRoot, editPayload('session-A')).status).toBe(0);
    expect(runGate(projectRoot, editPayload('session-B')).status).toBe(2);
  });

  it('SessionStart with a session id leaves the legacy file alone', () => {
    writeFresh(join(projectRoot, '.paqad/.agent-entry-loaded'));
    runSessionStart(JSON.stringify({ session_id: 'session-B' }));
    expect(existsSync(join(projectRoot, '.paqad/.agent-entry-loaded'))).toBe(true);
  });

  it('blocks session C when only session A has loaded, naming C own sentinel path', () => {
    writeFresh(sessionFile('session-A'));
    const result = runGate(projectRoot, editPayload('session-C'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      '5. Write .paqad/.agent-entry-loaded.d/session-C with timestamp + entry-file path',
    );
  });

  it('a session payload does not ride the legacy file', () => {
    writeFresh(join(projectRoot, '.paqad/.agent-entry-loaded'));
    expect(runGate(projectRoot, editPayload('session-C')).status).toBe(2);
  });

  it('a payload with no session id still honours the legacy file', () => {
    writeFresh(join(projectRoot, '.paqad/.agent-entry-loaded'));
    expect(runGate(projectRoot, editPayload()).status).toBe(0);
  });

  it('sanitizes the session id into a safe filename', () => {
    writeFresh(sessionFile('a_b__c'));
    expect(runGate(projectRoot, editPayload('a:b/.c')).status).toBe(0);
  });

  it('exempts a Write of the per-session sentinel while it is missing', () => {
    const payload = JSON.stringify({
      session_id: 'session-A',
      tool_name: 'Write',
      tool_input: { file_path: sessionFile('session-A') },
    });
    expect(runGate(projectRoot, payload).status).toBe(0);
    const relative = JSON.stringify({
      session_id: 'session-A',
      tool_name: 'Write',
      tool_input: { file_path: '.paqad/.agent-entry-loaded.d/session-A' },
    });
    expect(runGate(projectRoot, relative).status).toBe(0);
  });

  it('promotes a main-thread Write of the legacy file into this session own sentinel', () => {
    const payload = JSON.stringify({
      session_id: 'session-A',
      tool_name: 'Write',
      tool_input: { file_path: join(projectRoot, '.paqad/.agent-entry-loaded') },
    });
    expect(runGate(projectRoot, payload).status).toBe(0);
    expect(existsSync(sessionFile('session-A'))).toBe(true);
    const stamped = JSON.parse(readFileSync(sessionFile('session-A'), 'utf8')) as {
      entry_file: string;
    };
    expect(stamped.entry_file).toBe('CLAUDE.md');
  });

  it('the prompt gate checks the payload session and names its exact sentinel path', () => {
    writeFresh(sessionFile('session-A'));
    const loaded = runPromptGateFor(JSON.stringify({ prompt: '', session_id: 'session-A' }));
    expect(loaded.stdout).not.toContain('MUST load the paqad framework');

    const other = runPromptGateFor(JSON.stringify({ prompt: '', session_id: 'session-C' }));
    expect(other.stdout).toContain('MUST load the paqad framework');
    expect(other.stdout).toContain(
      'Reason: the per-session sentinel .paqad/.agent-entry-loaded.d/session-C is missing.',
    );
    expect(other.stdout).toContain('5. Write .paqad/.agent-entry-loaded.d/session-C');
  });

  it('deletes a stale per-session sentinel and leaves other sessions alone', () => {
    writeFresh(sessionFile('session-A'));
    const past = new Date(Date.now() - 60_000);
    mkdirSync(join(projectRoot, '.paqad/.agent-entry-loaded.d'), { recursive: true });
    writeFileSync(sessionFile('session-B'), '{}');
    utimesSync(sessionFile('session-B'), past, past);

    expect(runGate(projectRoot, editPayload('session-B')).status).toBe(2);
    expect(existsSync(sessionFile('session-B'))).toBe(false);
    expect(existsSync(sessionFile('session-A'))).toBe(true);
  });
});
