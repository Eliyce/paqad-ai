import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const HOOK = join(process.cwd(), 'runtime/hooks/stage-agent-completion.mjs');
const CLI = join(process.cwd(), 'dist/cli/index.js');

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-stage-agent-hook-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** Open a feature bundle in `root` via the real CLI, aligning the ledger cache to `session`. */
async function openFeature(root: string, session: string): Promise<void> {
  await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'iso', '--issue', '567'], {
    cwd: root,
    env: { SE_SESSION: session },
    reject: false,
  });
}

function bundleDir(root: string): string {
  const base = join(root, '.paqad/ledger/feature-evidence');
  const dirs = readdirSync(base).filter((name) => name !== '_session');
  return join(base, dirs[0]!);
}

describe('stage-agent-completion.mjs (issue #567)', () => {
  it('appends a context-efficiency row for a paqad stage agent and exits 0', async () => {
    const root = tempRoot();
    await openFeature(root, 'ses_it');

    const transcript = join(root, 'sub.jsonl');
    writeFileSync(
      transcript,
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'work' } }) + '\n',
      'utf8',
    );

    const payload = {
      session_id: 'sub_abc',
      transcript_path: transcript,
      agent_id: 'agent_it',
      agent_type: 'paqad-development',
      hook_event_name: 'SubagentStop',
    };

    const result = await execa('node', [HOOK], {
      input: JSON.stringify(payload),
      env: { PAQAD_PROJECT_ROOT: root },
      reject: false,
    });
    expect(result.exitCode).toBe(0);

    const stream = join(bundleDir(root), 'context-efficiency.jsonl');
    expect(existsSync(stream)).toBe(true);
    const rows = readFileSync(stream, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe('development');
    expect(rows[0].agent_id).toBe('agent_it');
    expect(rows[0].orchestrator_session_id).toBe('ses_it');
  });

  it('exits 0 on the documented Claude fixture even with no active feature (never blocks)', async () => {
    const root = tempRoot();
    const fixture = readFileSync(
      join(process.cwd(), 'tests/fixtures/hooks/claude/subagent-stop.json'),
      'utf8',
    );
    const result = await execa('node', [HOOK], {
      input: fixture,
      env: { PAQAD_PROJECT_ROOT: root },
      reject: false,
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 on the documented Codex fixture with the host argv (never blocks)', async () => {
    const root = tempRoot();
    const fixture = readFileSync(
      join(process.cwd(), 'tests/fixtures/hooks/codex/subagent-stop.json'),
      'utf8',
    );
    const result = await execa('node', [HOOK, 'codex-cli'], {
      input: fixture,
      env: { PAQAD_PROJECT_ROOT: root },
      reject: false,
    });
    expect(result.exitCode).toBe(0);
  });
});
