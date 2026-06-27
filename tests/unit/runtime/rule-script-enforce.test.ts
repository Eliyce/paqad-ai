import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../../../runtime/hooks/rule-script-enforce.mjs');
const MAP_REL = 'docs/instructions/rules/rule-script-map.yml';

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(projectRoot: string, env: NodeJS.ProcessEnv = {}): RunResult {
  try {
    const stdout = execFileSync('node', [HOOK], {
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

describe('runtime/hooks/rule-script-enforce.mjs (gating fast-paths)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-enforce-hook-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('exits 0 silently when the project has no rule-script map (no dist import)', () => {
    const result = run(projectRoot, { PAQAD_RULE_COMPLIANCE: 'strict' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 when paqad is disabled, even with a rule-script map present', () => {
    mkdirSync(join(projectRoot, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(join(projectRoot, MAP_REL), 'schema_version: 1\nrules: []\n');
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    const result = run(projectRoot, { PAQAD_RULE_COMPLIANCE: 'strict' });
    expect(result.status).toBe(0);
  });

  it('exits 0 when rule_compliance is off', () => {
    mkdirSync(join(projectRoot, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(join(projectRoot, MAP_REL), 'schema_version: 1\nrules: []\n');
    const result = run(projectRoot, { PAQAD_RULE_COMPLIANCE: 'off' });
    expect(result.status).toBe(0);
  });
});
