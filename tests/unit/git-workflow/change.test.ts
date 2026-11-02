import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChange, runCheck, runShow } from '@/cli/commands/git-workflow.js';
import { PATHS } from '@/core/constants/paths.js';
import { parseEdits } from '@/git-workflow/change.js';
import { renderDefaultGitWorkflowFile } from '@/git-workflow/defaults.js';
import { changedOutside, readLastApplied, stampLastApplied } from '@/git-workflow/last-applied.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';

let root: string;
const dir = () => join(root, PATHS.GIT_WORKFLOW_DIR);
const read = (file: string) => readFileSync(join(dir(), file), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-wf-change-'));
  mkdirSync(dir(), { recursive: true });
  for (const file of GIT_WORKFLOW_FILES) {
    writeFileSync(join(dir(), file), renderDefaultGitWorkflowFile(file, { version: '1.0.0' }));
  }
  stampLastApplied(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function change(edits: unknown[]): string {
  writeFileSync(join(root, 'change.json'), JSON.stringify({ edits }));
  return 'change.json';
}

describe('git-workflow change', () => {
  it('--plan prints a diff and writes nothing', () => {
    const before = read('enforcement.yaml');
    const result = runChange(
      root,
      change([{ file: 'enforcement.yaml', path: ['people'], value: 'block' }]),
      false,
    );
    expect(result.exitCode).toBe(0);
    const plan = JSON.parse(result.stdout);
    expect(plan.valid).toBe(true);
    expect(plan.diff).toContain('-people: warn\n+people: block\n');
    expect(read('enforcement.yaml')).toBe(before);
  });

  it('--apply writes with comments and key order kept, and stamps .last-applied.json', () => {
    const file = change([
      {
        file: 'branches.yaml',
        path: ['types', 'hotfix'],
        value: { prefix: 'hotfix', commit_type: 'fix', base_branch: 'main' },
      },
      { file: 'pull-requests.yaml', path: ['also_open_against'], value: ['qa'] },
    ]);
    const result = runChange(root, file, true);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).written).toEqual(['branches.yaml', 'pull-requests.yaml']);
    const before = renderDefaultGitWorkflowFile('pull-requests.yaml', { version: '1.0.0' });
    expect(read('pull-requests.yaml')).toBe(
      before.replace('also_open_against: []', 'also_open_against: [qa]'),
    );
    expect(read('branches.yaml')).toContain('# The type used when nothing else decides it.');
    expect(changedOutside(root)).toEqual([]);
  });

  it('value null removes a branch type or ticket source, and is an error for any other key', () => {
    const removed = runChange(
      root,
      change([{ file: 'branches.yaml', path: ['types', 'hotfix'], value: null }]),
      true,
    );
    expect(removed.exitCode).toBe(0);
    expect(read('branches.yaml')).not.toContain('hotfix');
    const refused = runChange(
      root,
      change([{ file: 'commits.yaml', path: ['sign_off'], value: null }]),
      true,
    );
    expect(refused.exitCode).toBe(1);
    expect(JSON.parse(refused.stdout).error).toContain('value null only removes');
  });

  it('refuses with exit 1 and writes nothing when the result is invalid', () => {
    const before = read('branches.yaml');
    const result = runChange(
      root,
      change([{ file: 'branches.yaml', path: ['default_type'], value: 'nope' }]),
      true,
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).valid).toBe(false);
    expect(read('branches.yaml')).toBe(before);
  });

  it('rejects malformed edits', () => {
    expect(() => parseEdits({})).toThrow('"edits" list');
    expect(() => parseEdits({ edits: [{ file: 'x.yaml', path: ['a'], value: 1 }] })).toThrow(
      'file must be one of',
    );
    expect(() => parseEdits({ edits: [{ file: 'commits.yaml', path: [], value: 1 }] })).toThrow(
      'non-empty list',
    );
  });
});

describe('git-workflow check and show', () => {
  it('lists a hand-edited file as changed_outside, and --accept restamps it', () => {
    writeFileSync(join(dir(), 'commits.yaml'), `${read('commits.yaml')}# a note\n`);
    const checked = JSON.parse(runCheck(root, false).stdout);
    expect(checked.changed_outside).toEqual(['commits.yaml']);
    const accepted = runCheck(root, true);
    expect(accepted.exitCode).toBe(0);
    expect(JSON.parse(accepted.stdout).accepted).toBe(true);
    expect(changedOutside(root)).toEqual([]);
    expect(readLastApplied(root)?.files['commits.yaml']).toBeTruthy();
  });

  it('--accept refuses an invalid config', () => {
    writeFileSync(join(dir(), 'branches.yaml'), 'default_type: nope\n');
    const accepted = runCheck(root, true);
    expect(accepted.exitCode).toBe(1);
    expect(JSON.parse(accepted.stdout).accepted).toBe(false);
  });

  it('show prints the resolved config as YAML and exits 1 when invalid', () => {
    const shown = runShow(root);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain('config:');
    expect(shown.stdout).toContain('people: warn');
    writeFileSync(join(dir(), 'branches.yaml'), 'default_type: nope\n');
    expect(runShow(root).exitCode).toBe(1);
  });
});
