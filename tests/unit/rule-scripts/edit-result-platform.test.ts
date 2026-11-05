import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { judgeEditResult } from '@/rule-scripts/edit-result.js';

const platform = vi.hoisted(() => ({ sep: '/', linkError: null as Error | null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const symlinkSync = (...args: Parameters<typeof actual.symlinkSync>): void => {
    if (platform.linkError) throw platform.linkError;
    actual.symlinkSync(...args);
  };
  return { ...actual, default: { ...actual, symlinkSync }, symlinkSync };
});

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    default: actual,
    get sep() {
      return platform.sep;
    },
  };
});

vi.mock('@/rule-scripts/enforce.js', () => ({
  projectRelativeTargets: (_root: string, targets: string[]) => targets,
}));

const BODY = 'debugger;\n';
const roots: string[] = [];

function judge(root: string, rel: string) {
  return judgeEditResult({
    projectRoot: root,
    targets: [rel],
    toolName: 'Write',
    toolInput: { file_path: join(root, rel), content: '' },
    violations: [
      { script: 'gate.mjs', rule_id: 'R', file: rel, line: 1, message: 'm', severity: 'blocker' },
    ],
    concurrency: 1,
    signal: new AbortController().signal,
  });
}

function projectWith(rel: string): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-edit-platform-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, rel), BODY, 'utf8');
  return root;
}

afterEach(() => {
  platform.sep = '/';
  platform.linkError = null;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('AC-83: the comparison stays out of a path it cannot lay out', () => {
  it('leaves the edit to the rule message when the platform separator is not a slash', async () => {
    platform.sep = '\\';
    const root = projectWith('src/app.ts');
    await expect(judge(root, 'src/app.ts')).resolves.toEqual({ allowed: false, reason: null });
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe(BODY);
  });

  it('leaves the edit to the rule message when the target has a backslash', async () => {
    const rel = 'src\\app.ts';
    const root = projectWith(rel);
    await expect(judge(root, rel)).resolves.toEqual({ allowed: false, reason: null });
    expect(readFileSync(join(root, rel), 'utf8')).toBe(BODY);
  });
});

describe.skipIf(process.platform === 'win32')('AC-83: a throw while linking the overlay', () => {
  it('leaves no temporary project behind', async () => {
    const root = projectWith('src/app.ts');
    writeFileSync(join(root, 'src/other.ts'), BODY, 'utf8');
    const scratch = mkdtempSync(join(tmpdir(), 'paqad-edit-platform-scratch-'));
    roots.push(scratch);
    platform.linkError = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    const before = process.env.TMPDIR;
    process.env.TMPDIR = scratch;
    try {
      await expect(judge(root, 'src/app.ts')).rejects.toThrow('EEXIST');
    } finally {
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
    }
    expect(readdirSync(scratch)).toEqual([]);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe(BODY);
  });
});
