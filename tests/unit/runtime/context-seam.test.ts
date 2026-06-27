import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The seam is shipped as a runtime .mjs (it runs inside the global hook install,
// which has no compiled `dist`), so the test imports it directly — mirroring the
// paqad-disabled.mjs parity test.
import {
  BLOCK_CLOSE,
  BLOCK_OPEN,
  CONTEXT_ARTIFACT_RELPATH,
  buildInjection,
  formatContextBlock,
  readContextUnderBudget,
  resolveContextArtifactPath,
  // @ts-expect-error — runtime .mjs has no type declarations.
} from '../../../runtime/scripts/context-seam.mjs';

const SEAM_PATH = resolve(__dirname, '../../../runtime/scripts/context-seam.mjs');

describe('resolveContextArtifactPath', () => {
  it('defaults to the project-relative artifact path', () => {
    expect(resolveContextArtifactPath('/repo', {})).toBe(join('/repo', CONTEXT_ARTIFACT_RELPATH));
  });

  it('honours an absolute PAQAD_CONTEXT_ARTIFACT override', () => {
    expect(
      resolveContextArtifactPath('/repo', { PAQAD_CONTEXT_ARTIFACT: '/elsewhere/ctx.md' }),
    ).toBe('/elsewhere/ctx.md');
  });

  it('resolves a relative override against the project root', () => {
    expect(resolveContextArtifactPath('/repo', { PAQAD_CONTEXT_ARTIFACT: 'custom/ctx.md' })).toBe(
      join('/repo', 'custom/ctx.md'),
    );
  });

  it('ignores a blank override', () => {
    expect(resolveContextArtifactPath('/repo', { PAQAD_CONTEXT_ARTIFACT: '   ' })).toBe(
      join('/repo', CONTEXT_ARTIFACT_RELPATH),
    );
  });
});

describe('readContextUnderBudget', () => {
  const fakeStat = (size: number, isFile = true) => ({ size, isFile: () => isFile });

  it('returns the trimmed content when the artifact exists', () => {
    const out = readContextUnderBudget('/x', {
      now: () => 0,
      statFile: () => fakeStat(20),
      readFile: () => '  hello context  \n',
    });
    expect(out).toBe('hello context');
  });

  it('returns null when the file is missing or unreadable', () => {
    const out = readContextUnderBudget('/x', {
      now: () => 0,
      statFile: () => {
        throw new Error('ENOENT');
      },
      readFile: () => 'unused',
    });
    expect(out).toBeNull();
  });

  it('returns null for an empty file', () => {
    const out = readContextUnderBudget('/x', {
      now: () => 0,
      statFile: () => fakeStat(0),
      readFile: () => '',
    });
    expect(out).toBeNull();
  });

  it('returns null for a whitespace-only file', () => {
    const out = readContextUnderBudget('/x', {
      now: () => 0,
      statFile: () => fakeStat(5),
      readFile: () => '   \n\t ',
    });
    expect(out).toBeNull();
  });

  it('returns null when the path is not a regular file', () => {
    const out = readContextUnderBudget('/x', {
      now: () => 0,
      statFile: () => fakeStat(10, false),
      readFile: () => 'unused',
    });
    expect(out).toBeNull();
  });

  it('skips the read when the budget is already blown by a slow stat', () => {
    let calls = 0;
    let read = false;
    const out = readContextUnderBudget('/x', {
      // First now() seeds the deadline at 50; the post-stat now() jumps past it.
      now: () => (calls++ === 0 ? 0 : 1000),
      statFile: () => fakeStat(20),
      readFile: () => {
        read = true;
        return 'late';
      },
      budgetMs: 50,
    });
    expect(out).toBeNull();
    expect(read).toBe(false);
  });

  it('drops content that overran the budget during the read', () => {
    let calls = 0;
    const out = readContextUnderBudget('/x', {
      // now() at: deadline-seed(0), post-stat(10 → ok), post-read(1000 → over).
      now: () => [0, 10, 1000][calls++] ?? 1000,
      statFile: () => fakeStat(20),
      readFile: () => 'content',
      budgetMs: 50,
    });
    expect(out).toBeNull();
  });

  it('truncates content above the byte ceiling with a visible marker', () => {
    const big = 'a'.repeat(100);
    const out = readContextUnderBudget('/x', {
      now: () => 0,
      statFile: () => fakeStat(big.length),
      readFile: () => big,
      maxBytes: 10,
    });
    expect(out).toContain('truncated at 10 bytes');
    expect(out?.startsWith('aaaaaaaaaa')).toBe(true);
  });
});

describe('formatContextBlock', () => {
  it('wraps content in the paqad-context fence', () => {
    expect(formatContextBlock('body')).toBe(`${BLOCK_OPEN}\nbody\n${BLOCK_CLOSE}`);
  });
});

describe('buildInjection (filesystem)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-seam-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('emits a block when the artifact exists', () => {
    const artifact = join(projectRoot, 'ctx.md');
    writeFileSync(artifact, '# slice\nbody');
    const block = buildInjection(projectRoot, { path: artifact });
    expect(block).toBe(`${BLOCK_OPEN}\n# slice\nbody\n${BLOCK_CLOSE}`);
  });

  it('emits nothing when the artifact is absent (cold start == today)', () => {
    expect(buildInjection(projectRoot, { path: join(projectRoot, 'nope.md') })).toBe('');
  });

  it('exports a stable module path so the hook can import it', () => {
    expect(SEAM_PATH).toMatch(/runtime\/scripts\/context-seam\.mjs$/);
  });
});
