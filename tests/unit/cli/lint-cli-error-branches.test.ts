import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ error: null as unknown, result: null as unknown }));

function maybeThrow(): void {
  if (state.error !== null) throw state.error;
}

vi.mock('@/authoring/lint/audit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/authoring/lint/audit.js')>();
  return {
    ...actual,
    runAudit: (...args: Parameters<typeof actual.runAudit>) => {
      maybeThrow();
      return actual.runAudit(...args);
    },
  };
});

vi.mock('@/authoring/lint/audit-report.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/authoring/lint/audit-report.js')>();
  return {
    ...actual,
    writeAuditDoc: (...args: Parameters<typeof actual.writeAuditDoc>) => {
      maybeThrow();
      return actual.writeAuditDoc(...args);
    },
  };
});

vi.mock('@/authoring/lint/skill-lint.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/authoring/lint/skill-lint.js')>();
  return {
    ...actual,
    lintSkillFolder: (...args: Parameters<typeof actual.lintSkillFolder>) => {
      maybeThrow();
      return state.result ?? actual.lintSkillFolder(...args);
    },
  };
});

vi.mock('@/authoring/lint/agent-lint.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/authoring/lint/agent-lint.js')>();
  return {
    ...actual,
    lintAgentInProject: (...args: Parameters<typeof actual.lintAgentInProject>) => {
      maybeThrow();
      return state.result ?? actual.lintAgentInProject(...args);
    },
  };
});

const { AuditUsageError } = await import('@/authoring/lint/audit.js');
const { AgentLintUsageError } = await import('@/authoring/lint/agent-lint.js');
const { NeverWriteListError } = await import('@/authoring/lint/never-write.js');
const { SkillLintUsageError } = await import('@/authoring/lint/skill-lint.js');
const { createAgentCommand } = await import('@/cli/commands/agent.js');
const { createSkillCommand } = await import('@/cli/commands/skill.js');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-lint-cli-errors-'));
  mkdirSync(join(root, 'home'), { recursive: true });
  vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', undefined);
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code' }),
  );
  state.error = null;
  state.result = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  state.error = null;
  state.result = null;
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

async function run(
  command: 'skill' | 'agent',
  ...args: string[]
): Promise<{ out: string; err: string; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    out.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    err.push(String(line));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
  try {
    const cli = command === 'skill' ? createSkillCommand() : createAgentCommand();
    await cli.parseAsync([...args, '--project-root', root], { from: 'user' });
  } finally {
    vi.restoreAllMocks();
  }
  return { out: out.join('\n'), err: err.join('\n'), code: Number(process.exitCode ?? 0) };
}

const usageErrors = (extra: unknown) => [
  new AuditUsageError('audit usage'),
  new NeverWriteListError('never write'),
  extra,
];

describe('lint --all usage errors', () => {
  it('skill lint --all prints each usage error and exits 2', async () => {
    for (const error of usageErrors(new SkillLintUsageError('skill usage'))) {
      state.error = error;
      const result = await run('skill', 'lint', '--all');
      expect(result.code).toBe(2);
      expect(result.err).toContain('skill lint: ');
    }
  });

  it('agent lint --all prints each usage error and exits 2', async () => {
    for (const error of usageErrors(new AgentLintUsageError('agent usage'))) {
      state.error = error;
      const result = await run('agent', 'lint', '--all');
      expect(result.code).toBe(2);
      expect(result.err).toContain('agent lint: ');
    }
  });

  it('lets an unexpected error through from both --all paths and the audit page', async () => {
    state.error = new TypeError('boom');
    await expect(run('skill', 'lint', '--all')).rejects.toThrow('boom');
    await expect(run('agent', 'lint', '--all')).rejects.toThrow('boom');
    await expect(run('skill', 'audit', '--as-of', '2026-11-01')).rejects.toThrow('boom');
    await expect(run('skill', 'lint', join(root, 'x'))).rejects.toThrow('boom');
    await expect(run('agent', 'lint', join(root, 'x.md'))).rejects.toThrow('boom');
  });

  it('refuses a file together with --all', async () => {
    write('a.md', 'x');
    const agent = await run('agent', 'lint', 'a.md', '--all');
    expect(agent.code).toBe(2);
    expect(agent.err).toContain('not both');
    const skill = await run('skill', 'lint', 'a', '--all');
    expect(skill.code).toBe(2);
    expect(skill.err).toContain('not both');
  });

  it('skill audit reports a never-write list error as a usage error', async () => {
    state.error = new NeverWriteListError('never write');
    const result = await run('skill', 'audit', '--as-of', '2026-11-01');
    expect(result.code).toBe(2);
    expect(result.err).toContain('skill audit: never write');
  });
});

describe('single-file lint branches', () => {
  it('skill lint reports a never-write list error and prints JSON or singular counts', async () => {
    state.error = new NeverWriteListError('never write');
    expect((await run('skill', 'lint', join(root, 'x'))).err).toContain('skill lint: never write');
    state.error = null;
    state.result = {
      skill: 's',
      blocking: 1,
      warnings: 1,
      findings: [
        { rule: 'SK-001', severity: 'block', file: 'SKILL.md', line: 1, message: 'm' },
        { rule: 'SK-004', severity: 'warn', file: 'SKILL.md', line: 2, message: 'n' },
      ],
    };
    const text = await run('skill', 'lint', join(root, 'x'));
    expect(text.out).toContain('1 blocking finding, 1 warning.');
    const json = await run('skill', 'lint', join(root, 'x'), '--json');
    expect(json.out).toContain('"SK-001"');
    state.result = { skill: 's', blocking: 0, warnings: 1, findings: [] };
    expect((await run('skill', 'lint', join(root, 'x'))).out).toContain('(1 warning)');
  });

  it('agent lint refuses owner powers without --all and prints a finding list', async () => {
    write('a.md', 'x');
    const refused = await run('agent', 'lint', 'a.md', '--owner-powers-as-warnings');
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('needs --all');
    state.result = {
      agent: 'a',
      blocking: 1,
      warnings: 0,
      findings: [{ rule: 'AG-001', severity: 'block', file: 'a.md', line: 1, message: 'm' }],
    };
    const printed = await run('agent', 'lint', join(root, 'a.md'));
    expect(printed.out).toContain('AG-001 block a.md:1 m');
    expect(printed.out).toContain('1 blocking finding, 0 warnings.');
  });
});
