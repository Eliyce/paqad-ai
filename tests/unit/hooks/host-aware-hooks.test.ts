import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

// The shared, dist-free path extractor is imported directly from the runtime lib — the
// same file every host-aware hook uses (issue #566).
import { editTargets, parseApplyPatchPaths } from '../../../runtime/hooks/lib/edit-targets.mjs';
import { isFeatureDevEdit } from '@/stage-evidence/scope.js';

const FIXTURES = join(process.cwd(), 'tests/fixtures/hooks');
const readFixture = (rel: string): unknown => JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'));

describe('edit-targets — one extractor for both host payload shapes (issue #566)', () => {
  it('extracts every path from a Codex apply_patch (Add/Update/Delete/Move)', () => {
    const paths = editTargets(readFixture('codex/pre-tool-apply-patch.json'));
    expect(paths).toEqual([
      'src/new.ts',
      'src/existing.ts',
      'src/old.ts',
      'src/moved.ts',
      'src/renamed.ts',
    ]);
  });

  it('extracts the single path from a Claude Edit payload', () => {
    expect(editTargets(readFixture('claude/pre-tool-edit.json'))).toEqual(['src/hello.ts']);
  });

  it('returns the sentinel path from a Codex apply_patch that writes the sentinel', () => {
    const paths = editTargets(readFixture('codex/pre-tool-apply-patch-sentinel.json'));
    expect(paths).toEqual(['.paqad/.agent-entry-loaded']);
  });

  it('returns no paths for a non-apply_patch Codex tool (shell)', () => {
    expect(editTargets(readFixture('codex/pre-tool-shell.json'))).toEqual([]);
  });

  it('a docs-only Codex patch resolves to a documentation path (not feature-dev)', () => {
    const paths = editTargets(readFixture('codex/pre-tool-apply-patch-docs.json'));
    expect(paths).toEqual(['docs/guide.md']);
    // The scope predicate the capability gate uses must treat it as NOT feature-dev, so a
    // docs-only Codex patch is never over-blocked despite the fail-closed default.
    expect(paths.every((p) => isFeatureDevEdit(p) === false)).toBe(true);
  });

  it('parseApplyPatchPaths tolerates junk and a non-string input', () => {
    expect(parseApplyPatchPaths('no headers here')).toEqual([]);
    expect(parseApplyPatchPaths(undefined as unknown as string)).toEqual([]);
  });

  it('editTargets tolerates a payload with no tool_input', () => {
    expect(editTargets({})).toEqual([]);
    expect(editTargets(undefined)).toEqual([]);
  });
});

describe('agent-entry-gate — cross-host sentinel detection end to end (issue #566)', () => {
  const GATE = join(process.cwd(), 'runtime/hooks/agent-entry-gate.mjs');

  async function runGate(payload: unknown): Promise<{ exitCode: number | undefined }> {
    const root = mkdtempSync(join(tmpdir(), 'paqad-entry-gate-'));
    try {
      const result = await execa('node', [GATE], {
        reject: false,
        input: JSON.stringify(payload),
        // A bare temp project has no sentinel and paqad defaults ON, so the gate blocks
        // unless the pending edit IS the sentinel write.
        env: { PAQAD_PROJECT_ROOT: root },
      });
      return { exitCode: result.exitCode };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('blocks a Codex apply_patch source edit before the framework is loaded', async () => {
    const { exitCode } = await runGate(readFixture('codex/pre-tool-apply-patch.json'));
    expect(exitCode).toBe(2);
  });

  it('exempts the Codex apply_patch that writes the sentinel (no deadlock)', async () => {
    const { exitCode } = await runGate(readFixture('codex/pre-tool-apply-patch-sentinel.json'));
    expect(exitCode).toBe(0);
  });

  it('still blocks / exempts the Claude Edit shapes identically', async () => {
    expect((await runGate(readFixture('claude/pre-tool-edit.json'))).exitCode).toBe(2);
    expect((await runGate(readFixture('claude/pre-tool-edit-sentinel.json'))).exitCode).toBe(0);
  });
});
