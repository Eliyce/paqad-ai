import { execFileSync } from 'node:child_process';
import {
  chmodSync,
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

import {
  appendFeatureStageRow,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import { liveStageAgents } from '@/stage-evidence/completion-deferred.js';

import { TASK_LIST_SENTENCES } from '../../../runtime/claude-plugin/mod/desktop-view.ts';
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

  it('blocks when a loaded workflow file is newer than the sentinel', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), past, past);
    utimesSync(join(projectRoot, 'CLAUDE.md'), past, past);
    utimesSync(join(projectRoot, '.paqad/framework-path.txt'), past, past);
    mkdirSync(join(projectRoot, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs/instructions/workflows/x.yaml'), 'x: 1');
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

  it('re-gates the turn when a loaded docs/instructions file is newer', () => {
    writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{}');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), past, past);
    utimesSync(join(projectRoot, 'CLAUDE.md'), past, past);
    utimesSync(join(projectRoot, '.paqad/framework-path.txt'), past, past);
    mkdirSync(join(projectRoot, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs/instructions/workflows/x.yaml'), 'x: 1');

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
    ['implement a schema migration adding a pii payment column', TASK_LIST_SENTENCES.full],
    ['fix a one-line typo in a code comment', TASK_LIST_SENTENCES.fast],
    ['why does the login page throw an error when I submit?', null],
    ['what does this project do', null],
  ])(
    "AC-17: prints the lane's task-list sentence verbatim on a feature-development prompt only (%s)",
    (prompt, sentence) => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prompt-tasks-'));
      try {
        mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
        mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
        writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
        writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
        const sentinel = join(projectRoot, '.paqad/.agent-entry-loaded.d/tasks-17');
        mkdirSync(join(projectRoot, '.paqad/.agent-entry-loaded.d'), { recursive: true });
        writeFileSync(sentinel, '{"loaded_at":"now"}');
        const future = new Date(Date.now() + 60_000);
        utimesSync(sentinel, future, future);

        const result = runPromptGateWithInput(
          projectRoot,
          JSON.stringify({ prompt, session_id: 'tasks-17' }),
        );

        expect(result.status).toBe(0);
        const printed = result.stdout
          .split('\n')
          .filter((line) => line.startsWith('paqad task list:'));
        expect(printed).toEqual(sentence === null ? [] : [sentence]);
        if (sentence !== null) {
          const lines = result.stdout.split('\n');
          const session = lines.findIndex((line) => line.includes('SE_SESSION=tasks-17'));
          expect(lines[session + 1]).toBe(sentence);
        }
      } finally {
        removeTempProject(projectRoot);
      }
    },
  );

  it('AC-17: a prompt with no session id still gets the task-list sentence and no session line', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prompt-tasks-'));
    try {
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
      writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
      writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
      writeFileSync(join(projectRoot, '.paqad/.agent-entry-loaded'), '{"loaded_at":"now"}');
      const future = new Date(Date.now() + 60_000);
      utimesSync(join(projectRoot, '.paqad/.agent-entry-loaded'), future, future);

      const result = runPromptGateWithInput(
        projectRoot,
        JSON.stringify({ prompt: 'implement a schema migration adding a pii payment column' }),
      );

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('SE_SESSION=');
      expect(result.stdout).toContain(TASK_LIST_SENTENCES.full);
    } finally {
      removeTempProject(projectRoot);
    }
  });

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

  function abandonedFixture(): { projectRoot: string; dir: string } {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-abandon-hook-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: projectRoot, stdio: 'ignore' });
    git('init', '--quiet', '-b', 'main');
    git('config', 'user.email', 'a@example.test');
    git('config', 'user.name', 'Abandon');
    writeFileSync(join(projectRoot, '.gitignore'), '.paqad/\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'init');
    const dir = '9-left-behind-01M5DHQYW9J0Y7ZGF6QN0E3400';
    const bundle = join(projectRoot, '.paqad/ledger/feature-evidence', dir);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
    writeFileSync(
      join(bundle, 'stage-evidence.jsonl'),
      `${JSON.stringify({
        schema_version: 2,
        doc_type: 'paqad.stage-evidence',
        change: '01M5DHQYW9J0Y7ZGF6QN0E3400',
        session_id: 'old-session',
        recorded_at: '2020-01-01T00:00:00.000Z',
        content_hash: 'h-open',
        kind: 'open',
        agent: 'orchestrator',
        branch: 'feat/long-gone',
      })}\n`,
    );
    return { projectRoot, dir };
  }

  it('closes an abandoned change silently: exit 0, nothing on stdout', () => {
    const { projectRoot, dir } = abandonedFixture();
    try {
      const stdout = execFileSync('node', [RESET_SCRIPT], {
        env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
        input: JSON.stringify({ session_id: 'abandon-1' }),
      });
      expect(stdout.toString('utf8')).toBe('');
      const rows = readFileSync(
        join(projectRoot, '.paqad/ledger/feature-evidence', dir, 'stage-evidence.jsonl'),
        'utf8',
      );
      expect(rows).toContain('abandoned: branch gone, no row for 24h');
    } finally {
      removeTempProject(projectRoot);
    }
  });

  it('a fault in the abandoned close keeps exit 0 and empty stdout, and is logged', () => {
    const { projectRoot, dir } = abandonedFixture();
    const ledger = join(projectRoot, '.paqad/ledger/feature-evidence', dir, 'stage-evidence.jsonl');
    try {
      chmodSync(ledger, 0o444);
      const stdout = execFileSync('node', [RESET_SCRIPT], {
        env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
        input: JSON.stringify({ session_id: 'abandon-2' }),
      });
      expect(stdout.toString('utf8')).toBe('');
      expect(readFileSync(join(projectRoot, '.paqad/logs/hooks.log'), 'utf8')).toContain(
        'session-start: abandoned close skipped',
      );
    } finally {
      chmodSync(ledger, 0o644);
      removeTempProject(projectRoot);
    }
  });

  it.each([
    ['startup', 1],
    ['resume', 1],
    ['compact', 0],
  ])(
    'a %s session releases stage agents that never reported back with %i repair row',
    (source, expected) => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-release-hook-'));
      try {
        const git = (...args: string[]) =>
          execFileSync('git', args, { cwd: projectRoot, stdio: 'ignore' });
        git('init', '--quiet', '-b', 'main');
        git('config', 'user.email', 'r@example.test');
        git('config', 'user.name', 'Release');
        writeFileSync(join(projectRoot, '.gitignore'), '.paqad/\n');
        git('add', '.');
        git('commit', '--quiet', '-m', 'init');
        const session = `release-${source}`;
        const dirName = openFeatureChange(projectRoot, session, {
          adapter: 'claude-code',
          title: 'crashed stage agent',
          issue: null,
          lane: 'full',
        });
        appendFeatureStageRow(projectRoot, session, dirName, {
          kind: 'stage-agent',
          stage: 'planning',
          agent: 'paqad-planning',
          agent_id: 'a1',
          event_status: 'started',
          tokens_used: 0,
          tokens_not_recarried: 0,
          estimate: true,
        });
        const stdout = execFileSync('node', [RESET_SCRIPT], {
          env: { ...process.env, ...NO_CONTEXT_REFRESH_ENV, CLAUDE_PROJECT_DIR: projectRoot },
          input: JSON.stringify({ session_id: session, source }),
        });
        expect(stdout.toString('utf8')).toBe('');
        const rows = readFeatureStageUnit(projectRoot, dirName);
        expect(rows.filter((row) => row.kind === 'record-repair')).toHaveLength(expected);
        expect(liveStageAgents(rows)).toHaveLength(1 - expected);
      } finally {
        removeTempProject(projectRoot);
      }
    },
  );

  it.each([
    ['Claude Code', 'claude-code'],
    ['Codex', 'codex-cli'],
  ])(
    'AC-13: a %s SessionStart does not adopt a change another session is running',
    (_host, adapter) => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-running-hook-'));
      try {
        const git = (...args: string[]) =>
          execFileSync('git', args, { cwd: projectRoot, stdio: 'ignore' });
        git('init', '--quiet', '-b', 'main');
        git('config', 'user.email', 'r@example.test');
        git('config', 'user.name', 'Running');
        writeFileSync(join(projectRoot, '.gitignore'), '.paqad/\n');
        git('add', '.');
        git('commit', '--quiet', '-m', 'init');
        mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
        writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
        const dirName = openFeatureChange(projectRoot, 'ses_running', {
          adapter,
          title: 'running change',
          issue: null,
          lane: 'full',
        });
        for (const stage of ['development', 'checks', 'documentation_sync']) {
          appendFeatureStageRow(projectRoot, 'ses_running', dirName, {
            kind: 'stage_start',
            stage,
            event_status: 'started',
          });
        }
        const payload =
          adapter === 'codex-cli'
            ? {
                session_id: 'ses_new',
                hook_event_name: 'SessionStart',
                source: 'startup',
                cwd: projectRoot,
                model: 'gpt-5-codex',
                transcript_path: null,
              }
            : { session_id: 'ses_new', hook_event_name: 'SessionStart', source: 'startup' };
        execFileSync('node', [RESET_SCRIPT], {
          cwd: projectRoot,
          env: {
            ...process.env,
            ...NO_CONTEXT_REFRESH_ENV,
            CLAUDE_PROJECT_DIR: adapter === 'codex-cli' ? '' : projectRoot,
            PAQAD_PROJECT_ROOT: '',
          },
          input: JSON.stringify(payload),
        });
        expect(readSessionControl(projectRoot, 'ses_new').active).toBeNull();
        expect(readSessionControl(projectRoot, 'ses_running').active).toBe(dirName);
        expect(
          readFeatureStageUnit(projectRoot, dirName).some((row) => row.session_id === 'ses_new'),
        ).toBe(false);
      } finally {
        removeTempProject(projectRoot);
      }
    },
  );

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

  it('SessionStart for session B leaves session A sentinel, and A can still edit', () => {
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

describe('entry gate staleness on the loaded instruction folders', () => {
  const AGENT = 'agent_dev1';
  const MARKER_REL = `.paqad/session/agent-entry/${AGENT}`;
  const OLDER = new Date(1_699_999_980_000);
  const LOADED = new Date(1_699_999_990_000);
  const NEWER = new Date(1_700_000_000_000);
  let projectRoot: string;

  function write(relative: string, mtime: Date = NEWER): void {
    const full = join(projectRoot, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '# x\n');
    utimesSync(full, mtime, mtime);
  }

  function edit(payload: Record<string, unknown> = { agent_id: AGENT }): RunResult {
    return runGate(
      projectRoot,
      JSON.stringify({
        ...payload,
        tool_name: 'Edit',
        tool_input: { file_path: join(projectRoot, 'src/index.ts') },
      }),
    );
  }

  function hooksLog(): string[] {
    const path = join(projectRoot, '.paqad/logs/hooks.log');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.includes('agent-entry-gate block'));
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-gate-loaded-'));
    write('CLAUDE.md', OLDER);
    write('.paqad/framework-path.txt', OLDER);
    write('docs/instructions/workflows/feature-development.yaml', OLDER);
    write(MARKER_REL, LOADED);
  });

  afterEach(() => {
    removeTempProject(projectRoot);
  });

  it('AC-44: a change under docs/instructions/rules does not block the agent', () => {
    write('docs/instructions/rules/x.md');
    expect(edit().status).toBe(0);
    expect(hooksLog()).toEqual([]);
  });

  it('AC-45: a workflow change blocks and lists only that file and the marker path', () => {
    write('docs/instructions/workflows/feature-development.yaml');
    const result = edit();
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      [
        '[paqad] Blocked: 1 instruction file changed since you loaded them.',
        `[paqad] Read them, then write ${MARKER_REL} and retry:`,
        '[paqad]   docs/instructions/workflows/feature-development.yaml',
        '',
      ].join('\n'),
    );
  });

  it('AC-46: a changed CLAUDE.md still asks for the full framework load', () => {
    write('CLAUDE.md');
    const result = edit();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('[paqad] Blocked: load the paqad framework before editing.');
    expect(result.stderr).toContain('AGENT-ROUTER.md');
  });

  it('AC-47: a missing marker and a changed framework-path.txt block with the full-load text', () => {
    write('.paqad/framework-path.txt');
    const stale = edit();
    expect(stale.status).toBe(2);
    expect(stale.stderr).toContain('load the paqad framework before editing');
    const missing = edit({ agent_id: 'agent_never_loaded' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('load the paqad framework before editing');
  });

  it('AC-47: a change under stack or design-system blocks', () => {
    write('docs/instructions/stack/overview.md');
    write('docs/instructions/design-system/tokens.md');
    const result = edit();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('2 instruction files changed');
  });

  it('AC-48: each block writes one hooks.log line with the reason, id and file count', () => {
    write('docs/instructions/workflows/feature-development.yaml');
    write('docs/instructions/stack/overview.md');
    edit();
    edit({ agent_id: 'agent_never_loaded' });
    edit({ session_id: 'ses-1' });
    const lines = hooksLog();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(
      new RegExp(`agent-entry-gate block reason=stale:docs-instructions agent=${AGENT} files=2$`),
    );
    expect(lines[1]).toMatch(
      /agent-entry-gate block reason=missing agent=agent_never_loaded files=0$/,
    );
    expect(lines[2]).toMatch(/agent-entry-gate block reason=missing agent=ses-1 files=0$/);
    expect(lines.join('\n')).not.toContain('docs/instructions');
  });

  it('AC-48: a changed entry file logs reason=stale:entry-file', () => {
    write('CLAUDE.md');
    edit();
    expect(hooksLog()).toHaveLength(1);
    expect(hooksLog()[0]).toMatch(/reason=stale:entry-file agent=agent_dev1 files=0$/);
  });

  it('AC-49: eleven changed files list ten plus "and 1 more" with forward slashes', () => {
    for (let index = 0; index < 11; index += 1) {
      write(`docs/instructions/workflows/nested/w${String(index).padStart(2, '0')}.yaml`);
    }
    const result = edit();
    const listed = result.stderr.split('\n').filter((line) => line.startsWith('[paqad]   '));
    expect(listed).toHaveLength(11);
    expect(listed[0]).toBe('[paqad]   docs/instructions/workflows/nested/w00.yaml');
    expect(listed[10]).toBe('[paqad]   and 1 more');
    expect(result.stderr).toContain('11 instruction files changed');
    expect(hooksLog()[0]).toMatch(/files=11$/);
  });

  it('AC-49: ten changed files list all ten with no "and N more"', () => {
    for (let index = 0; index < 10; index += 1) {
      write(`docs/instructions/workflows/w${index}.yaml`);
    }
    const result = edit();
    const listed = result.stderr.split('\n').filter((line) => line.startsWith('[paqad]   '));
    expect(listed).toHaveLength(10);
    expect(result.stderr).not.toContain('more');
  });

  it('AC-50: a retry without writing the marker gets the same file list', () => {
    write('docs/instructions/workflows/feature-development.yaml');
    const first = edit();
    const second = edit();
    expect(second.status).toBe(2);
    expect(second.stderr).toBe(first.stderr);
    expect(second.stderr).not.toContain('load the paqad framework');
  });

  it('AC-45: writing the named marker clears the block', () => {
    write('docs/instructions/workflows/feature-development.yaml');
    expect(edit().status).toBe(2);
    const stamp = runGate(
      projectRoot,
      JSON.stringify({
        agent_id: AGENT,
        tool_name: 'Write',
        tool_input: { file_path: join(projectRoot, MARKER_REL) },
      }),
    );
    expect(stamp.status).toBe(0);
    expect(edit().status).toBe(0);
  });
});
