import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { resolvePathSensitivity } from '@/module-map/sensitivity.js';

const MAP = `version: 2
modules:
  - slug: verification
    name: Verification Gates
    sensitivity: high
    sources:
      - src/verification
    features:
      - slug: check-runner
        name: Check Runner
        sources: [src/checks/run-checks.ts]
  - slug: cli-lifecycle
    name: Lifecycle
    sensitivity: normal
    sources:
      - src/cli/commands/install.ts
`;

describe('resolvePathSensitivity (#324)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sensitivity-'));
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(join(root, PATHS.MODULE_MAP), MAP, 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('flags a path under a high-sensitivity module source prefix', () => {
    expect(resolvePathSensitivity(root, 'src/verification/repository/repository-context.ts')).toBe(
      'high',
    );
  });

  it('flags the exact source path itself', () => {
    expect(resolvePathSensitivity(root, 'src/verification')).toBe('high');
  });

  it('flags a high-sensitivity feature source', () => {
    expect(resolvePathSensitivity(root, 'src/checks/run-checks.ts')).toBe('high');
  });

  it('resolves an absolute path relative to the project root', () => {
    expect(resolvePathSensitivity(root, join(root, 'src/verification/gate-runner.ts'))).toBe(
      'high',
    );
  });

  it('returns normal for a non-sensitive path', () => {
    expect(resolvePathSensitivity(root, 'src/cli/commands/install.ts')).toBe('normal');
  });

  it('returns normal for a path in no module', () => {
    expect(resolvePathSensitivity(root, 'src/unrelated/thing.ts')).toBe('normal');
  });

  it('returns normal for an empty relative path', () => {
    expect(resolvePathSensitivity(root, root)).toBe('normal');
  });

  it('returns normal when no module map exists', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-sensitivity-bare-'));
    try {
      expect(resolvePathSensitivity(bare, 'src/verification/x.ts')).toBe('normal');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('does not match a sibling that only shares a prefix segment', () => {
    // "src/verification-utils" must NOT match the "src/verification" prefix.
    expect(resolvePathSensitivity(root, 'src/verification-utils/helper.ts')).toBe('normal');
  });

  it('skips an empty source prefix without matching everything', () => {
    // A high module with a blank source must not turn every path high (the empty
    // prefix is skipped; only the real prefix matches).
    const dir = mkdtempSync(join(tmpdir(), 'paqad-sensitivity-empty-'));
    try {
      mkdirSync(join(dir, 'docs/instructions/rules'), { recursive: true });
      writeFileSync(
        join(dir, PATHS.MODULE_MAP),
        `version: 2
modules:
  - slug: blank
    name: Blank
    sensitivity: high
    sources:
      - ''
      - src/real
`,
        'utf8',
      );
      expect(resolvePathSensitivity(dir, 'src/anything/else.ts')).toBe('normal');
      expect(resolvePathSensitivity(dir, 'src/real/x.ts')).toBe('high');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
