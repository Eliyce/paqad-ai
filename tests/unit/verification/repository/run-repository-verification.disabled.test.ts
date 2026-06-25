import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

// Issue #220 — when paqad is disabled, the verification backstop is a pure
// no-op: it returns an ok verdict and writes NOTHING under .paqad (no
// verification-evidence, module-health, ledger, audit.log, or session
// artifacts). `git status` after a disabled turn must be clean.

/** The durable local off-signal: paqad_enable=false in `.paqad/.config`. */
const DISABLED_CONFIG = 'paqad_enable=false\n';

/** Recursively list every file under a directory (relative paths), sorted. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current)) {
      const abs = join(current, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(abs).isDirectory()) {
        walk(abs, rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk(dir, '');
  return out.sort();
}

describe('runRepositoryVerification is a clean no-op when disabled', () => {
  let root: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-verify-disabled-'));
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    // A changed file: if verification actually ran it would compute digests and
    // write evidence/module-health, dirtying the tree.
    writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(['src/x.ts']));
    originalEnv = process.env.PAQAD_DISABLED;
    delete process.env.PAQAD_DISABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PAQAD_DISABLED;
    } else {
      process.env.PAQAD_DISABLED = originalEnv;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an ok "disabled" verdict and writes nothing (.config flag)', async () => {
    writeFileSync(join(root, '.paqad/.config'), DISABLED_CONFIG);
    const before = listFiles(join(root, '.paqad'));

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.summary).toContain('disabled');
    expect(verdict.gates).toEqual([]);
    expect(verdict.evidence_path).toBeNull();

    const after = listFiles(join(root, '.paqad'));
    expect(after).toEqual(before);
  });

  it('returns an ok "disabled" verdict and writes nothing (PAQAD_DISABLED env)', async () => {
    process.env.PAQAD_DISABLED = '1';
    const before = listFiles(join(root, '.paqad'));

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'git-backstop',
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.evidence_path).toBeNull();
    expect(listFiles(join(root, '.paqad'))).toEqual(before);
  });
});
