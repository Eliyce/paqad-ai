import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../../../runtime/hooks/capability-gate.mjs');
const MAP_REL = 'docs/instructions/rules/rule-script-map.yml';
const SEAMS = ['pre-mutation', 'completion'] as const;

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(projectRoot: string, seam: string, env: NodeJS.ProcessEnv = {}): RunResult {
  try {
    const stdout = execFileSync('node', [HOOK, seam], {
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

describe('runtime/hooks/capability-gate.mjs (gating fast-paths)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-capgate-hook-'));
    mkdirSync(join(projectRoot, '.paqad/configs'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/configs/.config.policy'), 'stages_mode=off\n');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  for (const seam of SEAMS) {
    it(`[${seam}] exits 0 silently when the project has no rule-script map (no dist import)`, () => {
      const result = run(projectRoot, seam, { PAQAD_RULE_COMPLIANCE: 'strict' });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
    });

    it(`[${seam}] exits 0 when paqad is disabled, even with a rule-script map present`, () => {
      mkdirSync(join(projectRoot, 'docs/instructions/rules'), { recursive: true });
      writeFileSync(join(projectRoot, MAP_REL), 'schema_version: 1\nrules: []\n');
      writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
      const result = run(projectRoot, seam, { PAQAD_RULE_COMPLIANCE: 'strict' });
      expect(result.status).toBe(0);
    });

    it(`[${seam}] exits 0 when the team floors rule_compliance to off (the committed disable path)`, () => {
      mkdirSync(join(projectRoot, 'docs/instructions/rules'), { recursive: true });
      writeFileSync(join(projectRoot, MAP_REL), 'schema_version: 1\nrules: []\n');
      mkdirSync(join(projectRoot, '.paqad/configs'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.paqad/configs/.config.policy'),
        'rule_compliance=off\nstages_mode=off\n',
      );
      const result = run(projectRoot, seam);
      expect(result.status).toBe(0);
    });
  }

  it('defaults to the pre-mutation seam when no seam argv is given', () => {
    const result = run(projectRoot, '', { PAQAD_RULE_COMPLIANCE: 'strict' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});

const DIST_GATE = resolve(__dirname, '../../../dist/kernel/gate.js');
const hasDist = existsSync(DIST_GATE);

function runWithPayload(
  projectRoot: string,
  seam: string,
  payload: unknown,
  env: NodeJS.ProcessEnv = {},
): RunResult {
  try {
    const stdout = execFileSync('node', [HOOK, seam], {
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
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

describe.skipIf(!hasDist)(
  'runtime/hooks/capability-gate.mjs — no PreToolUse systemMessage leak',
  () => {
    let projectRoot: string;
    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), 'paqad-capgate-leak-'));
      mkdirSync(join(projectRoot, '.paqad/configs'), { recursive: true });
    });
    afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

    it('a WARN missing-stage finding on a feature-dev edit allows (exit 0) and writes NO systemMessage (INV-1)', () => {
      writeFileSync(join(projectRoot, '.paqad/configs/.config.policy'), 'stages_mode=warn\n');
      const result = runWithPayload(projectRoot, 'pre-mutation', {
        session_id: 'ses_leak',
        tool_name: 'Edit',
        tool_input: { file_path: join(projectRoot, 'src/x.ts') },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('systemMessage');
      expect(result.stdout).toBe('');
    });
  },
);

describe('runtime/hooks/capability-gate.mjs — the allowed-once ask', () => {
  const REASON =
    'You allowed this edit once in the paqad HUD, and paqad recorded the override. Approve to run it.';

  it('AC-11: writes one PreToolUse ask line with the reason on the Claude Code route', async () => {
    const { preToolUseAsk } = await import('../../../runtime/hooks/capability-gate.mjs');
    const line = preToolUseAsk(
      { block: false, ask: REASON, context: '' },
      'pre-mutation',
      undefined,
    );
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: REASON,
      },
    });
  });

  it('AC-11: carries the additional context when the gate has some', async () => {
    const { preToolUseAsk } = await import('../../../runtime/hooks/capability-gate.mjs');
    const line = preToolUseAsk(
      { block: false, ask: REASON, context: 'screenshots due' },
      'pre-mutation',
      undefined,
    );
    expect(JSON.parse(line).hookSpecificOutput).toMatchObject({
      permissionDecision: 'ask',
      additionalContext: 'screenshots due',
    });
  });

  it('AC-11, INV-9: answers nothing on another seam, another adapter or a result with no ask, so the hook keeps exit 2', async () => {
    const { preToolUseAsk } = await import('../../../runtime/hooks/capability-gate.mjs');
    expect(preToolUseAsk({ ask: REASON }, 'completion', undefined)).toBeNull();
    expect(preToolUseAsk({ ask: REASON }, 'pre-mutation', 'codex-cli')).toBeNull();
    expect(preToolUseAsk({ ask: '' }, 'pre-mutation', undefined)).toBeNull();
    expect(preToolUseAsk({ block: false }, 'pre-mutation', undefined)).toBeNull();
    expect(preToolUseAsk(undefined, 'pre-mutation', undefined)).toBeNull();
  });

  it('AC-11: the hook writes the ask only on that route and falls back to exit 2 otherwise', () => {
    const source = readFileSync(HOOK, 'utf8');
    const start = source.indexOf('    if (result.ask) {');
    expect(start).toBeGreaterThan(source.indexOf('    if (result.block) {'));
    const branch = source.slice(start, source.indexOf('\n    }\n', start));
    expect(branch).toContain('const answer = preToolUseAsk(result, seam, ADAPTER);');
    expect(branch).toContain('if (answer === null) {');
    expect(branch.indexOf('return 2;')).toBeLessThan(
      branch.indexOf('process.stdout.write(answer)'),
    );
    expect(branch).toContain('process.stdout.write(answer);\n      return 0;');
  });
});
