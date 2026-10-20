import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { seedGitChangedFiles } from '../../pipeline/changed-files.fixture.js';

const DISABLED_CONFIG = 'paqad_enable=false\n';

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
    seedGitChangedFiles(root, ['src/x.ts']);
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
