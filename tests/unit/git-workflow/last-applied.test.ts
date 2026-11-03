import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  changedOutside,
  hashText,
  readLastApplied,
  stampLastApplied,
} from '@/git-workflow/last-applied.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-last-applied-'));
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (file: string, text: string) =>
  writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, file), text);

describe('.last-applied.json', () => {
  it('stamps the time, the version and a sha256 per present file (AC-39)', () => {
    put('commits.yaml', 'template: "{summary}"\n');
    stampLastApplied(root, undefined, {
      now: () => new Date('2026-11-02T00:00:00Z'),
      version: '9.9.9',
    });
    expect(readLastApplied(root)).toEqual({
      applied_at: '2026-11-02T00:00:00.000Z',
      paqad_version: '9.9.9',
      files: { 'commits.yaml': hashText('template: "{summary}"\n') },
    });
  });

  it('lists a file changed after the stamp, and a file never stamped, as changed outside (AC-39)', () => {
    put('commits.yaml', 'a: 1\n');
    stampLastApplied(root, ['commits.yaml']);
    expect(changedOutside(root)).toEqual([]);
    put('commits.yaml', 'a: 2\n');
    put('branches.yaml', 'b: 1\n');
    expect(changedOutside(root)).toEqual(['branches.yaml', 'commits.yaml']);
  });

  it('restamps only the files it is given and keeps the other hashes', () => {
    put('commits.yaml', 'a: 1\n');
    put('branches.yaml', 'b: 1\n');
    stampLastApplied(root);
    put('branches.yaml', 'b: 2\n');
    put('commits.yaml', 'a: 2\n');
    stampLastApplied(root, ['commits.yaml']);
    expect(changedOutside(root)).toEqual(['branches.yaml']);
  });
});
