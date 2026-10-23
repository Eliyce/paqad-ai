import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readCapabilityDigest } from '@/kernel/capability-lock';
import { computeRuleScriptsDigest } from '@/rule-scripts/integrity';

const FIXTURE = resolve('evals/fixture/project');
const SCAFFOLD = resolve('evals/fixture/scaffold.sh');
const RULE_SCRIPT = '.paqad/scripts/rules/coding/architecture/001-api-never-imports-db.mjs';

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-eval-fixture-'));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyFixture(): string {
  const dir = tempDir();
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function runRule(root: string, files: string[]) {
  const result = spawnSync(process.execPath, [join(root, RULE_SCRIPT)], {
    input: JSON.stringify({ projectRoot: root, files }),
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as {
    rule_id: string;
    findings: { file: string; line: number; severity: string }[];
  };
}

function scaffold(suite: string) {
  const dir = tempDir();
  const result = spawnSync('bash', [SCAFFOLD, suite], { cwd: dir, encoding: 'utf8' });
  return { dir, result };
}

const git = (dir: string, ...args: string[]) =>
  spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
const policy = (dir: string) => readFileSync(join(dir, '.paqad/configs/.config.policy'), 'utf8');

describe('AC-19 eval fixture rule', () => {
  it('reports nothing on the clean tree', () => {
    const root = copyFixture();
    const report = runRule(root, ['src/api/users.ts', 'src/db/client.ts']);
    expect(report.rule_id).toBe('RL-569d');
    expect(report.findings).toEqual([]);
  });

  it('reports one blocker once users.ts imports from ../db/client', () => {
    const root = copyFixture();
    const users = join(root, 'src/api/users.ts');
    writeFileSync(
      users,
      `import { findUser } from '../db/client';\n${readFileSync(users, 'utf8')}`,
    );
    const report = runRule(root, ['src/api/users.ts']);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      file: 'src/api/users.ts',
      line: 1,
      severity: 'blocker',
    });
  });

  it('matches the locked rule-scripts digest', () => {
    const digest = computeRuleScriptsDigest(FIXTURE);
    expect(digest).not.toBeNull();
    expect(digest).toBe(readCapabilityDigest(FIXTURE, 'rule-scripts'));
  });
});

describe('AC-19 eval fixture scaffold', () => {
  it('makes a git repo with one commit that points at the plugin runtime', () => {
    const { dir, result } = scaffold('routing');
    expect(result.status).toBe(0);
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(dir, '.paqad/framework-path.txt'), 'utf8').trim()).toBe(
      resolve('runtime'),
    );
    expect(readFileSync(join(dir, 'src/api/users.ts'), 'utf8')).toContain('toUserDto');
  });

  it('keeps stages off for the firewall only', () => {
    expect(policy(scaffold('firewall').dir)).toContain('stages_mode=off');
    expect(policy(scaffold('routing').dir)).not.toContain('stages_mode=off');
    const receipt = policy(scaffold('receipt').dir);
    expect(receipt).not.toContain('stages_mode=off');
    expect(receipt).toContain('rule_compliance=strict');
  });

  it('rejects an unknown suite', () => {
    const { result } = scaffold('everything');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown suite 'everything'");
  });
});
