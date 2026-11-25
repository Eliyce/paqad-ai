import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readFileNoFollow, readTextNoFollow, writeFileNoFollow } from '@/core/fs/read-no-follow.js';
import { writeFolderIgnoreBlock, AGENTS_IGNORE_LINES } from '@/onboarding/gitignore-writer.js';
import { syncProjectStageAgents } from '@/onboarding/stage-agent-migration.js';

const POSIX = process.platform !== 'win32';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-no-follow-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('INV-8: paqad reads its own files through one open handle', () => {
  it('reads a regular file from the descriptor', () => {
    writeFileSync(join(root, 'a.md'), 'body\n');
    expect(readFileNoFollow(join(root, 'a.md'))).toEqual({ kind: 'file', text: 'body\n' });
    expect(readTextNoFollow(join(root, 'a.md'))).toBe('body\n');
  });

  it('reports a missing file and a folder without reading them', () => {
    expect(readFileNoFollow(join(root, 'none.md'))).toEqual({ kind: 'missing' });
    mkdirSync(join(root, 'dir'));
    expect(readFileNoFollow(join(root, 'dir'))).toMatchObject({
      kind: 'other',
      error: { code: 'EISDIR' },
    });
    expect(readTextNoFollow(join(root, 'dir'))).toBeNull();
  });

  it.skipIf(!POSIX)('AC-44: never follows a symlink, to read or to write', () => {
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, 'theirs\n');
    symlinkSync(outside, join(root, 'link.txt'));
    expect(readFileNoFollow(join(root, 'link.txt'))).toEqual({ kind: 'symlink' });
    expect(() => writeFileNoFollow(join(root, 'link.txt'), 'ours\n')).toThrow();
    expect(readFileSync(outside, 'utf8')).toBe('theirs\n');
  });

  it.skipIf(!POSIX)('AC-44: the ignore block and the agent sync skip a symlinked target', () => {
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, 'theirs\n');
    const agents = join(root, '.claude/agents');
    mkdirSync(agents, { recursive: true });
    symlinkSync(outside, join(agents, '.gitignore'));
    symlinkSync(outside, join(agents, 'paqad-planning.md'));
    expect(writeFolderIgnoreBlock(agents, AGENTS_IGNORE_LINES)).toBe(false);
    expect(syncProjectStageAgents(root).symlinks).toContain('.claude/agents/paqad-planning.md');
    expect(readFileSync(outside, 'utf8')).toBe('theirs\n');
  });

  it('AC-44: reports a symlinked file as a link on every platform', (ctx) => {
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, 'theirs\n');
    const agents = join(root, '.claude/agents');
    mkdirSync(agents, { recursive: true });
    try {
      symlinkSync(outside, join(root, 'link.txt'));
      symlinkSync(outside, join(agents, '.gitignore'));
      symlinkSync(outside, join(agents, 'paqad-planning.md'));
    } catch {
      ctx.skip();
    }
    expect(readFileNoFollow(join(root, 'link.txt'))).toEqual({ kind: 'symlink' });
    expect(readTextNoFollow(join(root, 'link.txt'))).toBeNull();
    expect(writeFolderIgnoreBlock(agents, AGENTS_IGNORE_LINES)).toBe(false);
    expect(syncProjectStageAgents(root).symlinks).toContain('.claude/agents/paqad-planning.md');
    expect(readFileSync(outside, 'utf8')).toBe('theirs\n');
  });

  it('writes a new file and replaces an existing one', () => {
    const path = join(root, 'w.txt');
    writeFileNoFollow(path, 'one\n');
    writeFileNoFollow(path, 'two\n');
    expect(readFileSync(path, 'utf8')).toBe('two\n');
  });
});
