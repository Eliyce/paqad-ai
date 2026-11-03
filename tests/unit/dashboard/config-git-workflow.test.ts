import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getGitWorkflowConfig,
  GitWorkflowValidationError,
  putGitWorkflowFile,
  UnknownGitWorkflowFileError,
} from '@/dashboard/config-git-workflow.js';
import { contentHash, WriteConflictError } from '@/dashboard/write-pipeline.js';
import { readLastApplied, stampLastApplied } from '@/git-workflow/last-applied.js';

const DIR = '.paqad/configs/git-workflow';

const TICKETS = `sources:
  github:
    tracker: github-issues
    pattern: "#\\\\d+"
`;

describe('dashboard git-workflow config', () => {
  let root: string;

  function write(file: string, content: string): void {
    mkdirSync(join(root, DIR), { recursive: true });
    writeFileSync(join(root, DIR, file), content);
  }

  function read(file: string): string {
    return readFileSync(join(root, DIR, file), 'utf8');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dashboard-git-workflow-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns every file with its hash, the resolved rules and the schemas', () => {
    write('commits.yaml', 'sign_off: true\n');
    const config = getGitWorkflowConfig(root);

    expect(config.files).toHaveLength(5);
    const commits = config.files.find((file) => file.name === 'commits.yaml')!;
    expect(commits).toMatchObject({
      exists: true,
      content: 'sign_off: true\n',
      hash: contentHash('sign_off: true\n'),
      path: `${DIR}/commits.yaml`,
    });
    expect(config.files.find((file) => file.name === 'tickets.yaml')!.exists).toBe(false);
    expect(config.resolved.commits.sign_off).toBe(true);
    expect(config.errors).toEqual([]);
    expect(Object.keys(config.schemas)).toContain('pull-requests.yaml');
    expect(config.changedOutside).toEqual(['commits.yaml']);
  });

  it('reports errors and unknown-key warnings', () => {
    write('enforcement.yaml', 'agents: sometimes\ncolour: blue\n');
    const config = getGitWorkflowConfig(root);
    expect(config.errors.some((issue) => issue.file === 'enforcement.yaml')).toBe(true);
    expect(config.warnings.some((issue) => issue.path === 'colour')).toBe(true);
  });

  it('writes only the saved file, audits it and stamps .last-applied.json (AC-43)', () => {
    write('tickets.yaml', TICKETS);
    write('commits.yaml', 'sign_off: false\n');
    stampLastApplied(root);

    const result = putGitWorkflowFile(root, 'commits.yaml', {
      content: 'sign_off: true\n',
      baseHash: contentHash('sign_off: false\n'),
    });

    expect(result.path).toBe(`${DIR}/commits.yaml`);
    expect(result.resolved.commits.sign_off).toBe(true);
    expect(read('commits.yaml')).toBe('sign_off: true\n');
    expect(read('tickets.yaml')).toBe(TICKETS);
    expect(readFileSync(join(root, '.paqad/audit.log'), 'utf8')).toContain(
      'dashboard.config.git-workflow.write',
    );
    expect(getGitWorkflowConfig(root).changedOutside).toEqual([]);
    expect(readLastApplied(root)?.files['commits.yaml']).toBeDefined();
  });

  it('creates a missing file when the base hash is null', () => {
    putGitWorkflowFile(root, 'branches.yaml', { content: 'base_branch: main\n', baseHash: null });
    expect(read('branches.yaml')).toBe('base_branch: main\n');
  });

  it('rejects a cross-file error and writes nothing (AC-43)', () => {
    write('tickets.yaml', TICKETS);
    const content = 'types:\n  feature:\n    tickets: [jira]\n';

    let caught: unknown;
    try {
      putGitWorkflowFile(root, 'branches.yaml', { content, baseHash: null });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitWorkflowValidationError);
    expect((caught as GitWorkflowValidationError).issues[0]?.path).toBe('types.feature.tickets');
    expect(existsSync(join(root, DIR, 'branches.yaml'))).toBe(false);
  });

  it('rejects a schema error in the saved file', () => {
    expect(() =>
      putGitWorkflowFile(root, 'enforcement.yaml', { content: 'people: maybe\n', baseHash: null }),
    ).toThrow(GitWorkflowValidationError);
    expect(() =>
      putGitWorkflowFile(root, 'commits.yaml', { content: 'a: [\n', baseHash: null }),
    ).toThrow(GitWorkflowValidationError);
  });

  it('lets a file be saved while another file is already broken', () => {
    write('enforcement.yaml', 'agents: sometimes\n');
    putGitWorkflowFile(root, 'commits.yaml', { content: 'sign_off: true\n', baseHash: null });
    expect(read('commits.yaml')).toBe('sign_off: true\n');
  });

  it('refuses unknown file names and stale base hashes', () => {
    expect(() =>
      putGitWorkflowFile(root, '../profile.yaml', { content: 'a: 1\n', baseHash: null }),
    ).toThrow(UnknownGitWorkflowFileError);

    write('commits.yaml', 'sign_off: false\n');
    expect(() =>
      putGitWorkflowFile(root, 'commits.yaml', { content: 'sign_off: true\n', baseHash: null }),
    ).toThrow(WriteConflictError);
  });
});
