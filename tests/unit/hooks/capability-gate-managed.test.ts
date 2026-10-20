import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const GATE = resolve(process.cwd(), 'dist/kernel/gate.js');
const DECISION_PAUSE = resolve(process.cwd(), 'runtime/hooks/decision-pause-gate.mjs');
const ORG_LINE = "This rule is enforced by your organization's settings.";
const RULE_DENY = {
  block: true,
  summary: '> - 🔴 RL-1 · src/x.ts — no comments',
  narration: '',
  context: '',
};

describe('runtime/hooks/capability-gate.mjs on the managed route', () => {
  let projectRoot: string;
  let stderr: string;
  const seen: unknown[] = [];
  const saved: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string | undefined): void {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  function disableEverywhere(): void {
    setEnv('PAQAD_DISABLED', '1');
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-capgate-managed-'));
    setEnv('CLAUDE_PROJECT_DIR', projectRoot);
    setEnv('CLAUDE_PLUGIN_ROOT', undefined);
    setEnv('PAQAD_MANAGED', undefined);
    setEnv('PAQAD_DISABLED', undefined);
    stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    });
    vi.resetModules();
    seen.length = 0;
    vi.doMock(GATE, () => ({
      runCapabilityGate: async (input: unknown) => {
        seen.push(input);
        return RULE_DENY;
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock(GATE);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      delete saved[key];
    }
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('ends the block message with the organization line', async () => {
    setEnv('PAQAD_MANAGED', '1');
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(await main('{}', 'pre-mutation')).toBe(2);
    expect(stderr).toBe(`${RULE_DENY.summary}\n${ORG_LINE}\n`);
  });

  it('hands the tool use id and tool input to the kernel gate', async () => {
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    const input = { session_id: 's', tool_use_id: 'tu_1', tool_input: { content: 'x' } };
    await main(JSON.stringify(input), 'pre-mutation');
    expect(seen[0]).toMatchObject({
      payload: { sessionId: 's', toolUseId: 'tu_1', toolInput: { content: 'x' } },
    });
  });

  it('adds no organization line off the managed route', async () => {
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(await main('{}', 'pre-mutation')).toBe(2);
    expect(stderr).toBe(`${RULE_DENY.summary}\n`);
  });

  it('AC-12: still blocks a rule-script deny when PAQAD_DISABLED and paqad_enable=false are set', async () => {
    disableEverywhere();
    setEnv('PAQAD_MANAGED', '1');
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(await main('{}', 'pre-mutation')).toBe(2);
    expect(stderr.trimEnd().endsWith(ORG_LINE)).toBe(true);
  });

  it('stands down off the managed route when paqad is turned off', async () => {
    disableEverywhere();
    const { main } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(await main('{}', 'pre-mutation')).toBe(0);
    expect(stderr).toBe('');
  });
});

describe('runtime/hooks/decision-pause-gate.mjs on the managed route', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-dpg-managed-'));
    mkdirSync(join(projectRoot, '.paqad/decisions/pending'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/decisions/pending/D-x.json'), '{}');
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function run(env: NodeJS.ProcessEnv): number | null {
    return spawnSync(process.execPath, [DECISION_PAUSE], {
      input: JSON.stringify({ cwd: projectRoot }),
      env: { PATH: process.env.PATH, PAQAD_DISABLED: '1', ...env },
    }).status;
  }

  it('keeps blocking a pending decision when paqad is turned off', () => {
    expect(run({ PAQAD_MANAGED: '1' })).toBe(2);
  });

  it('stands down off the managed route when paqad is turned off', () => {
    expect(run({})).toBe(0);
  });
});
