import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Buildout F3 — the capability-kernel host seam. These exercise the hook's
// dist-less fast-paths (paqad disabled, no rule-script map, rule_compliance off),
// which must all exit 0 silently WITHOUT importing the dist build, on both the
// pre-mutation and completion seams. (The real enforcement path is covered by the
// dist-side tests/unit/kernel/gate.test.ts.)

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
    // These assert the rule-scripts DIST-LESS fast-skip. The stages capability is
    // also pre-mutation and default-strict, which would make seamHasWork true (and
    // import dist), so float it off here — stages has its own suite.
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
