import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const RUNTIME_HOOKS = join(REPO_ROOT, 'runtime', 'hooks');

const TASK_NOTIFICATION = [
  '<task-notification>',
  '<task-id>t1</task-id>',
  '<status>completed</status>',
  '</task-notification>',
].join('\n');

const HAND_BACK = [
  '<system-reminder id="r1">',
  'Another Claude session sent a message while you were working:',
  '<agent-message from="a1b2c3">',
  '  [Subagent hand-back] The text below is the final report of a subagent.',
  '  completed',
  '</agent-message>',
  '</system-reminder>',
].join('\n');

const STOP_HOOK_FEEDBACK = 'Stop hook feedback:\nThe completion check failed.';

const MACHINE_PROMPTS = [
  ['a task notification', TASK_NOTIFICATION],
  ['a stage-agent hand-back', HAND_BACK],
  ['Stop hook feedback', STOP_HOOK_FEEDBACK],
];

interface Harness {
  pkg: string;
  hook: string;
  spawnLog: string;
}

function buildHarness(withDist: boolean): Harness {
  const pkg = mkdtempSync(join(tmpdir(), 'paqad-prompt-refresh-pkg-'));
  const hookDir = join(pkg, 'runtime', 'hooks');
  mkdirSync(hookDir, { recursive: true });
  const hook = join(hookDir, 'agent-entry-prompt-gate.mjs');
  copyFileSync(join(RUNTIME_HOOKS, 'agent-entry-prompt-gate.mjs'), hook);
  symlinkSync(join(RUNTIME_HOOKS, 'lib'), join(hookDir, 'lib'));
  symlinkSync(join(REPO_ROOT, 'runtime', 'scripts'), join(pkg, 'runtime', 'scripts'));
  if (withDist) {
    symlinkSync(join(REPO_ROOT, 'dist'), join(pkg, 'dist'));
  }
  const spawnLog = join(pkg, 'spawns.log');
  writeFileSync(
    join(hookDir, 'context-refresh-trigger.mjs'),
    `import { appendFileSync } from 'node:fs';\n` +
      `appendFileSync(${JSON.stringify(spawnLog)}, \`\${process.argv[2] ?? 'none'}\\n\`);\n`,
  );
  return { pkg, hook, spawnLog };
}

function runGate(
  harness: Harness,
  projectRoot: string,
  prompt: string,
  sessionId: string,
): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [harness.hook], {
      input: JSON.stringify({ prompt, session_id: sessionId }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stdout.toString('utf8') };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer };
    return { status: err.status, stdout: err.stdout?.toString('utf8') ?? '' };
  }
}

function spawnedSessions(harness: Harness): string[] {
  if (!existsSync(harness.spawnLog)) return [];
  return readFileSync(harness.spawnLog, 'utf8').split('\n').filter(Boolean);
}

async function waitForSpawn(harness: Harness, sessionId: string): Promise<void> {
  await vi.waitFor(() => expect(spawnedSessions(harness)).toContain(sessionId), {
    timeout: 5000,
  });
}

function freshSentinel(projectRoot: string, sessionId: string): void {
  const dir = join(projectRoot, '.paqad', '.agent-entry-loaded.d');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, sessionId), '{"loaded_at":"now"}');
  const future = new Date(Date.now() + 60_000);
  utimesSync(join(dir, sessionId), future, future);
}

describe.skipIf(process.platform === 'win32')(
  'runtime/hooks/agent-entry-prompt-gate.mjs context refresh',
  () => {
    let projectRoot: string;
    let harness: Harness;

    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), 'paqad-prompt-refresh-'));
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      mkdirSync(join(projectRoot, 'docs/instructions'), { recursive: true });
      writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
      writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
      harness = buildHarness(true);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(harness.pkg, { recursive: true, force: true });
    });

    it('AC-54: a human prompt spawns one refresh', async () => {
      expect(runGate(harness, projectRoot, 'add a logout button', 'human').status).toBe(0);
      await waitForSpawn(harness, 'human');
      expect(spawnedSessions(harness)).toEqual(['human']);
    });

    it.each(MACHINE_PROMPTS)(
      'AC-54: %s spawns no refresh while the entry marker is not fresh',
      async (_label, prompt) => {
        expect(runGate(harness, projectRoot, prompt, 'machine').status).toBe(0);
        runGate(harness, projectRoot, 'a human prompt after it', 'human');
        await waitForSpawn(harness, 'human');
        expect(spawnedSessions(harness)).not.toContain('machine');
      },
    );

    it.each(MACHINE_PROMPTS)(
      'AC-54: %s spawns no refresh while the entry marker is fresh',
      async (_label, prompt) => {
        freshSentinel(projectRoot, 'machine');
        freshSentinel(projectRoot, 'human');
        expect(runGate(harness, projectRoot, prompt, 'machine').status).toBe(0);
        runGate(harness, projectRoot, 'a human prompt after it', 'human');
        await waitForSpawn(harness, 'human');
        expect(spawnedSessions(harness)).not.toContain('machine');
      },
    );

    it('AC-55: a human prompt that quotes the machine markers mid-text still spawns', async () => {
      const prompt = 'why did "Stop hook feedback:" and a <task-notification> show up last turn?';
      runGate(harness, projectRoot, prompt, 'quoting');
      await waitForSpawn(harness, 'quoting');
    });

    it('INV-11: a Stop hook feedback prompt still gets the entry-gate directive', () => {
      const result = runGate(harness, projectRoot, STOP_HOOK_FEEDBACK, 'machine');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('MUST load the paqad framework');
    });

    it('AC-58: with dist missing a human prompt is not blocked and spawns no refresh', async () => {
      const bare = buildHarness(false);
      try {
        const result = runGate(bare, projectRoot, 'add a logout button', 'no-dist');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('MUST load the paqad framework');
        runGate(harness, projectRoot, 'a human prompt after it', 'human');
        await waitForSpawn(harness, 'human');
        expect(spawnedSessions(bare)).toEqual([]);
      } finally {
        rmSync(bare.pkg, { recursive: true, force: true });
      }
    });
  },
);
