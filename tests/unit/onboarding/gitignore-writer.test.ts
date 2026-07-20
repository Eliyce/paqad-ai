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

function commitFile(projectRoot: string, relPath: string, body: string): void {
  mkdirSync(join(projectRoot, relPath, '..'), { recursive: true });
  writeFileSync(join(projectRoot, relPath), body);
  execFileSync('git', ['add', '--force', relPath], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', `seed ${relPath}`], { cwd: projectRoot, stdio: 'ignore' });
}

describe('writeGitignore (nested .paqad-owned policy)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-gitignore-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes the managed block into .paqad/.gitignore with relative entries', () => {
    writeGitignore(projectRoot);

    const content = read(projectRoot, '.paqad/.gitignore');
    expect(content).toContain(BEGIN);
    expect(content).toContain(END);
    // Relative to .paqad/ — no `.paqad/` prefix.
    expect(content).toContain('cache/');
    expect(content).toContain('logs/');
    expect(content).toContain('module-health/');
    expect(content).toContain('module-health-evidence/');
    // Both rule-script runtime subtrees (snapshots + cache) are local-only.
    expect(content).toContain('scripts/rules/.cache/');
    expect(content).toContain('scripts/rules/.history/');
  });

  it('ignores per-machine runtime state created on first use of later workflows', () => {
    writeGitignore(projectRoot);

    const content = read(projectRoot, '.paqad/.gitignore');
    // Regenerable embeddings / collections — mirror of the already-ignored vectors/.
    expect(content).toContain('patterns/');
    expect(content).toContain('crs/');
    expect(content).toContain('attachments/');
    // Per-machine append-only logs and regenerated snapshots.
    expect(content).toContain('attachment-events.jsonl');
    expect(content).toContain('traceability/');
    expect(content).toContain('module-map/drift.json');
    expect(content).toContain('module-map/events.jsonl');
    expect(content).toContain('schema-migrations.jsonl');
    expect(content).toContain('skills/');
    expect(content).toContain('delivery-detection.json');
    // Conservative: the module-map history audit trail stays shared (tracked).
    expect(content).not.toContain('module-map/history/');
  });

  it('keeps the boot pointer shared and the version file local (the inversion)', () => {
    writeGitignore(projectRoot);

    const content = read(projectRoot, '.paqad/.gitignore');
    // Decision 1 — framework-path.txt stays committed, so it is NOT ignored.
    expect(content).not.toContain('framework-path.txt');
    // Decision 2 — framework-version.txt is per-machine, so it IS ignored.
    expect(content).toContain('framework-version.txt');
  });

  it('ignores the ledger unconditionally, with no project profile present', () => {
    // No `.paqad/project-profile.yaml` / enterprise block at all.
    writeGitignore(projectRoot);
    expect(read(projectRoot, '.paqad/.gitignore')).toContain('ledger/');
  });

  // Issue #401 — `.paqad/compliance/` was not ignored, so a spec-review report written
  // there showed up as `?? .paqad/compliance/` in a consumer project and was committable.
  it('ignores the compliance directory, so a compliance artifact is never committable (AC-6)', () => {
    writeGitignore(projectRoot);
    expect(read(projectRoot, '.paqad/.gitignore')).toContain('compliance/');
  });

  it('writes a nested .paqad/.gitattributes making the decision index merge cleanly', () => {
    writeGitignore(projectRoot);

    const content = read(projectRoot, '.paqad/.gitattributes');
    expect(content).toContain('decisions/index.json merge=union');
    expect(countOccurrences(content, 'decisions/index.json merge=union')).toBe(1);
  });

  it('is idempotent — a second run leaves both files byte-identical', () => {
    writeGitignore(projectRoot);
    const ignoreFirst = read(projectRoot, '.paqad/.gitignore');
    const attrFirst = read(projectRoot, '.paqad/.gitattributes');

    writeGitignore(projectRoot);

    expect(read(projectRoot, '.paqad/.gitignore')).toBe(ignoreFirst);
    expect(read(projectRoot, '.paqad/.gitattributes')).toBe(attrFirst);
    expect(countOccurrences(read(projectRoot, '.paqad/.gitignore'), BEGIN)).toBe(1);
  });

  it('migrates: scrubs the old paqad-managed block out of the project root .gitignore', () => {
    // A repo onboarded under the old layout carried paqad's block in the root
    // file, surrounded by the project's own rules.
    const rootBefore = [
      'node_modules/',
      '',
      BEGIN,
      '.paqad/cache/',
      '.paqad/ledger/',
      END,
      '',
      '# my own rules',
      'coverage/',
      '',
    ].join('\n');
    writeFileSync(join(projectRoot, '.gitignore'), rootBefore);

    writeGitignore(projectRoot);

    const root = read(projectRoot, '.gitignore');
    // paqad's block is gone from the root...
    expect(root).not.toContain(BEGIN);
    expect(root).not.toContain('.paqad/cache/');
    // ...the project's own content is preserved, before and after...
    expect(root).toContain('node_modules/');
    expect(root).toContain('# my own rules');
    expect(root).toContain('coverage/');
    // ...and the policy now lives under .paqad/.
    expect(read(projectRoot, '.paqad/.gitignore')).toContain('cache/');
  });

  it('migrates: scrubs a pre-#184 "# paqad-ai" legacy block from the root .gitignore', () => {
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

    const root = read(projectRoot, '.gitignore');
    expect(root).not.toContain('# paqad-ai');
    expect(root).not.toContain('.paqad/cache/');
    // Even the legacy boot-pointer entry is cleaned (it is no longer ignored).
    expect(root).not.toContain('.paqad/framework-path.txt');
    expect(root).toContain('node_modules/');
  });

  it('leaves a project root .gitignore with no paqad content untouched', () => {
    writeFileSync(join(projectRoot, '.gitignore'), 'node_modules/\ndist/\n');
    writeGitignore(projectRoot);
    expect(read(projectRoot, '.gitignore')).toBe('node_modules/\ndist/\n');
  });

  it('empties a project root .gitignore that contained nothing but paqad block', () => {
    writeFileSync(join(projectRoot, '.gitignore'), [BEGIN, '.paqad/cache/', END, ''].join('\n'));
    writeGitignore(projectRoot);
    expect(read(projectRoot, '.gitignore')).toBe('');
  });

  it('scrubs a paqad block sitting at the very top of the root .gitignore', () => {
    writeFileSync(
      join(projectRoot, '.gitignore'),
      [BEGIN, '.paqad/cache/', END, '', 'node_modules/', ''].join('\n'),
    );
    writeGitignore(projectRoot);
    const root = read(projectRoot, '.gitignore');
    expect(root).not.toContain(BEGIN);
    expect(root).toContain('node_modules/');
  });

  it('scrubs a paqad block sitting at the very end of the root .gitignore', () => {
    writeFileSync(
      join(projectRoot, '.gitignore'),
      ['node_modules/', '', BEGIN, '.paqad/cache/', END, ''].join('\n'),
    );
    writeGitignore(projectRoot);
    const root = read(projectRoot, '.gitignore');
    expect(root).not.toContain(BEGIN);
    expect(root).toContain('node_modules/');
  });

  it('does not throw outside a git repository (untrack step is a no-op)', () => {
    expect(() => writeGitignore(projectRoot)).not.toThrow();
    expect(existsSync(join(projectRoot, '.paqad/.gitignore'))).toBe(true);
  });

  it('untracks a now-ignored file an earlier onboarding committed, keeping the working tree', () => {
    gitInit(projectRoot);
    // Older onboarding committed per-machine runtime state into git.
    commitFile(projectRoot, '.paqad/audit.log', 'old audit entry\n');
    commitFile(projectRoot, '.paqad/framework-version.txt', 'version=1.0.0\n');
    expect(trackedFiles(projectRoot, '.paqad/audit.log')).toBe('.paqad/audit.log');

    writeGitignore(projectRoot);

    // Now-ignored paths are untracked...
    expect(trackedFiles(projectRoot, '.paqad/audit.log')).toBe('');
    expect(trackedFiles(projectRoot, '.paqad/framework-version.txt')).toBe('');
    // ...but the working-tree files are preserved.
    expect(existsSync(join(projectRoot, '.paqad', 'audit.log'))).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad', 'framework-version.txt'))).toBe(true);
    // ...and the untrack is recorded once in the (local) audit log.
    expect(read(projectRoot, '.paqad/audit.log')).toContain('gitignore.untracked-now-ignored');
  });

  it('keeps the committed boot pointer tracked (never untracks framework-path.txt)', () => {
    gitInit(projectRoot);
    commitFile(projectRoot, '.paqad/framework-path.txt', '~/.paqad-ai/current\n');

    writeGitignore(projectRoot);

    // Decision 1 — the boot pointer is not in the ignore set, so it stays shared.
    expect(trackedFiles(projectRoot, '.paqad/framework-path.txt')).toBe(
      '.paqad/framework-path.txt',
    );
  });

  it('is a no-op in a git repo with nothing tracked to untrack', () => {
    gitInit(projectRoot);
    expect(() => writeGitignore(projectRoot)).not.toThrow();
    expect(trackedFiles(projectRoot, '.paqad/audit.log')).toBe('');
  });

  it('untracks AND removes deprecated artifacts an earlier onboarding committed', () => {
    gitInit(projectRoot);
    // A repo onboarded before these files were dropped committed them.
    commitFile(projectRoot, '.paqad/version', 'schema_version=1\n');
    commitFile(projectRoot, '.paqad/classifier-config.json', '{"schema_version":1}\n');
    expect(trackedFiles(projectRoot, '.paqad/version')).toBe('.paqad/version');

    writeGitignore(projectRoot);

    // Untracked from git AND the orphaned working-tree file is gone.
    expect(trackedFiles(projectRoot, '.paqad/version')).toBe('');
    expect(trackedFiles(projectRoot, '.paqad/classifier-config.json')).toBe('');
    expect(existsSync(join(projectRoot, '.paqad', 'version'))).toBe(false);
    expect(existsSync(join(projectRoot, '.paqad', 'classifier-config.json'))).toBe(false);
    // Recorded once in the local audit log.
    expect(read(projectRoot, '.paqad/audit.log')).toContain(
      'gitignore.removed-deprecated-artifacts',
    );
  });

  it('removes a deprecated working-tree artifact outside a git repository', () => {
    // No git repo: the untrack step is skipped, but the orphan is still unlinked.
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'classifier-config.json'), '{}\n');

    writeGitignore(projectRoot);

    expect(existsSync(join(projectRoot, '.paqad', 'classifier-config.json'))).toBe(false);
  });

  it('unlinks a deprecated artifact that exists but was never committed in a git repo', () => {
    gitInit(projectRoot);
    // Present on disk, untracked (nothing committed) — git rm is skipped, but the
    // orphan is still unlinked.
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'version'), 'schema_version=1\n');

    writeGitignore(projectRoot);

    expect(existsSync(join(projectRoot, '.paqad', 'version'))).toBe(false);
  });

  it('untracks a now-ignored directory whose files an earlier onboarding committed', () => {
    gitInit(projectRoot);
    // A directory-form ignore entry (logs/) with a committed file beneath it.
    commitFile(projectRoot, '.paqad/logs/auto-update.log', 'old log line\n');
    expect(trackedFiles(projectRoot, '.paqad/logs/auto-update.log')).toBe(
      '.paqad/logs/auto-update.log',
    );

    writeGitignore(projectRoot);

    expect(trackedFiles(projectRoot, '.paqad/logs/auto-update.log')).toBe('');
    // Working-tree file preserved (--cached only).
    expect(existsSync(join(projectRoot, '.paqad', 'logs', 'auto-update.log'))).toBe(true);
  });
});
