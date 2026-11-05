import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const COMPLETION = join(process.cwd(), 'runtime/hooks/stage-agent-completion.mjs');
const GATE = join(process.cwd(), 'runtime/hooks/capability-gate.mjs');
const SESSION = 'ses_refusal';
const AGENT = 'agent_refusal';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-refusal-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '/nowhere\n');
  return root;
}

async function cli(root: string, args: string[]) {
  return execa('node', [CLI, ...args], {
    cwd: root,
    env: { SE_SESSION: SESSION, SE_AGENT_ID: AGENT },
    reject: false,
  });
}

function bundleDir(root: string): string {
  const base = join(root, '.paqad/ledger/feature-evidence');
  return join(base, readdirSync(base).filter((name) => name !== '_session')[0]!);
}

async function reviewReports(root: string, message: string, argv: string[]): Promise<void> {
  await execa('node', [COMPLETION, ...argv], {
    input: JSON.stringify({
      session_id: SESSION,
      agent_id: AGENT,
      agent_type: 'paqad-review',
      hook_event_name: 'SubagentStop',
      last_assistant_message: message,
    }),
    env: { PAQAD_PROJECT_ROOT: root },
    reject: false,
  });
}

async function editGateExit(root: string): Promise<number | undefined> {
  const run = await execa('node', [GATE, 'pre-mutation'], {
    input: JSON.stringify({
      session_id: SESSION,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src/a.ts') },
    }),
    env: { PAQAD_PROJECT_ROOT: root },
    reject: false,
  });
  return run.exitCode;
}

describe.each([
  ['Claude Code', []],
  ['Codex', ['codex-cli']],
])('the next stage refuses to start past a blocked review on %s', (_host, argv) => {
  it('AC-24: refuses checks, naming review, the reason and the next action, and leaves the edit gate alone', async () => {
    const root = tempRoot();
    await cli(root, ['stage', 'start', 'review', '--title', 'refusal', '--issue', '1']);
    const gateBefore = await editGateExit(root);
    await reviewReports(root, 'the digest is missing\nStatus: BLOCKED', argv);

    const refused = await cli(root, ['stage', 'start', 'checks']);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain('review');
    expect(refused.stderr).toContain('Next:');
    expect(await editGateExit(root)).toBe(gateBefore);

    const review = join(bundleDir(root), 'review.json');
    writeFileSync(review, '{}\n');
    await cli(root, ['stage', 'end', 'review', '--artifact', review]);
    const cleared = await cli(root, ['stage', 'start', 'checks']);
    expect(cleared.exitCode).toBe(0);
  });
});
