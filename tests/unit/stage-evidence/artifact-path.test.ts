import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ArtifactOutOfTreeError, normalizeArtifactPath } from '@/stage-evidence/artifact-path.js';

// Boundary validator for stage-end --artifact paths (issue #350). It must accept
// in-tree paths (absolute or relative) and reject genuinely out-of-tree ones loudly,
// without ever consulting the file system — existence is the recorder's job.
describe('normalizeArtifactPath', () => {
  const root = join('/', 'repo', 'project');

  it('leaves a relative in-tree path unchanged (the common case)', () => {
    expect(normalizeArtifactPath(root, 'docs/plan.md')).toBe('docs/plan.md');
  });

  it('normalizes an absolute in-tree path to project-relative', () => {
    expect(normalizeArtifactPath(root, join(root, 'docs', 'plan.md'))).toBe('docs/plan.md');
  });

  // Issue #401 — a real repro on macOS, where the temp root lives under the `/var`
  // symlink. The root realpath'd to `/private/var/…` while an absolute path to a
  // not-yet-created file under it stayed `/var/…`, so a genuinely in-tree path read as a
  // `../..` escape and was rejected. Existence must stay irrelevant to accept/reject.
  it('accepts an absolute in-tree path that does not exist yet, under a symlinked root', () => {
    const symlinkedRoot = mkdtempSync(join(tmpdir(), 'paqad-artifact-path-'));
    try {
      const missing = join(symlinkedRoot, 'nested', 'not-created-yet.md');
      expect(normalizeArtifactPath(symlinkedRoot, missing)).toBe('nested/not-created-yet.md');
    } finally {
      rmSync(symlinkedRoot, { recursive: true, force: true });
    }
  });

  it('normalizes a redundant `./` prefix and dot segments', () => {
    expect(normalizeArtifactPath(root, './docs/../docs/plan.md')).toBe('docs/plan.md');
  });

  it('rejects an absolute out-of-tree path (the #350 repro: /tmp/review.md)', () => {
    expect(() => normalizeArtifactPath(root, join('/', 'tmp', 'review.md'))).toThrow(
      ArtifactOutOfTreeError,
    );
  });

  it('rejects a relative path that escapes the root via `..`', () => {
    expect(() => normalizeArtifactPath(root, '../outside.md')).toThrow(ArtifactOutOfTreeError);
  });

  it('rejects the project root itself (a directory, not a file)', () => {
    expect(() => normalizeArtifactPath(root, root)).toThrow(ArtifactOutOfTreeError);
  });

  it('carries the offending input and a clear message on the error', () => {
    const outside = join('/', 'tmp', 'review.md');
    try {
      normalizeArtifactPath(root, outside);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactOutOfTreeError);
      expect((error as ArtifactOutOfTreeError).input).toBe(outside);
      expect((error as Error).message).toContain('artifact must be a path inside the project');
    }
  });

  it('does NOT check existence — a missing in-tree path still normalizes (anti-spoof intact)', () => {
    // Existence is the recorder's concern (it records a missing file as absent). The
    // validator only judges tree location, so a not-yet-created in-tree file passes.
    expect(normalizeArtifactPath(root, 'does/not/exist.md')).toBe('does/not/exist.md');
  });
});
