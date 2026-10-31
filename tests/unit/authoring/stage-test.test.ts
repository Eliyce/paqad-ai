import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSkillTest } from '@/authoring/stages/test.js';
import { CONTRACT_CHECKS } from '@/authoring/tests/script-contract.js';
import { renderGateMarkdown, SkillWorkspace } from '@/authoring/workspace.js';
import { readContractDecisions, resolvePendingDecision } from '@/decisions/authoring.js';

const NAME = 'processing-invoices';
const SKILL = [
  '---',
  `name: ${NAME}`,
  'description: Parses supplier invoices. Use when an invoice arrives.',
  '---',
  '# Processing invoices',
  '',
  '1. Run scripts/extract.ts on the invoice.',
  '',
  'Read references/guide.md when a field is missing.',
  '',
  '## Gotchas',
  '',
  'Soft-deleted invoices stay in the table.',
  '',
].join('\n');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-test-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({ project: { name: 'x', id: 'x' }, commands: { test: 'npm test' } }),
  );
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function workspaceAtS4(script = '// --help\nexport {};\n'): SkillWorkspace {
  const workspace = new SkillWorkspace(root, NAME);
  workspace.write('justification.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
  workspace.write('intake.yaml', 'purpose: x\n');
  workspace.write('overlap.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
  workspace.write('trace.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
  workspace.write(`draft/${NAME}/SKILL.md`, SKILL);
  workspace.write(`draft/${NAME}/references/guide.md`, 'verified: 2026-10-31\n\nLabel by area.\n');
  workspace.write(`draft/${NAME}/scripts/extract.ts`, script);
  return workspace;
}

function allTests(): void {
  write(
    `tests/skills/${NAME}/extract.test.ts`,
    CONTRACT_CHECKS.map((check) => `it('extract ${check}', () => {});`).join('\n'),
  );
}

describe('paqad-ai skill test (S4)', () => {
  it('AC-27: runs the project test command and records the seven checks per script', async () => {
    allTests();
    const workspace = workspaceAtS4();
    const runTests = vi.fn(async () => ({ exitCode: 0, failedTests: null }));
    const result = await runSkillTest(workspace, { runTests });
    expect(result.ok).toBe(true);
    expect(runTests).toHaveBeenCalledWith('npm test', root);
    const report = JSON.parse(readFileSync(workspace.path('script-tests.json'), 'utf8'));
    expect(report.gate).toBe('passed');
    expect(report.test_location).toBe(`tests/skills/${NAME}`);
    expect(report.inputs_hash).toMatch(/^sha256:/);
    expect(report.scripts[0].checks).toHaveLength(7);
    expect(report.scripts[0].checks[0]).toEqual({
      check: 'help',
      status: 'passed',
      test: 'extract help',
    });
  });

  it('AC-26, AC-4: a script with no test file blocks at the lint before any test runs', async () => {
    const workspace = workspaceAtS4();
    const runTests = vi.fn(async () => ({ exitCode: 0, failedTests: null }));
    const result = await runSkillTest(workspace, { runTests });
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain(
      'SK-010 scripts/extract.ts:1 The script scripts/extract.ts has no test file',
    );
    expect(runTests).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(workspace.path('lint.json'), 'utf8')).gate).toBe('failed');
  });

  it('a failing test run fails the gate', async () => {
    allTests();
    const result = await runSkillTest(workspaceAtS4(), {
      runTests: async () => ({ exitCode: 1, failedTests: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toContain('a script contract check did not pass');
  });

  it('AC-58: a network call raises authoring.risky_script before any script runs, and an edit asks again', async () => {
    allTests();
    const workspace = workspaceAtS4('// --help\nawait fetch("https://api.example.test");\n');
    const runTests = vi.fn(async () => ({ exitCode: 0, failedTests: null }));
    const first = await runSkillTest(workspace, { runTests });
    expect(first.decision).toBeDefined();
    expect(runTests).not.toHaveBeenCalled();
    const packet = readContractDecisions(root).find(
      (row) => row.packet.id === first.decision,
    )!.packet;
    expect(packet.category).toBe('authoring.risky_script');
    expect(packet.recommendation).toBe('remove');

    resolvePendingDecision(root, first.decision!, 'allow', 'owner');
    const allowed = await runSkillTest(workspace, { runTests });
    expect(allowed.ok).toBe(true);
    expect(runTests).toHaveBeenCalledTimes(1);

    workspace.write(
      `draft/${NAME}/scripts/extract.ts`,
      '// --help\nawait fetch("https://other.example.test");\n',
    );
    const edited = await runSkillTest(workspace, { runTests });
    expect(edited.decision).toBeDefined();
    expect(edited.decision).not.toBe(first.decision);
    expect(runTests).toHaveBeenCalledTimes(1);
  });

  it('refuses to run once the owner chose to remove the risky part', async () => {
    allTests();
    const workspace = workspaceAtS4('// --help\nexecSync("npm install left-pad");\n');
    const first = await runSkillTest(workspace, {
      runTests: async () => ({ exitCode: 0, failedTests: null }),
    });
    resolvePendingDecision(root, first.decision!, 'remove', 'owner');
    await expect(runSkillTest(workspace)).rejects.toThrow('chose to remove the risky part');
  });

  it('AC-28: a reference check failure fails the gate with file and line', async () => {
    allTests();
    const workspace = workspaceAtS4();
    workspace.write(
      `draft/${NAME}/references/guide.md`,
      'verified: 2026-10-31\n\nRead `app/Missing.php`.\n',
    );
    const result = await runSkillTest(workspace, {
      runTests: async () => ({ exitCode: 0, failedTests: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe(
      'reference references/guide.md:3 The path app/Missing.php does not exist. Fix it or mark it external.',
    );
  });

  it('refuses before S3 has passed', async () => {
    const workspace = new SkillWorkspace(root, NAME);
    await expect(runSkillTest(workspace)).rejects.toThrow("S4 lint and tests can't start");
  });
});
