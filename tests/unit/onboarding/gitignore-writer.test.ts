import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { writeGitignore } from '@/onboarding/gitignore-writer';

const BEGIN = '# >>> paqad-ai managed (do not edit between markers) >>>';
const END = '# <<< paqad-ai managed <<<';

function read(projectRoot: string, file: string): string {
  return readFileSync(join(projectRoot, file), 'utf8');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function gitInit(projectRoot: string): void {
  const run = (args: string[]) => execFileSync('git', args, { cwd: projectRoot, stdio: 'ignore' });
  run(['init']);
  run(['config', 'user.email', 'test@paqad.dev']);
  run(['config', 'user.name', 'paqad test']);
}

function trackedFiles(projectRoot: string, path: string): string {
  return execFileSync('git', ['ls-files', '--', path], { cwd: projectRoot }).toString().trim();
}

describe('writeGitignore', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-gitignore-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates a managed .gitignore block with the canonical entries', () => {
    writeGitignore(projectRoot);

    const content = read(projectRoot, '.gitignore');
    expect(content).toContain(BEGIN);
    expect(content).toContain(END);
    // Pre-existing entries.
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('.paqad/cache/');
    // New (#184) entries.
    expect(content).toContain('.paqad/.agent-entry-loaded');
    expect(content).toContain('.paqad/logs/');
    expect(content).toContain('.paqad/audit.log');
    expect(content).toContain('.paqad/module-health/');
    expect(content).toContain('.paqad/module-health-evidence/');
    expect(content).toContain('.paqad/ledger/');
  });

  it('appends the managed block to an existing .gitignore, preserving content', () => {
    writeFileSync(join(projectRoot, '.gitignore'), 'node_modules/\ndist/\n');

    writeGitignore(projectRoot);

    const content = read(projectRoot, '.gitignore');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(content).toContain(BEGIN);
    expect(content).toContain('.paqad/ledger/');
  });

  it('is idempotent — a second run leaves the file byte-identical', () => {
    writeFileSync(join(projectRoot, '.gitignore'), 'node_modules/\n');
    writeGitignore(projectRoot);
    const first = read(projectRoot, '.gitignore');

    writeGitignore(projectRoot);
    const second = read(projectRoot, '.gitignore');

    expect(second).toBe(first);
    expect(countOccurrences(second, BEGIN)).toBe(1);
    expect(countOccurrences(second, END)).toBe(1);
  });

  it('reconciles the managed block in place, adding new entries and preserving out-of-block content', () => {
    // A stale managed block (missing the #184 ledger entry) plus user content
    // both before and after it.
    const stale = [
      'node_modules/',
      '',
      BEGIN,
      '.paqad/cache/',
      END,
      '',
      '# my own rules',
      'coverage/',
      '',
    ].join('\n');
    writeFileSync(join(projectRoot, '.gitignore'), stale);

    writeGitignore(projectRoot);

    const content = read(projectRoot, '.gitignore');
    // Newly shipped entry is now present.
    expect(content).toContain('.paqad/ledger/');
    expect(content).toContain('.paqad/module-health/');
    // Out-of-block content (before and after) is untouched.
    expect(content).toContain('node_modules/');
    expect(content).toContain('# my own rules');
    expect(content).toContain('coverage/');
    // Exactly one managed block.
    expect(countOccurrences(content, BEGIN)).toBe(1);
    expect(countOccurrences(content, END)).toBe(1);
  });

  it('migrates a legacy "# paqad-ai" block to the managed block without duplicate entries', () => {
    const legacy = [
      'node_modules/',
      '# paqad-ai',
      '.paqad/framework-path.txt',
      '.paqad/cache/',
      '.paqad/session/',
      '',
    ].join('\n');
    writeFileSync(join(projectRoot, '.gitignore'), legacy);

    writeGitignore(projectRoot);

    const content = read(projectRoot, '.gitignore');
    // The legacy marker is gone; the managed block owns the entries now.
    expect(content).not.toContain('# paqad-ai\n');
    expect(content).toContain(BEGIN);
    expect(content).toContain('.paqad/ledger/');
    // No duplicate framework-path entry left behind by the migration.
    expect(countOccurrences(content, '.paqad/framework-path.txt')).toBe(1);
    expect(content).toContain('node_modules/');
  });

  it('writes a managed .gitattributes block making the decision index merge cleanly', () => {
    writeGitignore(projectRoot);

    const content = read(projectRoot, '.gitattributes');
    expect(content).toContain('.paqad/decisions/index.json merge=union');
    expect(countOccurrences(content, '.paqad/decisions/index.json merge=union')).toBe(1);

    // Idempotent.
    const before = content;
    writeGitignore(projectRoot);
    expect(read(projectRoot, '.gitattributes')).toBe(before);
  });

  it('does not throw outside a git repository (untrack step is a no-op)', () => {
    expect(() => writeGitignore(projectRoot)).not.toThrow();
    expect(existsSync(join(projectRoot, '.gitignore'))).toBe(true);
  });

  it('untracks a now-ignored path that an earlier onboarding committed, keeping the working-tree file', () => {
    gitInit(projectRoot);
    // An older onboarding committed runtime state into git.
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'audit.log'), 'old audit entry\n');
    execFileSync('git', ['add', '.paqad/audit.log'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: projectRoot, stdio: 'ignore' });
    expect(trackedFiles(projectRoot, '.paqad/audit.log')).toBe('.paqad/audit.log');

    writeGitignore(projectRoot);

    // No longer tracked...
    expect(trackedFiles(projectRoot, '.paqad/audit.log')).toBe('');
    // ...but the working-tree file is preserved.
    expect(existsSync(join(projectRoot, '.paqad', 'audit.log'))).toBe(true);
    // And the untrack is recorded once in the (local) audit log.
    const audit = read(projectRoot, '.paqad/audit.log');
    expect(audit).toContain('gitignore.untracked-now-ignored');
  });

  it('is a no-op in a git repo with nothing tracked to untrack', () => {
    gitInit(projectRoot);
    expect(() => writeGitignore(projectRoot)).not.toThrow();
    expect(trackedFiles(projectRoot, '.paqad/audit.log')).toBe('');
  });
});
