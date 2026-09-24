import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  captureSessionDirtyBaseline,
  readSessionDirtyBaseline,
  subtractUnchangedBaselineFiles,
} from '@/pipeline/dirty-baseline.js';

// Issue #576, Finding 1b — the session-start baseline lets the completion backstop tell inherited
// dirt (a pre-existing modified tracked file) from work the agent did this session.
describe('dirty-baseline (issue #576, Finding 1b)', () => {
  let root: string;
  const SESSION = 'sess-576';

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dirty-baseline-'));
    git('init', '--quiet');
    git('config', 'user.email', 'b@example.test');
    git('config', 'user.name', 'Baseline Fixture');
    writeFileSync(join(root, 'src.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'other.ts'), 'export const b = 1;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'initial');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('subtracts a pre-existing dirty file that is unchanged since session start', async () => {
    // A file is already dirty when the session starts (edited before the agent ran).
    writeFileSync(join(root, 'src.ts'), 'export const a = 2;\n');
    await captureSessionDirtyBaseline(root, SESSION);

    const baseline = readSessionDirtyBaseline(root, SESSION);
    expect(baseline).not.toBeNull();
    expect(baseline?.files['src.ts']).toBeTypeOf('string');

    // The completion backstop sees src.ts dirty, but it is inherited and unchanged → subtracted.
    expect(subtractUnchangedBaselineFiles(root, SESSION, ['src.ts'])).toEqual([]);
  });

  it('keeps a baselined file once the agent changes it this session (INV-2)', async () => {
    writeFileSync(join(root, 'src.ts'), 'export const a = 2;\n');
    await captureSessionDirtyBaseline(root, SESSION);

    // The agent edits the same file during the session → its digest changes → it must count.
    writeFileSync(join(root, 'src.ts'), 'export const a = 3;\n');
    expect(subtractUnchangedBaselineFiles(root, SESSION, ['src.ts'])).toEqual(['src.ts']);
  });

  it('keeps a file the agent creates that was not in the baseline', async () => {
    writeFileSync(join(root, 'src.ts'), 'export const a = 2;\n');
    await captureSessionDirtyBaseline(root, SESSION);

    // A brand-new file appears this session (not pre-existing dirt) → kept.
    writeFileSync(join(root, 'new.ts'), 'export const c = 1;\n');
    expect(subtractUnchangedBaselineFiles(root, SESSION, ['src.ts', 'new.ts'])).toEqual(['new.ts']);
  });

  it('captures once per session (a later call does not overwrite the snapshot)', async () => {
    writeFileSync(join(root, 'src.ts'), 'export const a = 2;\n');
    await captureSessionDirtyBaseline(root, SESSION);
    const first = readSessionDirtyBaseline(root, SESSION)?.captured_at;

    // A second capture after more dirt must not re-snapshot (else it would bake in later dirt).
    writeFileSync(join(root, 'other.ts'), 'export const b = 2;\n');
    await captureSessionDirtyBaseline(root, SESSION);
    const baseline = readSessionDirtyBaseline(root, SESSION);
    expect(baseline?.captured_at).toBe(first);
    expect(baseline?.files['other.ts']).toBeUndefined();
  });

  it('returns the list unchanged when no baseline was captured', () => {
    expect(subtractUnchangedBaselineFiles(root, 'never-captured', ['src.ts'])).toEqual(['src.ts']);
  });
});
