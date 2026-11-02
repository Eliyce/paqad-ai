import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HealthChecker } from '@/health/checker.js';
import { gitWorkflowHealth } from '@/health/git-workflow-check.js';
import { stampLastApplied } from '@/git-workflow/last-applied.js';

const DIR = '.paqad/configs/git-workflow';
const roots: string[] = [];

function project(files: Record<string, string> = {}, options: { git?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-git-workflow-doctor-'));
  roots.push(root);
  if (options.git) execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, DIR), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(root, DIR, file), content, 'utf8');
  }
  stampLastApplied(root);
  return root;
}

function details(root: string, hooksInstalled = (): boolean => true): string[] {
  return gitWorkflowHealth(root, hooksInstalled).map((result) => result.detail);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('doctor: git-workflow', () => {
  it('passes for a valid folder applied through the skill', () => {
    const results = gitWorkflowHealth(project({ 'commits.yaml': 'sign_off: true\n' }));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'git-workflow', status: 'pass' });
  });

  it('warns when the folder is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-git-workflow-doctor-'));
    roots.push(root);
    expect(details(root)).toEqual([
      '.paqad/configs/git-workflow/ is missing. Run paqad-ai update to create it.',
    ]);
  });

  it('prefixes each config error and reports unknown keys', () => {
    const root = project({ 'enforcement.yaml': 'agents: sometimes\ncolour: blue\n' });
    const found = details(root);
    expect(found.some((detail) => detail.startsWith('git-workflow: enforcement.yaml'))).toBe(true);
    expect(found).toContain(
      "enforcement.yaml has a setting paqad doesn't know: colour. It may be from a newer paqad or a typo.",
    );
  });

  it('warns when the old delivery policy is still there', () => {
    const root = project();
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/workflows/delivery-policy.yaml'),
      'enabled: true\n',
    );
    expect(details(root)).toEqual([
      'docs/instructions/workflows/delivery-policy.yaml is no longer read. Delete it.',
    ]);
  });

  it('warns when write_back_refined is not ask', () => {
    const root = project({ 'tickets.yaml': 'write_back_refined: always\n' });
    expect(details(root)).toEqual(['git-workflow: write_back_refined is set but not applied yet.']);
  });

  it('warns when people are checked but the hooks are missing', () => {
    const root = project({ 'enforcement.yaml': 'people: block\n' }, { git: true });
    expect(details(root, () => false)).toEqual([
      "git-workflow: people is set to block but the commit-msg and pre-push hooks aren't installed. Run paqad-ai update.",
    ]);
    expect(details(root, () => true)).toHaveLength(1);
    expect(gitWorkflowHealth(root, () => true)[0]?.status).toBe('pass');
  });

  it('does not ask for hooks when people is off or there is no git repo', () => {
    expect(
      gitWorkflowHealth(
        project({ 'enforcement.yaml': 'people: off\n' }, { git: true }),
        () => false,
      )[0]?.status,
    ).toBe('pass');
    expect(
      gitWorkflowHealth(project({ 'enforcement.yaml': 'people: warn\n' }), () => false)[0]?.status,
    ).toBe('pass');
  });

  it('warns about a file changed outside the skill', () => {
    const root = project({ 'branches.yaml': 'base_branch: main\n' });
    writeFileSync(join(root, DIR, 'branches.yaml'), 'base_branch: develop\n');
    expect(details(root)).toEqual([
      'git-workflow: branches.yaml was changed outside the git-workflow skill. Ask your agent to review it with the git-workflow skill.',
    ]);
  });

  it('runs as part of doctor', async () => {
    const root = project();
    const report = await new HealthChecker().run(root);
    expect(report.checks.some((check) => check.name === 'git-workflow')).toBe(true);
  });
});
