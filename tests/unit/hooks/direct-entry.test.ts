import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isDirectEntry } from '../../../runtime/hooks/lib/direct-entry.mjs';

// Issue #636 (bug 2) — the one realpath-safe entry guard shared by every hook. The raw
// `import.meta.url === \`file://${process.argv[1]}\`` comparison (which this replaces) misses on
// Windows, on paths with spaces, and on symlinked paths, so a hook silently no-ops.

const HOOKS_DIR = resolve(__dirname, '../../../runtime/hooks');

describe('isDirectEntry (issue #636 bug 2)', () => {
  it('matches when import.meta.url is the real file URL of argv1', () => {
    const real = join(HOOKS_DIR, 'lib', 'direct-entry.mjs');
    const url = pathToFileURL(realpathSync(real)).href;
    expect(isDirectEntry(url, real)).toBe(true);
  });

  it('matches through a SYMLINKED argv1 (the macOS /tmp -> /private/tmp case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-direct-'));
    try {
      const real = join(HOOKS_DIR, 'lib', 'direct-entry.mjs');
      const link = join(dir, 'linked.mjs');
      symlinkSync(real, link);
      const url = pathToFileURL(realpathSync(real)).href;
      // argv1 is the symlink; import.meta.url is the resolved real URL — the raw compare would miss.
      expect(isDirectEntry(url, link)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches a path containing a space', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad direct space-'));
    try {
      const real = join(HOOKS_DIR, 'lib', 'direct-entry.mjs');
      const spaced = join(dir, 'with space.mjs');
      symlinkSync(real, spaced);
      const url = pathToFileURL(realpathSync(real)).href;
      expect(isDirectEntry(url, spaced)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false when argv1 is missing or does not match', () => {
    expect(isDirectEntry('file:///x/y.mjs', undefined)).toBe(false);
    expect(isDirectEntry('file:///x/y.mjs', join(HOOKS_DIR, 'lib', 'direct-entry.mjs'))).toBe(
      false,
    );
  });
});

describe('no hook uses the raw file:// entry comparison (issue #636 bug 2 guard)', () => {
  it('every runtime/hooks/*.mjs is free of `file://${process.argv[1]}`', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith('.mjs')) {
          const src = readFileSync(path, 'utf8');
          // The exact broken pattern: a template literal file URL built from the raw argv path.
          if (src.includes('`file://${process.argv[1]}`')) {
            offenders.push(path);
          }
        }
      }
    };
    walk(HOOKS_DIR);
    expect(offenders).toEqual([]);
  });
});
